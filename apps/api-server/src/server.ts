import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";

import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from "fastify";

import { starterScenario } from "../../../packages/content/src/fixtures/starter-scenario.js";
import { academyIntroProgram } from "../../../packages/content/src/academy/invalidation-before-direction.js";
import { programScenarios } from "../../../packages/content/src/academy/index.js";
import {
  InMemoryRateLimitStore,
  type RateLimitStore
} from "./security.js";
import {
  AcademyChallengeStartRequestSchema,
  DecisionTraceSchema,
  ScenarioRunStartRequestSchema,
  TelegramAuthRequestSchema,
  TelemetryIngestRequestSchema
} from "../../../packages/contracts/src/index.js";
import type {
  AcademyModule,
  ChallengeDefinition,
  Lesson
} from "../../../packages/contracts/src/learning.js";
import {
  closeDatabase,
  createDatabase,
  seedFoundation,
  SqlitePersistenceAdapter,
  type DatabaseHandle,
  type DecisionEventRecord,
  type PersistencePort,
  type ScenarioRunRecord
} from "../../../packages/db/src/index.js";
import {
  assertDecisionTraceAllowed,
  evaluateChallengeVerification,
  nextLearningStatus,
  TelegramAuthError,
  evaluateFoundationDecision,
  toPublicScenarioProjection,
  toScenarioRevealProjection,
  verifyTelegramInitDataAsync
} from "../../../packages/domain/src/index.js";

const FOUNDATION_USER_ID = "seed-user-001";

// Scenario completion is server-authoritative and grants XP + Mastery only, via
// a single idempotent transaction (`applyScenarioCompletionRewards`). Coins are
// NEVER minted by completing a scenario (docs/economy_monetization_referrals.md
// §2/§5.7): they enter the economy only through Coin Pack credits and server
// promo grants. The e2e anti-pay-to-win test asserts this data-flow direction.

export type AuthMode = "fixture" | "telegram";

export type BuildServerOptions = {
  database?: DatabaseHandle;
  persistence?: PersistencePort;
  closePersistence?: () => Promise<void>;
  readinessCheck?: () => Promise<void>;
  userId?: string;
  authMode?: AuthMode;
  seedFoundation?: boolean;
  telegramBotToken?: string;
  sessionTtlSeconds?: number;
  sessionSecure?: boolean;
  allowedOrigins?: readonly string[];
  rateLimitStore?: RateLimitStore;
  authRateLimitPerMinute?: number;
  now?: () => number;
};

function hashSessionToken(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

function serializeCookie(
  name: string,
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
  httpOnly: boolean
): string {
  return [
    `${name}=${token}`,
    "Path=/",
    ...(httpOnly ? ["HttpOnly"] : []),
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    ...(secure ? ["Secure"] : [])
  ].join("; ");
}

function serializeSessionCookie(
  token: string,
  maxAgeSeconds: number,
  secure: boolean
): string {
  return serializeCookie("sa_session", token, maxAgeSeconds, secure, true);
}

function serializeCsrfCookie(
  token: string,
  maxAgeSeconds: number,
  secure: boolean
): string {
  return serializeCookie("sa_csrf", token, maxAgeSeconds, secure, false);
}

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) {
      continue;
    }

    if (part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      return value || undefined;
    }
  }

  return undefined;
}

function readSessionToken(cookieHeader: string | undefined): string | undefined {
  return readCookie(cookieHeader, "sa_session");
}

