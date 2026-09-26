// Client data layer for the Iteration 03 vertical slice.
//
// This module is the ONLY place the playable client talks to the server. It
// never computes a score, never mutates a balance, and never reads hidden or
// future truth: every value comes from the API and is validated against the
// shared contracts (`packages/contracts`). Requests are server-authoritative and
// idempotent per run.

import {
  DecisionTraceSchema,
  LedgerEventSchema,
  ScenarioPublicProjectionSchema,
  ScenarioRevealProjectionSchema,
  ScoreResultSchema,
  UserEconomyStateSchema,
  type DecisionTrace,
  type LedgerEvent,
  type Lesson,
  type LearningStatus,
  type ScenarioPublicProjection,
  type ScenarioRevealProjection,
  type ScoreResult,
  type UserEconomyState
} from "@signal-arena/contracts";

// All requests are same-origin (`/api/...`); the dev server proxies them to the
// API. There is no hard-coded host, so the same client works behind any proxy.
const API_BASE = "/api/v1";

type Envelope<T> = { data: T };
type ErrorBody = { error: string; message?: string };

export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  constructor(code: string, status: number, message?: string) {
    super(message ?? code);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
  parse: (value: unknown) => T
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: init.method,
    credentials: "same-origin",
    headers: init.body === undefined ? {} : { "content-type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) })
  });

  if (response.status === 204) {
    return parse(undefined) as T;
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorBody = (payload ?? {}) as ErrorBody;
    throw new ApiError(errorBody.error ?? "request_failed", response.status, errorBody.message);
  }
  return parse((payload as Envelope<T>).data);
}

function unwrapEnvelope<T>(schema: (value: unknown) => T) {
  return (value: unknown): T => schema(value);
}

export type RunResponse = {
  runId: string;
  scenarioId: string;
  scenarioVersion: string;
  state: "started" | "sealed" | "revealed" | "completed";
  createdAt: string;
  sealedAt: string | null;
  revealedAt: string | null;
  completedAt: string | null;
  decision?: DecisionTrace;
  score?: ScoreResult;
};

export type StartRunResult = {
  run: RunResponse;
  scenario: ScenarioPublicProjection;
  energySpent: number;
  balance: UserEconomyState;
};

export type RewardResult = {
  granted: boolean;
  xpGranted: number;
  masteryDelta: number;
  balance: UserEconomyState;
};

// --- Academy (Iteration 04 Phase 5) ---------------------------------------
// Every value below is a read of server-authored content + server-computed
// progression. The client renders it verbatim; it never derives status,
// verification, or mastery locally.

export type AcademyModuleState = {
  module: {
    moduleId: string;
    version: string;
    title: string;
    level: number;
    challengeScenarioIds: string[];
    transferScenarioIds: string[];
  };
  status: LearningStatus;
  bestScore: number;
  verifiedAt: string | null;
  verificationSource: string | null;
  lessons: Lesson[];
  challenge: {
    challengeDefinitionId: string;
    scenarioIds: string[];
  } | null;
};

export type AcademyChallengeStart = {
  attempt: {
    attemptId: string;
    moduleId: string;
    scenarioId: string;
    runId: string | null;
    status: string;
  };
  run: RunResponse;
};

export type AcademyVerification = {
  verified: boolean;
  qualityScore: number;
  satisfiedGates: string[];
  failedGates: string[];
  reasons: string[];
  status: LearningStatus;
  attemptType?: "guided_practice" | "challenge" | "transfer" | "rematch";
};

export type AcademyVerifyResult = {
  verification: AcademyVerification;
  progress: {
    moduleId: string;
    status: LearningStatus;
    bestScore: number;
    verifiedAt: string | null;
  };
};

function parseRun(value: unknown): RunResponse {
  const record = value as Record<string, unknown>;
  const runId = record.runId;
  const state = record.state;
  if (typeof runId !== "string" || typeof state !== "string") {
    throw new ApiError("malformed_run", 500);
  }
  return {
    runId,
    scenarioId: String(record.scenarioId),
    scenarioVersion: String(record.scenarioVersion),
    state: state as RunResponse["state"],
    createdAt: String(record.createdAt),
    sealedAt: (record.sealedAt as string | null) ?? null,
    revealedAt: (record.revealedAt as string | null) ?? null,
    completedAt: (record.completedAt as string | null) ?? null,
    ...(record.decision
      ? { decision: DecisionTraceSchema.parse(record.decision) }
      : {}),
    ...(record.score ? { score: ScoreResultSchema.parse(record.score) } : {})
  };
}

