import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  DecisionTraceSchema,
  HistoricalMarketSnapshotSchema,
  ScenarioPackageSchema,
  ScoreResultSchema,
  type DecisionTrace,
  type HistoricalMarketSnapshot,
  type ScenarioPackage,
  type ScoreResult
} from "../../contracts/src/index.js";
import {
  KIND_ASSET,
  LedgerEventSchema,
  UserEconomyStateSchema,
  type LedgerAsset,
  type LedgerEvent,
  type LedgerEventKind,
  type LedgerPage,
  type RiskState,
  type UserEconomyState
} from "../../contracts/src/economy.js";
import {
  applyEnergyRegen,
  energyCostForMode,
  keyConditionsMetForBreakdown,
  masteryStarsForScore,
  xpForCompletion,
  xpGrantedAfterDailyCap,
  XP_REPEAT_WINDOW_MS
} from "../../domain/src/economy.js";
import {
  AcademyModuleSchema,
  type AcademyModule,
  type LearningPublicationStatus,
  type LearningStatus,
  type VerificationSource
} from "../../contracts/src/learning.js";
import type {
  DecisionEventType,
  TelemetryPayload
} from "../../contracts/src/telemetry.js";
import type { DatabaseHandle } from "./database.js";

export type ScenarioRunState = "started" | "sealed" | "revealed" | "completed";

export type HistoricalSnapshotRecord = {
  snapshotId: string;
  provider: "binance";
  symbol: string;
  interval: string;
  asOf: string;
  contentHash: string;
  snapshot: HistoricalMarketSnapshot;
  createdAt: string;
};

export type CreateScenarioRunInput = {
  runId: string;
  userId: string;
  scenarioId: string;
  scenarioVersion: string;
  idempotencyKey: string;
};

export type PlatformProvider = "telegram" | "base" | "minipay" | "solana";

export type PlatformIdentityInput = {
  provider: PlatformProvider;
  providerUserId: string;
};

export type CreateAuthSessionInput = {
  sessionId: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
};

export type AuthSessionRecord = CreateAuthSessionInput & {
  revokedAt: string | null;
};

export type ScenarioRunRecord = CreateScenarioRunInput & {
  state: ScenarioRunState;
  decision: DecisionTrace | null;
  score: ScoreResult | null;
  createdAt: string;
  sealedAt: string | null;
  revealedAt: string | null;
  completedAt: string | null;
};

function parseJson(value: string | null): unknown | null {
  return value === null ? null : JSON.parse(value) as unknown;
}

function readScenarioRunRow(row: {
  runId: string;
  userId: string;
  scenarioId: string;
  scenarioVersion: string;
  state: ScenarioRunState;
  idempotencyKey: string;
  decisionJson: string | null;
  scoreJson: string | null;
  createdAt: string;
  sealedAt: string | null;
  revealedAt: string | null;
  completedAt: string | null;
}): ScenarioRunRecord {
  return {
    runId: row.runId,
    userId: row.userId,
    scenarioId: row.scenarioId,
    scenarioVersion: row.scenarioVersion,
    state: row.state,
    idempotencyKey: row.idempotencyKey,
    decision: row.decisionJson === null
      ? null
      : DecisionTraceSchema.parse(parseJson(row.decisionJson)),
    score: row.scoreJson === null
      ? null
      : ScoreResultSchema.parse(parseJson(row.scoreJson)),
    createdAt: row.createdAt,
    sealedAt: row.sealedAt,
    revealedAt: row.revealedAt,
    completedAt: row.completedAt
  };
}

export function getOrCreateUserForIdentity(
  { sqlite }: DatabaseHandle,
  input: PlatformIdentityInput
): { userId: string; created: boolean } {
  const transaction = sqlite.transaction(() => {
    const existingIdentity = sqlite.prepare(`
      SELECT user_id AS userId
      FROM user_identities
      WHERE provider = ? AND provider_user_id = ?
    `).get(input.provider, input.providerUserId) as { userId: string } | undefined;

    if (existingIdentity) {
      return { userId: existingIdentity.userId, created: false };
    }

    const externalId = `${input.provider}:${input.providerUserId}`;
    const existingUser = sqlite.prepare(`
      SELECT user_id AS userId
      FROM users
      WHERE external_id = ?
    `).get(externalId) as { userId: string } | undefined;
    const userId = existingUser?.userId ?? randomUUID();
    const createdAt = new Date().toISOString();

    sqlite.prepare(`
      INSERT INTO users (user_id, external_id, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(external_id) DO NOTHING
    `).run(userId, externalId, createdAt);

    sqlite.prepare(`
      INSERT INTO user_identities (
        identity_id,
        user_id,
        provider,
        provider_user_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(provider, provider_user_id) DO NOTHING
    `).run(randomUUID(), userId, input.provider, input.providerUserId, createdAt);

    const identity = sqlite.prepare(`
      SELECT user_id AS userId
      FROM user_identities
      WHERE provider = ? AND provider_user_id = ?
    `).get(input.provider, input.providerUserId) as { userId: string } | undefined;

    if (!identity) {
      throw new Error("User identity was not persisted");
    }

    return { userId: identity.userId, created: !existingUser };
  });

  return transaction();
}

export function consumeAuthReplayKey(
  { sqlite }: DatabaseHandle,
  replayKey: string,
  expiresAtMs: number,
  nowMs = Date.now()
): boolean {
  const now = new Date(nowMs).toISOString();
  const expiresAt = new Date(expiresAtMs).toISOString();
  const transaction = sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM auth_replay_keys WHERE expires_at <= ?").run(now);
    return sqlite.prepare(`
      INSERT INTO auth_replay_keys (replay_key, expires_at)
      VALUES (?, ?)
      ON CONFLICT(replay_key) DO NOTHING
    `).run(replayKey, expiresAt).changes === 1;
  });

  return transaction();
}