function toRunResponse(
  run: ScenarioRunRecord,
  includeScore = false
): Record<string, unknown> {
  const response: Record<string, unknown> = {
    runId: run.runId,
    scenarioId: run.scenarioId,
    scenarioVersion: run.scenarioVersion,
    state: run.state,
    createdAt: run.createdAt,
    sealedAt: run.sealedAt,
    revealedAt: run.revealedAt,
    completedAt: run.completedAt
  };

  if (run.decision) {
    response.decision = run.decision;
  }

  if (includeScore && run.score) {
    response.score = run.score;
  }

  return response;
}

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const database = options.database ?? (options.persistence ? undefined : createDatabase());
  const persistence = options.persistence ?? (
    database ? new SqlitePersistenceAdapter(database) : (() => {
      throw new Error("A persistence adapter or database is required");
    })()
  );
  const userId = options.userId ?? FOUNDATION_USER_ID;
  const authMode = options.authMode ?? "fixture";
  const now = options.now ?? Date.now;
  const sessionTtlSeconds = options.sessionTtlSeconds ?? 604_800;
  const sessionSecure = options.sessionSecure ?? process.env.NODE_ENV === "production";
  const allowedOrigins = options.allowedOrigins ?? [];
  const rateLimitStore = options.rateLimitStore ?? new InMemoryRateLimitStore();
  const authRateLimitPerMinute = options.authRateLimitPerMinute ?? 10;
  const authRateLimitWindowMs = 60_000;
  const readinessCheck = options.readinessCheck ?? (async () => undefined);

  // Academy Level 0 content is a versioned fixture (no runtime authoring this
  // iteration), so the server keeps in-memory lookups for the authored program
  // and only persists per-user progression. The client never supplies criteria,
  // gates, or thresholds — those resolve server-side from this registry.
  const academyModulesById = new Map<string, AcademyModule>(
    academyIntroProgram.modules.map((module) => [module.moduleId, module])
  );
  const academyChallengesById = new Map<string, ChallengeDefinition>(
    academyIntroProgram.challenges.map((challenge) => [challenge.challengeDefinitionId, challenge])
  );
  const academyLessonsById = new Map<string, Lesson>(
    academyIntroProgram.lessons.map((lesson) => [lesson.lessonId, lesson])
  );
  const academyScenariosById = new Map(
    programScenarios.map((scenario) => [scenario.scenarioId, scenario])
  );

  if (options.seedFoundation ?? !options.persistence) {
    if (!database) {
      throw new Error("Foundation seed requires a SQLite database");
    }
    seedFoundation({
      ...database,
      scenario: starterScenario,
      userId,
      externalId: `fixture:${userId}`
    });
    // Seed every Academy-referenced scenario so a Challenge/Transfer run can
    // start against a real, scored, point-in-time package.
    for (const scenario of programScenarios) {
      seedFoundation({
        ...database,
        scenario,
        userId,
        externalId: `fixture:${userId}`
      });
    }
    // Fixture mode only: pre-provision a small pool of isolated identities so each
    // Playwright acceptance test can drive a pristine learner (via the
    // `sa_fixture_user` cookie) without mutating another test's progression. This
    // never runs under real auth modes.
    if (authMode === "fixture") {
      for (let i = 1; i <= 24; i += 1) {
        const browserUserId = `browser-e2e-${String(i).padStart(2, "0")}`;
        seedFoundation({
          ...database,
          scenario: starterScenario,
          userId: browserUserId,
          externalId: `fixture:${browserUserId}`
        });
      }
    }
  }

  const server = Fastify({
    logger: false,
    bodyLimit: 16_384
  });

  server.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "strict-origin-when-cross-origin");
    reply.header("permissions-policy", "accelerometer=(), camera=(), geolocation=(), microphone=()");
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (sessionSecure) {
      reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    }

    const origin = request.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      return reply.code(403).send({ error: "origin_not_allowed" });
    }
    if (origin) {
      reply.header("access-control-allow-origin", origin);
      reply.header("access-control-allow-credentials", "true");
      reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
      reply.header("access-control-allow-headers", "content-type, x-sa-csrf");
      reply.header("vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });

  server.addHook("onClose", async () => {
    if (options.closePersistence) {
      await options.closePersistence();
    } else if (database) {
      closeDatabase(database);
    }
  });

  function requireCsrf(request: FastifyRequest, reply: FastifyReply): boolean {
    if (authMode === "fixture") {
      return true;
    }

    const cookieToken = readCookie(request.headers.cookie, "sa_csrf");
    const headerToken = request.headers["x-sa-csrf"];
    if (!cookieToken || typeof headerToken !== "string") {
      void reply.code(403).send({ error: "csrf_failed" });
      return false;
    }

    const expected = Buffer.from(cookieToken);
    const received = Buffer.from(headerToken);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      void reply.code(403).send({ error: "csrf_failed" });
      return false;
    }

    return true;
  }

  async function getAuthenticatedUserId(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<string | undefined> {
    if (authMode === "fixture") {
      // Fixture mode is dev/test only. An optional `sa_fixture_user` cookie lets a
      // browser test partition own its progression (each isolated test drives a
      // pristine learner from the seeded pool) without touching real auth. Only
      // known pool ids are honoured; anything else falls back to the seed user.
      const requested = readCookie(request.headers.cookie, "sa_fixture_user");
      if (requested && /^browser-e2e-\d{2}$/.test(requested)) {
        return requested;
      }
      return userId;
    }

    const sessionToken = readSessionToken(request.headers.cookie);
    if (!sessionToken) {
      void reply.code(401).send({ error: "auth_required" });
      return undefined;
    }

    const session = await persistence.getActiveAuthSession(
      hashSessionToken(sessionToken),
      new Date(now()).toISOString()
    );
    if (!session) {
      void reply.code(401).send({ error: "auth_required" });
      return undefined;
    }

    return session.userId;
  }

  server.post<{ Body: unknown }>("/api/v1/auth/telegram", async (request, reply) => {
    const rateLimit = rateLimitStore.consume(
      `auth:telegram:${request.ip}`,
      authRateLimitPerMinute,
      authRateLimitWindowMs,
      now()
    );
    if (!rateLimit.allowed) {
      reply.header("retry-after", rateLimit.retryAfterSeconds);
      return reply.code(429).send({ error: "rate_limited" });
    }

    if (!options.telegramBotToken) {
      return reply.code(503).send({ error: "auth_not_configured" });
    }

    const parsedRequest = TelegramAuthRequestSchema.safeParse(request.body);
    if (!parsedRequest.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    try {
      const verified = await verifyTelegramInitDataAsync(parsedRequest.data.initData, {
        botToken: options.telegramBotToken,
        nowMs: now(),
        replayGuard: {
          consume: (key, expiresAtMs) => persistence.consumeAuthReplayKey(
            key,
            expiresAtMs,
            now()
          )
        }
      });
      const internalUser = await persistence.getOrCreateUserForIdentity({
        provider: "telegram",
        providerUserId: verified.identity.providerUserId
      });
      const sessionToken = randomBytes(32).toString("base64url");
      const csrfToken = randomBytes(32).toString("base64url");
      const createdAt = new Date(now()).toISOString();
      const expiresAt = new Date(now() + sessionTtlSeconds * 1_000).toISOString();

      await persistence.createAuthSession({
        sessionId: randomUUID(),
        userId: internalUser.userId,
        tokenHash: hashSessionToken(sessionToken),
        createdAt,
        expiresAt
      });

      reply.header("set-cookie", [
        serializeSessionCookie(sessionToken, sessionTtlSeconds, sessionSecure),
        serializeCsrfCookie(csrfToken, sessionTtlSeconds, sessionSecure)
      ]);
      return reply.code(201).send({
        data: {
          identity: verified.identity,
          sessionExpiresAt: expiresAt
        }
      });
    } catch (error) {
      if (error instanceof TelegramAuthError) {
        return reply.code(401).send({ error: error.code });
      }
      return reply.code(500).send({ error: "auth_failed" });
    }
  });

  server.post("/api/v1/auth/logout", async (request, reply) => {
    const sessionToken = readSessionToken(request.headers.cookie);
    if (sessionToken && !requireCsrf(request, reply)) {
      return;
    }
    if (sessionToken) {
      const session = await persistence.getActiveAuthSession(
        hashSessionToken(sessionToken),
        new Date(now()).toISOString()
      );
      if (session) {
        await persistence.revokeAuthSession(session.sessionId, new Date(now()).toISOString());
      }
    }

    reply.header("set-cookie", [
      serializeSessionCookie("", 0, sessionSecure),
      serializeCsrfCookie("", 0, sessionSecure)
    ]);
    return reply.code(204).send();
  });

  server.get("/health", async () => ({
    status: "ok",
    service: "api-server"
  }));

  // Self-scoped identity read for the client vertical slice: returns only the
  // authenticated user id. Non-mutating, exposes no balances or hidden state.
  server.get("/api/v1/auth/me", async (request, reply) => {
    const authenticatedUserId = await getAuthenticatedUserId(request, reply);
    if (!authenticatedUserId) {
      return;
    }
    return { data: { userId: authenticatedUserId } };
  });

  server.get("/ready", async (_request, reply) => {
    try {
      await readinessCheck();
      return { status: "ready", service: "api-server" };
    } catch {
      return reply.code(503).send({ status: "not_ready", service: "api-server" });
    }
  });

  server.get<{
    Params: { scenarioId: string };
    Querystring: { version?: string };
  }>(
    "/api/v1/scenarios/:scenarioId",
    async (request, reply) => {
      if (!(await getAuthenticatedUserId(request, reply))) {
        return;
      }

      const version = request.query.version ?? starterScenario.version;
      const scenario = await persistence.getScenarioPackage(request.params.scenarioId, version);

      if (!scenario) {
        return reply.code(404).send({ error: "scenario_not_found" });
      }

      return {
        data: toPublicScenarioProjection(scenario)
      };
    }
  );

  server.post<{
    Body: unknown;
  }>("/api/v1/scenario-runs", async (request, reply) => {
    const authenticatedUserId = await getAuthenticatedUserId(request, reply);
    if (!authenticatedUserId || !requireCsrf(request, reply)) {
      return;
    }

    const parsed = ScenarioRunStartRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        issues: parsed.error.issues
      });
    }

    const scenario = await persistence.getScenarioPackage(
      parsed.data.scenarioId,
      parsed.data.scenarioVersion
    );
    if (!scenario) {
      return reply.code(404).send({ error: "scenario_not_found" });
    }

    try {
      const result = await persistence.startEligibleScenarioRun({
        runId: randomUUID(),
        userId: authenticatedUserId,
        scenarioId: parsed.data.scenarioId,
        scenarioVersion: parsed.data.scenarioVersion,
        scenarioMode: scenario.mode,
        idempotencyKey: parsed.data.idempotencyKey
      });

      if (!result.run) {
        return reply.code(409).send({
          error: "insufficient_energy",
          energy: result.state.energy,
          required: 1
        });
      }

      return reply.code(201).send({
        data: {
          run: toRunResponse(result.run),
          scenario: toPublicScenarioProjection(scenario),
          energySpent: result.energySpent,
          balance: result.state
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "scenario_run_failed";
      return reply.code(409).send({ error: "scenario_run_conflict", message });
    }
  });

  server.post<{
    Params: { runId: string };
    Body: unknown;
  }>("/api/v1/scenario-runs/:runId/seal", async (request, reply) => {
    const authenticatedUserId = await getAuthenticatedUserId(request, reply);
    if (!authenticatedUserId || !requireCsrf(request, reply)) {
      return;
    }

    const decision = DecisionTraceSchema.safeParse(request.body);
    if (!decision.success) {
      return reply.code(400).send({
        error: "invalid_decision",
        issues: decision.error.issues
      });
    }

    const current = await persistence.getScenarioRun(request.params.runId, authenticatedUserId);
    if (!current) {
      return reply.code(404).send({ error: "scenario_run_not_found" });
    }

    const scenario = await persistence.getScenarioPackage(
      current.scenarioId,
      current.scenarioVersion
    );
    if (!scenario) {
      return reply.code(500).send({ error: "scenario_package_missing" });
    }

    try {
      assertDecisionTraceAllowed(scenario, decision.data);
      const score = evaluateFoundationDecision(scenario, decision.data);
      const sealed = await persistence.sealScenarioRun(
        request.params.runId,
        authenticatedUserId,
        decision.data,
        score
      );

      return {
        data: {
          run: toRunResponse(sealed)
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "scenario_seal_failed";
      const statusCode = message.includes("already sealed") ? 409 : 422;
      return reply.code(statusCode).send({
        error: statusCode === 409 ? "scenario_run_already_sealed" : "invalid_decision",
        message
      });
    }
  });

  server.get<{
    Params: { runId: string };
  }>("/api/v1/scenario-runs/:runId/reveal", async (request, reply) => {
    const authenticatedUserId = await getAuthenticatedUserId(request, reply);
    if (!authenticatedUserId) {
      return;
    }

    const current = await persistence.getScenarioRun(request.params.runId, authenticatedUserId);
    if (!current) {
      return reply.code(404).send({ error: "scenario_run_not_found" });
    }

    if (current.state === "started") {
      return reply.code(409).send({ error: "scenario_run_not_sealed" });
    }

    const scenario = await persistence.getScenarioPackage(
      current.scenarioId,
      current.scenarioVersion
    );
    if (!scenario) {
      return reply.code(500).send({ error: "scenario_package_missing" });
    }

    const revealed = await persistence.revealScenarioRun(request.params.runId, authenticatedUserId);
    return {
      data: {
        run: toRunResponse(revealed, true),
        reveal: toScenarioRevealProjection(scenario)
      }
    };
  });

  // Read-only run fetch (non-mutating) so a client reload can restore the
  // authoritative run state. The Quality Score is only surfaced once the run is
  // revealed or completed — never while it is merely sealed.
  server.get<{
    Params: { runId: string };
  }>("/api/v1/scenario-runs/:runId", async (request, reply) => {
    const authenticatedUserId = await getAuthenticatedUserId(request, reply);
    if (!authenticatedUserId) {
      return;
    }
    const current = await persistence.getScenarioRun(request.params.runId, authenticatedUserId);
    if (!current) {
      return reply.code(404).send({ error: "scenario_run_not_found" });
    }
    const scoreVisible = current.state === "revealed" || current.state === "completed";
    return {
      data: {
        run: toRunResponse(current, scoreVisible),
        sealed: Boolean(current.score) && !scoreVisible
      }
    };
  });

  // Economy reads are authenticated and self-scoped: a session may only read
  // its own economy state, and GET routes never mutate the ledger.
  server.get<{
    Params: { userId: string };
  }>("/api/v1/users/:userId/balance", async (request, reply) => {
    const authenticatedUserId = await getAuthenticatedUserId(request, reply);
    if (!authenticatedUserId) {
      return;
    }
    if (request.params.userId !== authenticatedUserId) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const state = await persistence.projectEconomyState(authenticatedUserId);
    return { data: state };
  });

  server.get<{
    Params: { userId: string };
    Querystring: { limit?: string; after?: string };
  }>("/api/v1/users/:userId/ledger", async (request, reply) => {
    const authenticatedUserId = await getAuthenticatedUserId(request, reply);
    if (!authenticatedUserId) {
      return;
    }
    if (request.params.userId !== authenticatedUserId) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const options: { limit?: number; after?: string } = {};
    if (request.query.limit !== undefined) {
      const parsed = Number.parseInt(request.query.limit, 10);
      if (!Number.isNaN(parsed)) {
        options.limit = parsed;
      }
    }
    if (request.query.after !== undefined) {
      options.after = request.query.after;
    }
    const page = await persistence.listLedgerEvents(authenticatedUserId, options);
    return { data: page };
  });

  // Reward grant is a POST (never a GET) and is idempotent per run id: a
  // repeated call returns the same balance without a second ledger event.
  server.post<{
    Params: { runId: string };
  }>("/api/v1/scenario-runs/:runId/rewards", async (request, reply) => {
    const authenticatedUserId = await getAuthenticatedUserId(request, reply);
    if (!authenticatedUserId || !requireCsrf(request, reply)) {
      return;
    }

    const run = await persistence.getScenarioRun(request.params.runId, authenticatedUserId);
    if (!run) {
      return reply.code(404).send({ error: "scenario_run_not_found" });
    }
    if (run.state === "started" || !run.score) {
      return reply.code(409).send({ error: "scenario_run_not_sealed" });
    }

    const { xpGranted, masteryDelta, granted, state } =
      await persistence.applyScenarioCompletionRewards({
        userId: authenticatedUserId,
        runId: run.runId,
        scenarioId: run.scenarioId,
        scenarioVersion: run.scenarioVersion,
        qualityScore: run.score.score,
        breakdown: {
          protocol_adherence: run.score.breakdown.protocol_adherence,
          discipline: run.score.breakdown.discipline
        }
      });

    return {
      data: {
        granted,
        xpGranted,
        masteryDelta,
        balance: state
      }
    };
  });

  // --- Academy Level 0: server-authoritative Challenge Test flow (Phase 2) ----
  //
  // Guardrail under test here: clicking "Я это знаю — проверить" only OPENS a
  // Challenge Test (starts a free, exam-mode run and records an open attempt);
  // it never moves progression. Only the /verify step — which re-scores a
  // sealed, server-owned decision against server-resolved criteria — can move a
  // module to `verified`. A failed challenge returns the learner to `learning`
  // with no penalty.

  server.post<{
    Params: { moduleId: string };
    Body: unknown;
  }>("/api/v1/academy/modules/:moduleId/challenge", async (request, reply) => {
    const authenticatedUserId = await getAuthenticatedUserId(request, reply);
    if (!authenticatedUserId || !requireCsrf(request, reply)) {
      return;
    }

    const module = academyModulesById.get(request.params.moduleId);
    if (!module) {
      return reply.code(404).send({ error: "module_not_found" });
    }
    const challenge = academyChallengesById.get(module.challengeDefinitionId);
    if (!challenge) {
      return reply.code(500).send({ error: "challenge_definition_missing" });
    }

    const parsed = AcademyChallengeStartRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    }
    if (!challenge.scenarioIds.includes(parsed.data.scenarioId)) {
      return reply.code(400).send({ error: "scenario_not_in_challenge" });
    }
    const scenario = academyScenariosById.get(parsed.data.scenarioId);
    if (!scenario) {
      return reply.code(500).send({ error: "scenario_package_missing" });
    }

    try {
      const started = await persistence.startEligibleScenarioRun({
        runId: randomUUID(),
        userId: authenticatedUserId,
        scenarioId: scenario.scenarioId,
        scenarioVersion: scenario.version,
        scenarioMode: scenario.mode,
        idempotencyKey: parsed.data.idempotencyKey
      });
      if (!started.run) {
        return reply.code(409).send({
          error: "insufficient_energy",
          energy: started.state.energy,
          required: 1
        });
      }

      const attempt = await persistence.createLearningAttempt({
        attemptId: randomUUID(),
        userId: authenticatedUserId,
        moduleId: module.moduleId,
        moduleVersion: module.version,
        attemptType: "challenge",
        scenarioId: scenario.scenarioId,
        scenarioVersion: scenario.version,
        runId: started.run.runId
      });

      // NOTE: progression is deliberately untouched here — opening is not passing.
      return reply.code(201).send({
        data: {
          attempt,
          run: toRunResponse(started.run),
          module: { moduleId: module.moduleId, version: module.version }
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "academy_challenge_failed";
      return reply.code(409).send({ error: "academy_challenge_conflict", message });
    }
  });

  server.post<{
    Params: { moduleId: string };
    Body: unknown;
  }>("/api/v1/academy/modules/:moduleId/transfer", async (request, reply) => {
    const authenticatedUserId = await getAuthenticatedUserId(request, reply);
    if (!authenticatedUserId || !requireCsrf(request, reply)) {
      return;
    }

    const module = academyModulesById.get(request.params.moduleId);
    if (!module) {
      return reply.code(404).send({ error: "module_not_found" });
    }

    // An Arena Transfer is only available once the topic is server-verified, and
    // it is the *next* step toward mastery — never a replacement for verification.
    const current = await persistence.getModuleProgress(
      authenticatedUserId,
      module.moduleId,
      module.version
    );
    if ((current?.status ?? "available") !== "verified") {
      return reply.code(409).send({ error: "transfer_not_available", status: current?.status ?? "available" });
    }

    const parsed = AcademyChallengeStartRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    }
    if (!module.transferScenarioIds.includes(parsed.data.scenarioId)) {
      return reply.code(400).send({ error: "scenario_not_in_transfer" });
    }
    const scenario = academyScenariosById.get(parsed.data.scenarioId);
    if (!scenario) {
      return reply.code(500).send({ error: "scenario_package_missing" });
    }

    try {
      const started = await persistence.startEligibleScenarioRun({
        runId: randomUUID(),
        userId: authenticatedUserId,
        scenarioId: scenario.scenarioId,
        scenarioVersion: scenario.version,
        scenarioMode: scenario.mode,
        idempotencyKey: parsed.data.idempotencyKey
      });
      if (!started.run) {
        return reply.code(409).send({
          error: "insufficient_energy",
          energy: started.state.energy,
          required: 1
        });
      }

      const attempt = await persistence.createLearningAttempt({
        attemptId: randomUUID(),
        userId: authenticatedUserId,
        moduleId: module.moduleId,
        moduleVersion: module.version,
        attemptType: "transfer",
        scenarioId: scenario.scenarioId,
        scenarioVersion: scenario.version,
        runId: started.run.runId
      });

      const nextStatus = nextLearningStatus(current!.status, { type: "transfer_opened" });
      const progress = await persistence.upsertModuleProgress({
        userId: authenticatedUserId,
        moduleId: module.moduleId,
        moduleVersion: module.version,
        status: nextStatus,
        startedAt: new Date(now()).toISOString(),
        verifiedAt: null,
        masteredAt: null,
        reviewDueAt: null,
        verificationSource: null,
        bestScore: current!.bestScore
      });

      return reply.code(201).send({
        data: {
          attempt,
          run: toRunResponse(started.run),
          progress: { moduleId: module.moduleId, status: progress.status }
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "academy_transfer_failed";
      return reply.code(409).send({ error: "academy_transfer_conflict", message });
    }
  });

  server.post<{
    Params: { attemptId: string };
  }>("/api/v1/academy/attempts/:attemptId/verify", async (request, reply) => {
    const authenticatedUserId = await getAuthenticatedUserId(request, reply);
    if (!authenticatedUserId || !requireCsrf(request, reply)) {
      return;
    }

    const attempt = await persistence.getLearningAttempt(request.params.attemptId, authenticatedUserId);
    if (!attempt) {
      return reply.code(404).send({ error: "learning_attempt_not_found" });
    }

    // Idempotent: a re-verified attempt returns its stored verdict unchanged.
    if (attempt.status !== "started") {
      return { data: { attempt, verification: attempt.result ?? null } };
    }

    if (!attempt.runId) {
      return reply.code(409).send({ error: "learning_attempt_not_linked_to_run" });
    }
    const run = await persistence.getScenarioRun(attempt.runId, authenticatedUserId);
    if (!run) {
      return reply.code(404).send({ error: "scenario_run_not_found" });
    }
    if (run.state === "started" || !run.score || !run.decision) {
      return reply.code(409).send({ error: "scenario_run_not_sealed" });
    }

    const module = academyModulesById.get(attempt.moduleId);
    const challenge = module ? academyChallengesById.get(module.challengeDefinitionId) : undefined;
    if (!module || !challenge) {
      return reply.code(500).send({ error: "academy_content_missing" });
    }

    // Provisional ordering signal until Decision Telemetry (Phase 3) records the
    // real authoring order: the sealed snapshot only proves the invalidation was
    // *present*, so we treat presence as the stand-in for before-action here.
    const verification = evaluateChallengeVerification({
      criteria: challenge.passCriteria,
      requiredGates: challenge.criticalGates,
      decision: run.decision,
      score: run.score,
      invalidationBeforeAction: run.decision.invalidation.trim().length > 0
    });

    const current = await persistence.getModuleProgress(
      authenticatedUserId,
      module.moduleId,
      module.version
    );
    const currentStatus = current?.status ?? "available";
    const isTransfer = attempt.attemptType === "transfer";

    // A Challenge Test verifies a topic (→ verified). An Arena Transfer only moves
    // an already-verified topic to provisional mastery (→ review_due): the state
    // machine never routes a single test straight to `mastered`, which is reached
    // only by a later delayed rematch (Phase 6 guardrail). A failed transfer keeps
    // the topic in `transfer_pending` so the learner can retry without penalty.
    const nextStatus = verification.verified
      ? nextLearningStatus(
          currentStatus,
          isTransfer
            ? { type: "transfer_passed" }
            : { type: "challenge_passed", source: "challenge_out" }
        )
      : isTransfer
        ? currentStatus
        : nextLearningStatus(currentStatus, { type: "challenge_failed" });

    const verificationSource = isTransfer ? "arena_transfer" : "challenge_out";
    const timestamp = new Date(now()).toISOString();

    const progress = await persistence.upsertModuleProgress({
      userId: authenticatedUserId,
      moduleId: module.moduleId,
      moduleVersion: module.version,
      status: nextStatus,
      startedAt: timestamp,
      verifiedAt: verification.verified && !isTransfer ? timestamp : null,
      masteredAt: null,
      reviewDueAt: null,
      verificationSource: verification.verified && !isTransfer ? verificationSource : null,
      bestScore: verification.qualityScore
    });

    const verdict = {
      verified: verification.verified,
      qualityScore: verification.qualityScore,
      satisfiedGates: verification.satisfiedGates,
      failedGates: verification.failedGates,
      reasons: verification.reasons,
      status: nextStatus,
      attemptType: attempt.attemptType
    };

    await persistence.finalizeLearningAttempt({
      attemptId: attempt.attemptId,
      userId: authenticatedUserId,
      status: verification.verified ? "verified" : "failed",
      result: verdict
    });

    return {
      data: {
        verification: verdict,
        progress: {
          moduleId: module.moduleId,
          status: progress.status,
          bestScore: progress.bestScore,
          verifiedAt: progress.verifiedAt
        }
      }
    };
  });

  // Read-only, self-scoped module state so the client can render an
  // authoritative status without ever computing it. No hidden scenario data.
  server.get<{
    Params: { moduleId: string };
  }>("/api/v1/academy/modules/:moduleId", async (request, reply) => {
    const authenticatedUserId = await getAuthenticatedUserId(request, reply);
    if (!authenticatedUserId) {
      return;
    }

    const module = academyModulesById.get(request.params.moduleId);
    if (!module) {
      return reply.code(404).send({ error: "module_not_found" });
    }
    const challenge = academyChallengesById.get(module.challengeDefinitionId);
    const lessons = module.lessonIds
      .map((lessonId) => academyLessonsById.get(lessonId))
      .filter((lesson): lesson is Lesson => Boolean(lesson));
    const progress = await persistence.getModuleProgress(
      authenticatedUserId,
      module.moduleId,
      module.version
    );

    return {
      data: {
        module: {
          moduleId: module.moduleId,
          version: module.version,
          title: module.title,
          level: module.level,
          challengeScenarioIds: challenge?.scenarioIds ?? [],
          transferScenarioIds: module.transferScenarioIds
        },
        status: progress?.status ?? "available",
        bestScore: progress?.bestScore ?? 0,
        verifiedAt: progress?.verifiedAt ?? null,
        verificationSource: progress?.verificationSource ?? null,
        // Published, non-sensitive curriculum the client renders verbatim. It is
        // authored content, never hidden/future scenario truth, and the client
        // does not use it to compute status or mastery (that stays server-side).
        lessons,
        challenge: challenge
          ? {
              challengeDefinitionId: challenge.challengeDefinitionId,
              scenarioIds: challenge.scenarioIds,
              passCriteria: challenge.passCriteria
            }
          : null
      }
    };
  });

  // --- Decision Telemetry v1 (Phase 3): observational ingest + timeline read ---
  //
  // Ingest is authenticated, self-scoped, bounded, and idempotent by eventId.
  // The server stamps receipt time and stores the actor from the session, so a
  // client cannot forge attribution or replay a batch into duplicates. These
  // routes never touch score, economy, or scenario truth.
  server.post<{ Body: unknown }>("/api/v1/telemetry/events", async (request, reply) => {
    const authenticatedUserId = await getAuthenticatedUserId(request, reply);
    if (!authenticatedUserId || !requireCsrf(request, reply)) {
      return;
    }

    const parsed = TelemetryIngestRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    }

    const serverReceivedAt = new Date(now()).toISOString();
    const records: DecisionEventRecord[] = parsed.data.events.map((event) => ({
      eventId: event.eventId,
      userId: authenticatedUserId,
      sessionId: event.sessionId,
      eventType: event.eventType,
      eventVersion: event.eventVersion,
      sequence: event.sequence,
      occurredAt: event.occurredAt,
      serverReceivedAt,
      clientElapsedMs: event.clientElapsedMs,
      runId: event.runId ?? null,
      scenarioId: event.scenarioId ?? null,
      scenarioVersion: event.scenarioVersion ?? null,
      moduleId: event.moduleId ?? null,
      skillIds: event.skillIds ?? [],
      payload: event.payload
    }));

    const result = await persistence.appendDecisionEvents(records);
    return reply.code(202).send({
      data: { accepted: result.accepted, duplicates: result.duplicates }
    });
  });

  // A single run reconstructs as an ordered timeline, scoped to the caller.
  server.get<{
    Params: { runId: string };
  }>("/api/v1/telemetry/runs/:runId/timeline", async (request, reply) => {
    const authenticatedUserId = await getAuthenticatedUserId(request, reply);
    if (!authenticatedUserId) {
      return;
    }

    const events = await persistence.listDecisionEventsByRun(
      authenticatedUserId,
      request.params.runId
    );
    return {
      data: {
        runId: request.params.runId,
        events: events.map((event) => ({
          eventId: event.eventId,
          eventType: event.eventType,
          sequence: event.sequence,
          occurredAt: event.occurredAt,
          serverReceivedAt: event.serverReceivedAt,
          clientElapsedMs: event.clientElapsedMs,
          payload: event.payload
        }))
      }
    };
  });

  return server;
}