export const api = {
  me(): Promise<{ userId: string }> {
    return request(
      "/auth/me",
      { method: "GET" },
      (value) => value as { userId: string }
    );
  },

  getScenario(scenarioId: string, version?: string): Promise<ScenarioPublicProjection> {
    const query = version ? `?version=${encodeURIComponent(version)}` : "";
    return request(
      `/scenarios/${encodeURIComponent(scenarioId)}${query}`,
      { method: "GET" },
      unwrapEnvelope((v) => ScenarioPublicProjectionSchema.parse(v))
    );
  },

  startRun(input: {
    scenarioId: string;
    scenarioVersion: string;
    idempotencyKey: string;
  }): Promise<StartRunResult> {
    return request(
      "/scenario-runs",
      { method: "POST", body: input },
      (value) => {
        const envelope = value as {
          run: unknown;
          scenario: unknown;
          energySpent: number;
          balance: unknown;
        };
        return {
          run: parseRun(envelope.run),
          scenario: ScenarioPublicProjectionSchema.parse(envelope.scenario),
          energySpent: envelope.energySpent,
          balance: UserEconomyStateSchema.parse(envelope.balance)
        };
      }
    );
  },

  getRun(runId: string): Promise<{ run: RunResponse; sealed: boolean }> {
    return request(
      `/scenario-runs/${encodeURIComponent(runId)}`,
      { method: "GET" },
      (value) => {
        const envelope = value as { run: unknown; sealed: boolean };
        return { run: parseRun(envelope.run), sealed: envelope.sealed };
      }
    );
  },

  sealRun(runId: string, decision: DecisionTrace): Promise<{ run: RunResponse }> {
    // Validate the request against the shared contract before sending it.
    const body = DecisionTraceSchema.parse(decision);
    return request(
      `/scenario-runs/${encodeURIComponent(runId)}/seal`,
      { method: "POST", body },
      (value) => {
        const envelope = value as { run: unknown };
        return { run: parseRun(envelope.run) };
      }
    );
  },

  revealRun(
    runId: string
  ): Promise<{ run: RunResponse; reveal: ScenarioRevealProjection }> {
    return request(
      `/scenario-runs/${encodeURIComponent(runId)}/reveal`,
      { method: "GET" },
      (value) => {
        const envelope = value as { run: unknown; reveal: unknown };
        return {
          run: parseRun(envelope.run),
          reveal: ScenarioRevealProjectionSchema.parse(envelope.reveal)
        };
      }
    );
  },

  claimRewards(runId: string): Promise<RewardResult> {
    return request(
      `/scenario-runs/${encodeURIComponent(runId)}/rewards`,
      { method: "POST" },
      (value) => {
        const envelope = value as {
          granted: boolean;
          xpGranted: number;
          masteryDelta: number;
          balance: unknown;
        };
        return {
          granted: envelope.granted,
          xpGranted: envelope.xpGranted,
          masteryDelta: envelope.masteryDelta,
          balance: UserEconomyStateSchema.parse(envelope.balance)
        };
      }
    );
  },

  getBalance(userId: string): Promise<UserEconomyState> {
    return request(
      `/users/${encodeURIComponent(userId)}/balance`,
      { method: "GET" },
      unwrapEnvelope((v) => UserEconomyStateSchema.parse(v))
    );
  },

  // --- Academy (server-authored content + server-computed progression) ------

  getModuleState(moduleId: string): Promise<AcademyModuleState> {
    return request(
      `/academy/modules/${encodeURIComponent(moduleId)}`,
      { method: "GET" },
      (value) => value as AcademyModuleState
    );
  },

  startChallenge(
    moduleId: string,
    input: { scenarioId: string; idempotencyKey: string }
  ): Promise<AcademyChallengeStart> {
    return request(
      `/academy/modules/${encodeURIComponent(moduleId)}/challenge`,
      { method: "POST", body: input },
      (value) => {
        const envelope = value as { attempt: unknown; run: unknown };
        return {
          attempt: envelope.attempt as AcademyChallengeStart["attempt"],
          run: parseRun(envelope.run)
        };
      }
    );
  },

  verifyAttempt(attemptId: string): Promise<AcademyVerifyResult> {
    return request(
      `/academy/attempts/${encodeURIComponent(attemptId)}/verify`,
      { method: "POST" },
      (value) => value as AcademyVerifyResult
    );
  },

  startTransfer(
    moduleId: string,
    input: { scenarioId: string; idempotencyKey: string }
  ): Promise<AcademyChallengeStart> {
    return request(
      `/academy/modules/${encodeURIComponent(moduleId)}/transfer`,
      { method: "POST", body: input },
      (value) => {
        const envelope = value as { attempt: unknown; run: unknown };
        return {
          attempt: envelope.attempt as AcademyChallengeStart["attempt"],
          run: parseRun(envelope.run)
        };
      }
    );
  },

  listLedger(userId: string): Promise<{ events: LedgerEvent[]; nextCursor: string | null }> {
    return request(
      `/users/${encodeURIComponent(userId)}/ledger`,
      { method: "GET" },
      unwrapEnvelope((v) => {
        const page = v as { events: unknown[]; nextCursor: string | null };
        return {
          events: page.events.map((event) => LedgerEventSchema.parse(event)),
          nextCursor: page.nextCursor
        };
      })
    );
  }
};

export type { LedgerEvent };