export function createAuthSession(
  { sqlite }: DatabaseHandle,
  input: CreateAuthSessionInput
): AuthSessionRecord {
  sqlite.prepare(`
    INSERT INTO auth_sessions (
      session_id,
      user_id,
      token_hash,
      created_at,
      expires_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    input.sessionId,
    input.userId,
    input.tokenHash,
    input.createdAt,
    input.expiresAt
  );

  return {
    ...input,
    revokedAt: null
  };
}

export function getActiveAuthSession(
  { sqlite }: DatabaseHandle,
  tokenHash: string,
  now = new Date().toISOString()
): AuthSessionRecord | undefined {
  const row = sqlite.prepare(`
    SELECT
      session_id AS sessionId,
      user_id AS userId,
      token_hash AS tokenHash,
      created_at AS createdAt,
      expires_at AS expiresAt,
      revoked_at AS revokedAt
    FROM auth_sessions
    WHERE token_hash = ?
      AND revoked_at IS NULL
      AND expires_at > ?
  `).get(tokenHash, now) as AuthSessionRecord | undefined;

  return row;
}

export function revokeAuthSession(
  { sqlite }: DatabaseHandle,
  sessionId: string,
  revokedAt = new Date().toISOString()
): boolean {
  return sqlite.prepare(`
    UPDATE auth_sessions
    SET revoked_at = ?
    WHERE session_id = ? AND revoked_at IS NULL
  `).run(revokedAt, sessionId).changes === 1;
}

export function upsertHistoricalSnapshot(
  { sqlite }: DatabaseHandle,
  snapshot: HistoricalMarketSnapshot,
  snapshotId: string = randomUUID(),
  createdAt: string = new Date().toISOString()
): HistoricalSnapshotRecord {
  const parsed = HistoricalMarketSnapshotSchema.parse(snapshot);
  sqlite.prepare(`
    INSERT INTO historical_snapshots (
      snapshot_id,
      provider,
      symbol,
      interval,
      as_of,
      content_hash,
      snapshot_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(content_hash) DO NOTHING
  `).run(
    snapshotId,
    parsed.provider,
    parsed.symbol,
    parsed.interval,
    parsed.asOf,
    parsed.provenance.contentHash,
    JSON.stringify(parsed),
    createdAt
  );

  const row = sqlite.prepare(`
    SELECT
      snapshot_id AS snapshotId,
      provider,
      symbol,
      interval,
      as_of AS asOf,
      content_hash AS contentHash,
      snapshot_json AS snapshotJson,
      created_at AS createdAt
    FROM historical_snapshots
    WHERE content_hash = ?
  `).get(parsed.provenance.contentHash) as {
    snapshotId: string;
    provider: "binance";
    symbol: string;
    interval: string;
    asOf: string;
    contentHash: string;
    snapshotJson: string;
    createdAt: string;
  } | undefined;

  if (!row) {
    throw new Error(`Historical snapshot was not persisted: ${parsed.provenance.contentHash}`);
  }

  return {
    snapshotId: row.snapshotId,
    provider: row.provider,
    symbol: row.symbol,
    interval: row.interval,
    asOf: row.asOf,
    contentHash: row.contentHash,
    snapshot: HistoricalMarketSnapshotSchema.parse(JSON.parse(row.snapshotJson) as unknown),
    createdAt: row.createdAt
  };
}

export function getHistoricalSnapshot(
  { sqlite }: DatabaseHandle,
  snapshotId: string
): HistoricalSnapshotRecord | undefined {
  const row = sqlite.prepare(`
    SELECT
      snapshot_id AS snapshotId,
      provider,
      symbol,
      interval,
      as_of AS asOf,
      content_hash AS contentHash,
      snapshot_json AS snapshotJson,
      created_at AS createdAt
    FROM historical_snapshots
    WHERE snapshot_id = ?
  `).get(snapshotId) as {
    snapshotId: string;
    provider: "binance";
    symbol: string;
    interval: string;
    asOf: string;
    contentHash: string;
    snapshotJson: string;
    createdAt: string;
  } | undefined;

  if (!row) {
    return undefined;
  }

  return {
    snapshotId: row.snapshotId,
    provider: row.provider,
    symbol: row.symbol,
    interval: row.interval,
    asOf: row.asOf,
    contentHash: row.contentHash,
    snapshot: HistoricalMarketSnapshotSchema.parse(JSON.parse(row.snapshotJson) as unknown),
    createdAt: row.createdAt
  };
}

export function getScenarioPackage(
  { sqlite }: DatabaseHandle,
  scenarioId: string,
  version: string
): ScenarioPackage | undefined {
  const record = sqlite.prepare(`
    SELECT package_json AS packageJson
    FROM scenarios
    WHERE scenario_id = ? AND version = ?
  `).get(scenarioId, version) as { packageJson: string } | undefined;

  if (!record) {
    return undefined;
  }

  return ScenarioPackageSchema.parse(JSON.parse(record.packageJson) as unknown);
}

export function getScenarioRun(
  { sqlite }: DatabaseHandle,
  runId: string,
  userId: string
): ScenarioRunRecord | undefined {
  const row = sqlite.prepare(`
    SELECT
      run_id AS runId,
      user_id AS userId,
      scenario_id AS scenarioId,
      scenario_version AS scenarioVersion,
      state,
      idempotency_key AS idempotencyKey,
      decision_json AS decisionJson,
      score_json AS scoreJson,
      created_at AS createdAt,
      sealed_at AS sealedAt,
      revealed_at AS revealedAt,
      completed_at AS completedAt
    FROM scenario_runs
    WHERE run_id = ? AND user_id = ?
  `).get(runId, userId) as {
    runId: string;
    userId: string;
    scenarioId: string;
    scenarioVersion: string;
    state: ScenarioRunState;
    idempotencyKey: string;
    decisionJson: string | null;
    scoreJson: string | null;
    createdAt: string;
    sealedAt: string | null;
    revealedAt: string | null;
    completedAt: string | null;
  } | undefined;

  return row ? readScenarioRunRow(row) : undefined;
}

export function createScenarioRun(
  handle: DatabaseHandle,
  input: CreateScenarioRunInput
): ScenarioRunRecord {
  const { sqlite } = handle;
  const createdAt = new Date().toISOString();
  sqlite.prepare(`
    INSERT INTO scenario_runs (
      run_id,
      user_id,
      scenario_id,
      scenario_version,
      state,
      idempotency_key,
      created_at
    ) VALUES (?, ?, ?, ?, 'started', ?, ?)
    ON CONFLICT(idempotency_key) DO NOTHING
  `).run(
    input.runId,
    input.userId,
    input.scenarioId,
    input.scenarioVersion,
    input.idempotencyKey,
    createdAt
  );

  const record = getScenarioRun(handle, input.runId, input.userId)
    ?? (() => {
      const row = sqlite.prepare(`
        SELECT
          run_id AS runId,
          user_id AS userId,
          scenario_id AS scenarioId,
          scenario_version AS scenarioVersion,
          state,
          idempotency_key AS idempotencyKey,
          decision_json AS decisionJson,
          score_json AS scoreJson,
          created_at AS createdAt,
          sealed_at AS sealedAt,
          revealed_at AS revealedAt,
          completed_at AS completedAt
        FROM scenario_runs
        WHERE idempotency_key = ?
      `).get(input.idempotencyKey) as {
        runId: string;
        userId: string;
        scenarioId: string;
        scenarioVersion: string;
        state: ScenarioRunState;
        idempotencyKey: string;
        decisionJson: string | null;
        scoreJson: string | null;
        createdAt: string;
        sealedAt: string | null;
        revealedAt: string | null;
        completedAt: string | null;
      } | undefined;

      return row ? readScenarioRunRow(row) : undefined;
    })();

  if (!record) {
    throw new Error(`Scenario run was not persisted: ${input.idempotencyKey}`);
  }

  if (
    record.userId !== input.userId
    || record.scenarioId !== input.scenarioId
    || record.scenarioVersion !== input.scenarioVersion
  ) {
    throw new Error(`Idempotency key is bound to a different scenario run: ${input.idempotencyKey}`);
  }

  return record;
}

export function sealScenarioRun(
  handle: DatabaseHandle,
  runId: string,
  userId: string,
  decision: DecisionTrace,
  score: ScoreResult
): ScenarioRunRecord {
  const { sqlite } = handle;
  const parsedDecision = DecisionTraceSchema.parse(decision);
  const parsedScore = ScoreResultSchema.parse(score);
  const current = getScenarioRun(handle, runId, userId);

  if (!current) {
    throw new Error(`Scenario run was not found: ${runId}`);
  }

  if (current.state !== "started") {
    if (current.decision && isDeepStrictEqual(current.decision, parsedDecision)) {
      return current;
    }
    throw new Error(`Scenario run is already sealed: ${runId}`);
  }

  const sealedAt = new Date().toISOString();
  sqlite.prepare(`
    UPDATE scenario_runs
    SET state = 'sealed', decision_json = ?, score_json = ?, sealed_at = ?
    WHERE run_id = ? AND user_id = ? AND state = 'started'
  `).run(
    JSON.stringify(parsedDecision),
    JSON.stringify(parsedScore),
    sealedAt,
    runId,
    userId
  );

  const sealed = getScenarioRun(handle, runId, userId);
  if (!sealed) {
    throw new Error(`Scenario run disappeared while sealing: ${runId}`);
  }

  if (sealed.state !== "sealed" && sealed.state !== "revealed" && sealed.state !== "completed") {
    throw new Error(`Scenario run was not sealed: ${runId}`);
  }

  return sealed;
}

export function revealScenarioRun(
  handle: DatabaseHandle,
  runId: string,
  userId: string
): ScenarioRunRecord {
  const { sqlite } = handle;
  const current = getScenarioRun(handle, runId, userId);

  if (!current) {
    throw new Error(`Scenario run was not found: ${runId}`);
  }

  if (current.state === "started") {
    throw new Error(`Scenario run must be sealed before reveal: ${runId}`);
  }

  if (current.state === "revealed" || current.state === "completed") {
    return current;
  }

  const revealedAt = new Date().toISOString();
  sqlite.prepare(`
    UPDATE scenario_runs
    SET state = 'revealed', revealed_at = ?
    WHERE run_id = ? AND user_id = ? AND state = 'sealed'
  `).run(revealedAt, runId, userId);

  const revealed = getScenarioRun(handle, runId, userId);
  if (!revealed || (revealed.state !== "revealed" && revealed.state !== "completed")) {
    throw new Error(`Scenario run was not revealed: ${runId}`);
  }

  return revealed;
}

// --- Economy ledger (Coins / XP / Energy / Mastery Stars) — Ledger v2 ---------
//
// The ledger is append-only and authoritative. `user_economy_state` is a cached
// projection advanced only when a new event is inserted, so a replayed
// idempotency key returns the prior result without double-counting. Each asset
// has its own event kind (see the contract asset × kind matrix). Scenario
// completion grants XP + Mastery only, never Coins.

export const ENERGY_CAP = 5;

export type AppendLedgerEventInput = {
  id?: string;
  userId: string;
  kind: LedgerEventKind;
  amount: number;
  reason: string;
  promo: boolean;
  riskState?: RiskState;
  runId?: string | null;
  scenarioId?: string | null;
  sourceId?: string | null;
  idempotencyKey: string;
  createdAt?: string;
};

export type AppendLedgerEventResult = {
  event: LedgerEvent;
  state: UserEconomyState;
  created: boolean;
};

export type ListLedgerEventsOptions = {
  limit?: number;
  after?: string | null;
};

export type ScenarioCompletionRewardsInput = {
  userId: string;
  runId: string;
  scenarioId: string;
  scenarioVersion: string;
  qualityScore: number;
  breakdown: { protocol_adherence: number; discipline: number };
  occurredAt?: string;
};

export type ScenarioCompletionRewardsResult = {
  granted: boolean;
  rewardGrantId: string;
  xpGranted: number;
  masteryDelta: number;
  events: LedgerEvent[];
  state: UserEconomyState;
};

export type StartEligibleRunInput = {
  runId: string;
  userId: string;
  scenarioId: string;
  scenarioVersion: string;
  scenarioMode: string;
  idempotencyKey: string;
  occurredAt?: string;
};

export type StartEligibleRunResult = {
  run: ScenarioRunRecord | null;
  state: UserEconomyState;
  energySpent: number;
  insufficientEnergy: boolean;
};

type LedgerEventRow = {
  id: string;
  userId: string;
  kind: LedgerEventKind;
  asset: LedgerAsset;
  amount: number;
  reason: string;
  promo: number | boolean;
  runId: string | null;
  scenarioId: string | null;
  sourceId: string | null;
  riskState: RiskState;
  idempotencyKey: string;
  createdAt: string;
};

type EconomyStateRow = {
  userId: string;
  xp: number;
  coins: number;
  promoCoins: number;
  masteryStars: number;
  energy: number;
  energyUpdatedAt: string;
  version: number;
};

const LEDGER_SELECT_COLUMNS = `
  id,
  user_id AS userId,
  kind,
  asset,
  amount,
  reason,
  promo,
  run_id AS runId,
  scenario_id AS scenarioId,
  source_id AS sourceId,
  risk_state AS riskState,
  idempotency_key AS idempotencyKey,
  created_at AS createdAt
`;

function toPromoBoolean(promo: number | boolean): boolean {
  return promo === 1 || promo === true;
}

function readLedgerEventRow(row: LedgerEventRow): LedgerEvent {
  return LedgerEventSchema.parse({
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    asset: row.asset,
    amount: row.amount,
    reason: row.reason,
    promo: toPromoBoolean(row.promo),
    runId: row.runId,
    scenarioId: row.scenarioId,
    sourceId: row.sourceId,
    riskState: row.riskState,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt
  });
}

function readEconomyStateRow(row: EconomyStateRow): UserEconomyState {
  return UserEconomyStateSchema.parse(row);
}

/**
 * Pure projection of a ledger event onto the cached economy state. Returns the
 * next state values (including a version bump). Energy timestamp anchoring for
 * regeneration is applied by the caller, not here.
 */
export function applyLedgerEventToState(
  state: UserEconomyState,
  input: { kind: LedgerEventKind; amount: number; promo: boolean }
): UserEconomyState {
  const next: UserEconomyState = { ...state };
  switch (input.kind) {
    case "xp_awarded": {
      next.xp += input.amount;
      break;
    }
    case "mastery_awarded": {
      next.masteryStars += input.amount;
      break;
    }
    case "energy_spent": {
      next.energy = Math.max(0, next.energy + input.amount); // amount is negative
      break;
    }
    case "energy_regenerated":
    case "energy_refilled": {
      next.energy = Math.min(ENERGY_CAP, next.energy + input.amount);
      break;
    }
    case "coin_pack_credited": {
      next.coins += input.amount;
      break;
    }
    case "coin_promo_granted": {
      next.promoCoins += input.amount;
      break;
    }
    case "coin_spent": {
      next.coins = Math.max(0, next.coins + input.amount); // amount is negative
      break;
    }
  }
  next.version += 1;
  return UserEconomyStateSchema.parse(next);
}

function sameLedgerPayload(row: LedgerEventRow, input: AppendLedgerEventInput): boolean {
  return (
    row.kind === input.kind &&
    row.asset === KIND_ASSET[input.kind] &&
    row.amount === input.amount &&
    toPromoBoolean(row.promo) === input.promo &&
    (row.runId ?? null) === (input.runId ?? null) &&
    (row.scenarioId ?? null) === (input.scenarioId ?? null) &&
    (row.sourceId ?? null) === (input.sourceId ?? null)
  );
}

export function getEconomyState(
  { sqlite }: DatabaseHandle,
  userId: string
): UserEconomyState | undefined {
  const row = sqlite.prepare(`
    SELECT
      user_id AS userId,
      xp,
      coins,
      promo_coins AS promoCoins,
      mastery_stars AS masteryStars,
      energy,
      energy_updated_at AS energyUpdatedAt,
      version
    FROM user_economy_state
    WHERE user_id = ?
  `).get(userId) as EconomyStateRow | undefined;
  return row ? readEconomyStateRow(row) : undefined;
}

export function ensureEconomyState(
  handle: DatabaseHandle,
  userId: string,
  now = new Date().toISOString()
): UserEconomyState {
  handle.sqlite.prepare(`
    INSERT INTO user_economy_state (user_id, energy_updated_at)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId, now);

  const state = getEconomyState(handle, userId);
  if (!state) {
    throw new Error(`Economy state was not initialized for user: ${userId}`);
  }
  return state;
}

function writeEconomyState(
  { sqlite }: DatabaseHandle,
  state: UserEconomyState
): void {
  sqlite.prepare(`
    UPDATE user_economy_state
    SET xp = ?, coins = ?, promo_coins = ?, mastery_stars = ?, energy = ?,
        energy_updated_at = ?, version = ?
    WHERE user_id = ?
  `).run(
    state.xp,
    state.coins,
    state.promoCoins,
    state.masteryStars,
    state.energy,
    state.energyUpdatedAt,
    state.version,
    state.userId
  );
}

function getScenarioRunByIdempotencyKey(
  { sqlite }: DatabaseHandle,
  idempotencyKey: string
): ScenarioRunRecord | undefined {
  const row = sqlite.prepare(`
    SELECT
      run_id AS runId,
      user_id AS userId,
      scenario_id AS scenarioId,
      scenario_version AS scenarioVersion,
      state,
      idempotency_key AS idempotencyKey,
      decision_json AS decisionJson,
      score_json AS scoreJson,
      created_at AS createdAt,
      sealed_at AS sealedAt,
      revealed_at AS revealedAt,
      completed_at AS completedAt
    FROM scenario_runs
    WHERE idempotency_key = ?
  `).get(idempotencyKey) as Parameters<typeof readScenarioRunRow>[0] | undefined;
  return row ? readScenarioRunRow(row) : undefined;
}

/**
 * Append one ledger event inside an already-open transaction. Advances the
 * cached projection only when a new row is actually inserted; a replayed key
 * that matches the stored payload returns the prior result, and a key reused
 * with a different payload throws `ledger_idempotency_conflict`.
 */
function appendLedgerEventInTx(
  handle: DatabaseHandle,
  input: AppendLedgerEventInput
): AppendLedgerEventResult {
  const { sqlite } = handle;
  const createdAt = input.createdAt ?? new Date().toISOString();
  const runId = input.runId ?? null;
  const scenarioId = input.scenarioId ?? null;
  const sourceId = input.sourceId ?? null;
  const riskState: RiskState = input.riskState ?? "clear";
  const asset = KIND_ASSET[input.kind];

  ensureEconomyState(handle, input.userId, createdAt);

  const existing = sqlite.prepare(`
    SELECT ${LEDGER_SELECT_COLUMNS}
    FROM ledger_events
    WHERE user_id = ? AND idempotency_key = ?
  `).get(input.userId, input.idempotencyKey) as LedgerEventRow | undefined;

  if (existing) {
    if (!sameLedgerPayload(existing, input)) {
      throw new Error(`ledger_idempotency_conflict: ${input.idempotencyKey}`);
    }
    return {
      event: readLedgerEventRow(existing),
      state: getEconomyState(handle, input.userId)!,
      created: false
    };
  }

  const id = input.id ?? randomUUID();
  sqlite.prepare(`
    INSERT INTO ledger_events (
      id, user_id, kind, asset, amount, reason, promo, run_id,
      scenario_id, source_id, risk_state, idempotency_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.userId,
    input.kind,
    asset,
    input.amount,
    input.reason,
    input.promo ? 1 : 0,
    runId,
    scenarioId,
    sourceId,
    riskState,
    input.idempotencyKey,
    createdAt
  );

  const base = getEconomyState(handle, input.userId)!;
  const next = applyLedgerEventToState(base, {
    kind: input.kind,
    amount: input.amount,
    promo: input.promo
  });
  writeEconomyState(handle, next);

  return {
    event: readLedgerEventRow({
      id,
      userId: input.userId,
      kind: input.kind,
      asset,
      amount: input.amount,
      reason: input.reason,
      promo: input.promo ? 1 : 0,
      runId,
      scenarioId,
      sourceId,
      riskState,
      idempotencyKey: input.idempotencyKey,
      createdAt
    }),
    state: getEconomyState(handle, input.userId)!,
    created: true
  };
}

export function appendLedgerEvent(
  handle: DatabaseHandle,
  input: AppendLedgerEventInput
): AppendLedgerEventResult {
  const transaction = handle.sqlite.transaction(() => appendLedgerEventInTx(handle, input));
  return transaction();
}

/**
 * Lazily regenerate Energy inside an open transaction, preserving the partial
 * interval remainder. A grant is recorded as a single idempotent
 * `energy_regenerated` event keyed by the new anchor epoch, so concurrent reads
 * that compute the same target cannot double-apply. When the bar is already full
 * the anchor is moved to `now` without a grant event.
 */
function applyLazyRegenInTx(
  handle: DatabaseHandle,
  userId: string,
  now: string
): UserEconomyState {
  const state = ensureEconomyState(handle, userId, now);
  const elapsedMs = Math.max(0, Date.parse(now) - Date.parse(state.energyUpdatedAt));
  if (elapsedMs === 0) return state;

  const regen = applyEnergyRegen(state.energy, elapsedMs);

  if (regen.energy === state.energy) {
    // At cap (or no whole tick) — anchor the reference point to `now` silently.
    if (state.energy >= ENERGY_CAP) {
      const reanchored = UserEconomyStateSchema.parse({ ...state, energyUpdatedAt: now });
      writeEconomyState(handle, reanchored);
      return reanchored;
    }
    return state;
  }

  const newAnchorMs = Date.parse(state.energyUpdatedAt) + regen.advancedMs;
  appendLedgerEventInTx(handle, {
    userId,
    kind: "energy_regenerated",
    amount: regen.energy - state.energy,
    reason: "timer_regen",
    promo: false,
    idempotencyKey: `energy:regen:${userId}:${newAnchorMs}`,
    createdAt: now
  });
  const after = getEconomyState(handle, userId)!;
  const withAnchor = UserEconomyStateSchema.parse({
    ...after,
    energyUpdatedAt: new Date(newAnchorMs).toISOString()
  });
  writeEconomyState(handle, withAnchor);
  return withAnchor;
}

export function getEnergyRegenState(
  handle: DatabaseHandle,
  userId: string,
  now = new Date().toISOString()
): UserEconomyState {
  const transaction = handle.sqlite.transaction(() => applyLazyRegenInTx(handle, userId, now));
  return transaction();
}

/**
 * Read-only projection of balance with regeneration applied for display. Unlike
 * `getEnergyRegenState` it never persists, so `GET /balance` stays side-effect
 * free with respect to the ledger.
 */
export function projectEconomyState(
  handle: DatabaseHandle,
  userId: string,
  now = new Date().toISOString()
): UserEconomyState {
  const state = getEconomyState(handle, userId) ?? ensureEconomyState(handle, userId, now);
  const elapsedMs = Math.max(0, Date.parse(now) - Date.parse(state.energyUpdatedAt));
  const regen = applyEnergyRegen(state.energy, elapsedMs);
  if (regen.energy === state.energy) return state;
  return UserEconomyStateSchema.parse({ ...state, energy: regen.energy });
}

/**
 * Atomically award the rewards for a sealed, owned scenario completion in a
 * single DB transaction:
 *   1. initialize/cache the economy state,
 *   2. short-circuit on the `reward_grants` idempotency anchor (one grant/run),
 *   3. compute XP from repeat eligibility + quality + the persisted UTC daily
 *      cap and append `xp_awarded` (> 0 only),
 *   4. compute the Mastery best delta and append `mastery_awarded` (> 0 only),
 *   5. update scenario completion history,
 *   6. record the reward-grant row.
 * Coins are never touched here.
 */
export function applyScenarioCompletionRewards(
  handle: DatabaseHandle,
  input: ScenarioCompletionRewardsInput
): ScenarioCompletionRewardsResult {
  const transaction = handle.sqlite.transaction((): ScenarioCompletionRewardsResult => {
    const { sqlite } = handle;
    const now = input.occurredAt ?? new Date().toISOString();
    ensureEconomyState(handle, input.userId, now);

    const prior = sqlite.prepare(`
      SELECT
        reward_grant_id AS rewardGrantId,
        xp_granted AS xpGranted,
        mastery_delta AS masteryDelta
      FROM reward_grants
      WHERE user_id = ? AND run_id = ?
    `).get(input.userId, input.runId) as
      | { rewardGrantId: string; xpGranted: number; masteryDelta: number }
      | undefined;

    if (prior) {
      return {
        granted: false,
        rewardGrantId: prior.rewardGrantId,
        xpGranted: prior.xpGranted,
        masteryDelta: prior.masteryDelta,
        events: [],
        state: getEconomyState(handle, input.userId)!
      };
    }

    const comp = sqlite.prepare(`
      SELECT
        completions,
        best_score AS bestScore,
        last_completed_at AS lastCompletedAt
      FROM scenario_completions
      WHERE user_id = ? AND scenario_id = ? AND scenario_version = ?
    `).get(input.userId, input.scenarioId, input.scenarioVersion) as
      | { completions: number; bestScore: number; lastCompletedAt: string }
      | undefined;

    const firstCompletion = !comp;
    const withinWindow = comp
      ? Date.parse(now) - Date.parse(comp.lastCompletedAt) <= XP_REPEAT_WINDOW_MS
      : false;
    const qualifiesForReduced = comp ? input.qualityScore > comp.bestScore : false;
    const desiredXp = xpForCompletion({
      qualityScore: input.qualityScore,
      firstCompletion,
      withinWindow,
      qualifiesForReduced
    });

    const todayXp = (sqlite.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM ledger_events
      WHERE user_id = ?
        AND kind = 'xp_awarded'
        AND substr(created_at, 1, 10) = substr(?, 1, 10)
    `).get(input.userId, now) as { total: number }).total;
    const xpGranted = xpGrantedAfterDailyCap(desiredXp, todayXp);

    const events: LedgerEvent[] = [];
    if (xpGranted > 0) {
      const xpEvent = appendLedgerEventInTx(handle, {
        userId: input.userId,
        kind: "xp_awarded",
        amount: xpGranted,
        reason: "scenario_completion",
        promo: false,
        runId: input.runId,
        scenarioId: input.scenarioId,
        idempotencyKey: `run:${input.runId}:xp`,
        createdAt: now
      });
      events.push(xpEvent.event);
    }

    const earnedStars = masteryStarsForScore({
      completed: true,
      qualityScore: input.qualityScore,
      keyConditionsMet: keyConditionsMetForBreakdown(input.breakdown)
    });
    const prevMastery = sqlite.prepare(`
      SELECT best_stars AS bestStars
      FROM user_scenario_mastery
      WHERE user_id = ? AND scenario_id = ?
    `).get(input.userId, input.scenarioId) as { bestStars: number } | undefined;
    const prevBest = prevMastery?.bestStars ?? 0;
    const masteryDelta = Math.max(0, earnedStars - prevBest);

    if (masteryDelta > 0) {
      const masteryEvent = appendLedgerEventInTx(handle, {
        userId: input.userId,
        kind: "mastery_awarded",
        amount: masteryDelta,
        reason: "scenario_quality",
        promo: false,
        runId: input.runId,
        scenarioId: input.scenarioId,
        idempotencyKey: `run:${input.runId}:mastery`,
        createdAt: now
      });
      events.push(masteryEvent.event);
    }

    sqlite.prepare(`
      INSERT INTO user_scenario_mastery (user_id, scenario_id, best_stars, best_score, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, scenario_id) DO UPDATE SET
        best_stars = MAX(user_scenario_mastery.best_stars, excluded.best_stars),
        best_score = MAX(user_scenario_mastery.best_score, excluded.best_score),
        updated_at = excluded.updated_at
    `).run(input.userId, input.scenarioId, earnedStars, input.qualityScore, now);

    sqlite.prepare(`
      INSERT INTO scenario_completions (
        user_id, scenario_id, scenario_version, completions, best_score,
        first_completed_at, last_completed_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(user_id, scenario_id, scenario_version) DO UPDATE SET
        completions = scenario_completions.completions + 1,
        best_score = MAX(scenario_completions.best_score, excluded.best_score),
        last_completed_at = excluded.last_completed_at
    `).run(
      input.userId,
      input.scenarioId,
      input.scenarioVersion,
      input.qualityScore,
      now,
      now
    );

    const rewardGrantId = randomUUID();
    sqlite.prepare(`
      INSERT INTO reward_grants (
        reward_grant_id, user_id, run_id, scenario_id, xp_granted, mastery_delta, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(rewardGrantId, input.userId, input.runId, input.scenarioId, xpGranted, masteryDelta, now);

    return {
      granted: true,
      rewardGrantId,
      xpGranted,
      masteryDelta,
      events,
      state: getEconomyState(handle, input.userId)!
    };
  });

  return transaction();
}

/**
 * Atomically start an eligible run: apply lazy Energy regen, derive the Energy
 * cost from the server-side scenario mode (never a client field), spend Energy
 * for a paid launch, and create the run — all in one transaction so Energy can
 * never be spent without a run (or a run created without a spend).
 */
export function startEligibleScenarioRun(
  handle: DatabaseHandle,
  input: StartEligibleRunInput
): StartEligibleRunResult {
  const transaction = handle.sqlite.transaction((): StartEligibleRunResult => {
    const now = input.occurredAt ?? new Date().toISOString();
    const state = applyLazyRegenInTx(handle, input.userId, now);

    const existing = getScenarioRunByIdempotencyKey(handle, input.idempotencyKey);
    if (existing) {
      if (existing.userId !== input.userId) {
        throw new Error(`Idempotency key is bound to a different scenario run: ${input.idempotencyKey}`);
      }
      return { run: existing, state, energySpent: 0, insufficientEnergy: false };
    }

    const cost = energyCostForMode(input.scenarioMode);
    if (cost > state.energy) {
      return { run: null, state, energySpent: 0, insufficientEnergy: true };
    }

    // Create the run first so a spend event can reference it via the ledger
    // `run_id` foreign key; both happen in this one transaction, so Energy is
    // still never spent without a run (and vice versa).
    const run = createScenarioRun(handle, {
      runId: input.runId,
      userId: input.userId,
      scenarioId: input.scenarioId,
      scenarioVersion: input.scenarioVersion,
      idempotencyKey: input.idempotencyKey
    });

    if (cost > 0) {
      appendLedgerEventInTx(handle, {
        userId: input.userId,
        kind: "energy_spent",
        amount: -cost,
        reason: "arena_launch",
        promo: false,
        runId: input.runId,
        scenarioId: input.scenarioId,
        idempotencyKey: `energy:spend:${input.runId}`,
        createdAt: now
      });
    }

    return {
      run,
      state: getEconomyState(handle, input.userId)!,
      energySpent: cost,
      insufficientEnergy: false
    };
  });

  return transaction();
}

export function listLedgerEvents(
  { sqlite }: DatabaseHandle,
  userId: string,
  options: ListLedgerEventsOptions = {}
): LedgerPage {
  const limit = Math.max(1, Math.min(100, options.limit ?? 20));
  const after = options.after ?? null;

  let rows: LedgerEventRow[];
  if (after) {
    const anchor = sqlite.prepare(`
      SELECT created_at AS createdAt, id
      FROM ledger_events
      WHERE id = ? AND user_id = ?
    `).get(after, userId) as { createdAt: string; id: string } | undefined;
    if (!anchor) {
      throw new Error(`invalid ledger cursor: ${after}`);
    }
    rows = sqlite.prepare(`
      SELECT ${LEDGER_SELECT_COLUMNS}
      FROM ledger_events
      WHERE user_id = ?
        AND (created_at < ? OR (created_at = ? AND id < ?))
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(userId, anchor.createdAt, anchor.createdAt, anchor.id, limit) as LedgerEventRow[];
  } else {
    rows = sqlite.prepare(`
      SELECT ${LEDGER_SELECT_COLUMNS}
      FROM ledger_events
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(userId, limit) as LedgerEventRow[];
  }

  const events = rows.map(readLedgerEventRow);
  const nextCursor = rows.length === limit ? rows[rows.length - 1]!.id : null;
  return { events, nextCursor };
}

// --- Academy Level 0 learning persistence (Iteration 04 Phase 2) ------------
//
// Server-authoritative: nothing here trusts the client. The API composes the
// pure domain verification/state-machine with these writes; the tables simply
// persist the server's decision. `run_id` on an attempt references a real
// scenario run so a verified challenge is always backed by sealed, scored data.

export type LearningAttemptType = "guided_practice" | "challenge" | "transfer" | "rematch";
export type LearningAttemptStatus = "started" | "verified" | "failed";

export type LearningModuleRecord = {
  moduleId: string;
  version: string;
  title: string;
  level: number;
  content: AcademyModule;
  status: LearningPublicationStatus;
  createdAt: string;
  updatedAt: string;
};

export type UpsertLearningModuleInput = {
  moduleId: string;
  version: string;
  title: string;
  level: number;
  content: AcademyModule;
  status: LearningPublicationStatus;
};

export type ModuleProgressRecord = {
  userId: string;
  moduleId: string;
  moduleVersion: string;
  status: LearningStatus;
  startedAt: string | null;
  verifiedAt: string | null;
  masteredAt: string | null;
  reviewDueAt: string | null;
  verificationSource: VerificationSource | null;
  bestScore: number;
  version: number;
};

export type UpsertModuleProgressInput = {
  userId: string;
  moduleId: string;
  moduleVersion: string;
  status: LearningStatus;
  startedAt: string | null;
  verifiedAt: string | null;
  masteredAt: string | null;
  reviewDueAt: string | null;
  verificationSource: VerificationSource | null;
  bestScore: number;
};

export type LearningAttemptRecord = {
  attemptId: string;
  userId: string;
  moduleId: string;
  moduleVersion: string;
  attemptType: LearningAttemptType;
  scenarioId: string;
  scenarioVersion: string;
  runId: string | null;
  status: LearningAttemptStatus;
  startedAt: string;
  completedAt: string | null;
  result: unknown | null;
};

export type CreateLearningAttemptInput = {
  attemptId: string;
  userId: string;
  moduleId: string;
  moduleVersion: string;
  attemptType: LearningAttemptType;
  scenarioId: string;
  scenarioVersion: string;
  runId: string | null;
};

export type FinalizeLearningAttemptInput = {
  attemptId: string;
  userId: string;
  status: Extract<LearningAttemptStatus, "verified" | "failed">;
  result: unknown;
};

function readLearningModuleRow(row: {
  moduleId: string;
  version: string;
  title: string;
  level: number;
  contentJson: string;
  status: LearningPublicationStatus;
  createdAt: string;
  updatedAt: string;
}): LearningModuleRecord {
  return {
    moduleId: row.moduleId,
    version: row.version,
    title: row.title,
    level: row.level,
    content: AcademyModuleSchema.parse(parseJson(row.contentJson)),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function upsertLearningModule(
  handle: DatabaseHandle,
  input: UpsertLearningModuleInput
): LearningModuleRecord {
  const content = AcademyModuleSchema.parse(input.content);
  const now = new Date().toISOString();
  handle.sqlite.prepare(`
    INSERT INTO learning_modules (
      module_id, version, title, level, content_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(module_id, version) DO UPDATE SET
      title = excluded.title,
      level = excluded.level,
      content_json = excluded.content_json,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(
    content.moduleId,
    content.version,
    input.title,
    input.level,
    JSON.stringify(content),
    input.status,
    now,
    now
  );

  return getLearningModule(handle, content.moduleId, content.version)!;
}

export function getLearningModule(
  { sqlite }: DatabaseHandle,
  moduleId: string,
  version: string
): LearningModuleRecord | undefined {
  const row = sqlite.prepare(`
    SELECT
      module_id AS moduleId, version, title, level,
      content_json AS contentJson, status,
      created_at AS createdAt, updated_at AS updatedAt
    FROM learning_modules
    WHERE module_id = ? AND version = ?
  `).get(moduleId, version) as Parameters<typeof readLearningModuleRow>[0] | undefined;
  return row ? readLearningModuleRow(row) : undefined;
}

function readModuleProgressRow(row: {
  userId: string;
  moduleId: string;
  moduleVersion: string;
  status: LearningStatus;
  startedAt: string | null;
  verifiedAt: string | null;
  masteredAt: string | null;
  reviewDueAt: string | null;
  verificationSource: string | null;
  bestScore: number;
  version: number;
}): ModuleProgressRecord {
  return {
    userId: row.userId,
    moduleId: row.moduleId,
    moduleVersion: row.moduleVersion,
    status: row.status,
    startedAt: row.startedAt,
    verifiedAt: row.verifiedAt,
    masteredAt: row.masteredAt,
    reviewDueAt: row.reviewDueAt,
    verificationSource: (row.verificationSource as VerificationSource | null) ?? null,
    bestScore: row.bestScore,
    version: row.version
  };
}

export function getModuleProgress(
  { sqlite }: DatabaseHandle,
  userId: string,
  moduleId: string,
  moduleVersion: string
): ModuleProgressRecord | undefined {
  const row = sqlite.prepare(`
    SELECT
      user_id AS userId, module_id AS moduleId, module_version AS moduleVersion,
      status, started_at AS startedAt, verified_at AS verifiedAt,
      mastered_at AS masteredAt, review_due_at AS reviewDueAt,
      verification_source AS verificationSource, best_score AS bestScore, version
    FROM user_module_progress
    WHERE user_id = ? AND module_id = ? AND module_version = ?
  `).get(userId, moduleId, moduleVersion) as Parameters<typeof readModuleProgressRow>[0] | undefined;
  return row ? readModuleProgressRow(row) : undefined;
}

export function upsertModuleProgress(
  handle: DatabaseHandle,
  input: UpsertModuleProgressInput
): ModuleProgressRecord {
  handle.sqlite.prepare(`
    INSERT INTO user_module_progress (
      user_id, module_id, module_version, status,
      started_at, verified_at, mastered_at, review_due_at,
      verification_source, best_score, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(user_id, module_id, module_version) DO UPDATE SET
      status = excluded.status,
      started_at = COALESCE(user_module_progress.started_at, excluded.started_at),
      verified_at = COALESCE(user_module_progress.verified_at, excluded.verified_at),
      mastered_at = COALESCE(user_module_progress.mastered_at, excluded.mastered_at),
      review_due_at = COALESCE(excluded.review_due_at, user_module_progress.review_due_at),
      verification_source = COALESCE(user_module_progress.verification_source, excluded.verification_source),
      best_score = MAX(excluded.best_score, user_module_progress.best_score),
      version = user_module_progress.version + 1
  `).run(
    input.userId,
    input.moduleId,
    input.moduleVersion,
    input.status,
    input.startedAt,
    input.verifiedAt,
    input.masteredAt,
    input.reviewDueAt,
    input.verificationSource,
    input.bestScore
  );

  return getModuleProgress(handle, input.userId, input.moduleId, input.moduleVersion)!;
}

function readLearningAttemptRow(row: {
  attemptId: string;
  userId: string;
  moduleId: string;
  moduleVersion: string;
  attemptType: LearningAttemptType;
  scenarioId: string;
  scenarioVersion: string;
  runId: string | null;
  status: LearningAttemptStatus;
  startedAt: string;
  completedAt: string | null;
  resultJson: string | null;
}): LearningAttemptRecord {
  return {
    attemptId: row.attemptId,
    userId: row.userId,
    moduleId: row.moduleId,
    moduleVersion: row.moduleVersion,
    attemptType: row.attemptType,
    scenarioId: row.scenarioId,
    scenarioVersion: row.scenarioVersion,
    runId: row.runId,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    result: parseJson(row.resultJson)
  };
}

export function createLearningAttempt(
  handle: DatabaseHandle,
  input: CreateLearningAttemptInput
): LearningAttemptRecord {
  const startedAt = new Date().toISOString();
  const insert = handle.sqlite.prepare(`
    INSERT INTO learning_attempts (
      attempt_id, user_id, module_id, module_version, attempt_type,
      scenario_id, scenario_version, run_id, status, started_at, completed_at, result_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'started', ?, NULL, NULL)
    ON CONFLICT(attempt_id) DO NOTHING
  `);

  insert.run(
    input.attemptId, input.userId, input.moduleId, input.moduleVersion,
    input.attemptType, input.scenarioId, input.scenarioVersion, input.runId, startedAt
  );

  return getLearningAttempt(handle, input.attemptId, input.userId)!;
}

export function getLearningAttempt(
  { sqlite }: DatabaseHandle,
  attemptId: string,
  userId: string
): LearningAttemptRecord | undefined {
  const row = sqlite.prepare(`
    SELECT
      attempt_id AS attemptId, user_id AS userId, module_id AS moduleId,
      module_version AS moduleVersion, attempt_type AS attemptType,
      scenario_id AS scenarioId, scenario_version AS scenarioVersion,
      run_id AS runId, status, started_at AS startedAt,
      completed_at AS completedAt, result_json AS resultJson
    FROM learning_attempts
    WHERE attempt_id = ? AND user_id = ?
  `).get(attemptId, userId) as Parameters<typeof readLearningAttemptRow>[0] | undefined;
  return row ? readLearningAttemptRow(row) : undefined;
}

export function finalizeLearningAttempt(
  handle: DatabaseHandle,
  input: FinalizeLearningAttemptInput
): LearningAttemptRecord {
  const current = getLearningAttempt(handle, input.attemptId, input.userId);
  if (!current) {
    throw new Error(`Learning attempt was not found: ${input.attemptId}`);
  }
  if (current.status !== "started") {
    return current;
  }

  handle.sqlite.prepare(`
    UPDATE learning_attempts
    SET status = ?, completed_at = ?, result_json = ?
    WHERE attempt_id = ? AND user_id = ? AND status = 'started'
  `).run(input.status, new Date().toISOString(), JSON.stringify(input.result), input.attemptId, input.userId);

  return getLearningAttempt(handle, input.attemptId, input.userId)!;
}

// --- Decision Telemetry v1 (Iteration 04 Phase 3) ----------------------------
//
// Append-only raw events. The store never joins these to scoring or economy;
// it only persists what the server received and lets a single run be read back
// as an ordered timeline. Idempotency is by `event_id` (a re-sent batch adds no
// duplicates), which is exactly the guarantee the Phase 3 gate requires.

export type DecisionEventRecord = {
  eventId: string;
  userId: string;
  sessionId: string;
  eventType: DecisionEventType;
  eventVersion: number;
  sequence: number;
  occurredAt: string;
  serverReceivedAt: string;
  clientElapsedMs: number;
  runId: string | null;
  scenarioId: string | null;
  scenarioVersion: string | null;
  moduleId: string | null;
  skillIds: string[];
  payload: TelemetryPayload;
};

export type AppendDecisionEventInput = DecisionEventRecord;

export type AppendDecisionEventsResult = {
  accepted: number;
  duplicates: number;
};

function readDecisionEventRow(row: {
  eventId: string;
  userId: string;
  sessionId: string;
  eventType: string;
  eventVersion: number;
  sequence: number;
  occurredAt: string;
  serverReceivedAt: string;
  clientElapsedMs: number;
  runId: string | null;
  scenarioId: string | null;
  scenarioVersion: string | null;
  moduleId: string | null;
  skillIds: string;
  payloadJson: string;
}): DecisionEventRecord {
  return {
    eventId: row.eventId,
    userId: row.userId,
    sessionId: row.sessionId,
    eventType: row.eventType as DecisionEventType,
    eventVersion: row.eventVersion,
    sequence: row.sequence,
    occurredAt: row.occurredAt,
    serverReceivedAt: row.serverReceivedAt,
    clientElapsedMs: row.clientElapsedMs,
    runId: row.runId,
    scenarioId: row.scenarioId,
    scenarioVersion: row.scenarioVersion,
    moduleId: row.moduleId,
    skillIds: (parseJson(row.skillIds) as string[] | null) ?? [],
    payload: (parseJson(row.payloadJson) as TelemetryPayload | null) ?? {}
  };
}

export function appendDecisionEvents(
  handle: DatabaseHandle,
  inputs: readonly AppendDecisionEventInput[]
): AppendDecisionEventsResult {
  const insert = handle.sqlite.prepare(`
    INSERT INTO decision_events (
      event_id, user_id, session_id, event_type, event_version, sequence,
      occurred_at, server_received_at, client_elapsed_ms,
      run_id, scenario_id, scenario_version, module_id, skill_ids, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO NOTHING
  `);

  let accepted = 0;
  const transaction = handle.sqlite.transaction(() => {
    for (const input of inputs) {
      const changes = insert.run(
        input.eventId,
        input.userId,
        input.sessionId,
        input.eventType,
        input.eventVersion,
        input.sequence,
        input.occurredAt,
        input.serverReceivedAt,
        input.clientElapsedMs,
        input.runId,
        input.scenarioId,
        input.scenarioVersion,
        input.moduleId,
        JSON.stringify(input.skillIds),
        JSON.stringify(input.payload)
      ).changes;
      if (changes > 0) accepted += 1;
    }
  });
  transaction();

  return { accepted, duplicates: inputs.length - accepted };
}

export function listDecisionEventsByRun(
  { sqlite }: DatabaseHandle,
  userId: string,
  runId: string
): DecisionEventRecord[] {
  const rows = sqlite.prepare(`
    SELECT
      event_id AS eventId, user_id AS userId, session_id AS sessionId,
      event_type AS eventType, event_version AS eventVersion, sequence,
      occurred_at AS occurredAt, server_received_at AS serverReceivedAt,
      client_elapsed_ms AS clientElapsedMs, run_id AS runId,
      scenario_id AS scenarioId, scenario_version AS scenarioVersion,
      module_id AS moduleId, skill_ids AS skillIds, payload_json AS payloadJson
    FROM decision_events
    WHERE user_id = ? AND run_id = ?
    ORDER BY sequence ASC, occurred_at ASC, event_id ASC
  `).all(userId, runId) as Array<Parameters<typeof readDecisionEventRow>[0]>;
  return rows.map(readDecisionEventRow);
}


