import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { Pool, type PoolClient } from "pg";

import {
  DecisionTraceSchema,
  HistoricalMarketSnapshotSchema,
  ScenarioPackageSchema,
  ScoreResultSchema,
  KIND_ASSET,
  LedgerEventSchema,
  UserEconomyStateSchema,
  type DecisionTrace,
  type HistoricalMarketSnapshot,
  type LedgerAsset,
  type LedgerEvent,
  type LedgerPage,
  type RiskState,
  type ScenarioPackage,
  type ScoreResult,
  type UserEconomyState
} from "../../contracts/src/index.js";
import {
  applyEnergyRegen,
  energyCostForMode,
  keyConditionsMetForBreakdown,
  masteryStarsForScore,
  xpForCompletion,
  xpGrantedAfterDailyCap,
  XP_REPEAT_WINDOW_MS
} from "../../domain/src/economy.js";
import { applyPostgresMigrations } from "./postgres-migrations.js";
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
import {
  applyLedgerEventToState,
  ENERGY_CAP,
  type AppendDecisionEventsResult,
  type AppendLedgerEventInput,
  type AppendLedgerEventResult,
  type ListLedgerEventsOptions,
  type AuthSessionRecord,
  type CreateAuthSessionInput,
  type CreateLearningAttemptInput,
  type CreateScenarioRunInput,
  type DecisionEventRecord,
  type FinalizeLearningAttemptInput,
  type HistoricalSnapshotRecord,
  type LearningAttemptRecord,
  type LearningModuleRecord,
  type ModuleProgressRecord,
  type PlatformIdentityInput,
  type ScenarioCompletionRewardsInput,
  type ScenarioCompletionRewardsResult,
  type ScenarioRunRecord,
  type ScenarioRunState,
  type StartEligibleRunInput,
  type StartEligibleRunResult,
  type UpsertLearningModuleInput,
  type UpsertModuleProgressInput
} from "./repository.js";
import type { PersistencePort } from "./ports.js";

type QueryRow = Record<string, unknown>;

type SqlQueryable = {
  query<T extends QueryRow = QueryRow>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: T[] }>;
};

export type PostgresPersistenceAdapterOptions = {
  connectionString?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  pool?: Pool;
};

type ScenarioRunDbRow = {
  runId: string;
  userId: string;
  scenarioId: string;
  scenarioVersion: string;
  state: string;
  idempotencyKey: string;
  decisionJson: unknown;
  scoreJson: unknown;
  createdAt: unknown;
  sealedAt: unknown;
  revealedAt: unknown;
  completedAt: unknown;
};

type LedgerDbRow = {
  id: string;
  userId: string;
  kind: string;
  asset: string;
  amount: number;
  reason: string;
  promo: boolean;
  runId: string | null;
  scenarioId: string | null;
  sourceId: string | null;
  riskState: string;
  idempotencyKey: string;
  createdAt: unknown;
};

function sql(executor: SqlQueryable | PoolClient): SqlQueryable {
  return executor as SqlQueryable;
}

async function queryRows<T extends QueryRow>(
  executor: SqlQueryable | PoolClient,
  text: string,
  values: readonly unknown[] = []
): Promise<T[]> {
  return (await sql(executor).query<T>(text, [...values])).rows;
}

function parseJsonValue(value: unknown): unknown | null {
  if (value === null) {
    return null;
  }
  return typeof value === "string" ? JSON.parse(value) as unknown : value;
}

function readTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    return value;
  }
  throw new Error("PostgreSQL returned an unsupported timestamp value");
}

function readRequiredTimestamp(value: unknown): string {
  const timestamp = readTimestamp(value);
  if (!timestamp) {
    throw new Error("PostgreSQL returned a missing required timestamp");
  }
  return timestamp;
}

function readScenarioRunRow(row: ScenarioRunDbRow): ScenarioRunRecord {
  const state = row.state as ScenarioRunState;
  if (!(["started", "sealed", "revealed", "completed"] as string[]).includes(state)) {
    throw new Error(`Unknown scenario run state: ${row.state}`);
  }

  return {
    runId: row.runId,
    userId: row.userId,
    scenarioId: row.scenarioId,
    scenarioVersion: row.scenarioVersion,
    state,
    idempotencyKey: row.idempotencyKey,
    decision: row.decisionJson === null
      ? null
      : DecisionTraceSchema.parse(parseJsonValue(row.decisionJson)),
    score: row.scoreJson === null
      ? null
      : ScoreResultSchema.parse(parseJsonValue(row.scoreJson)),
    createdAt: readRequiredTimestamp(row.createdAt),
    sealedAt: readTimestamp(row.sealedAt),
    revealedAt: readTimestamp(row.revealedAt),
    completedAt: readTimestamp(row.completedAt)
  };
}

const SCENARIO_RUN_SELECT = `
  SELECT
    run_id AS "runId",
    user_id AS "userId",
    scenario_id AS "scenarioId",
    scenario_version AS "scenarioVersion",
    state,
    idempotency_key AS "idempotencyKey",
    decision_json AS "decisionJson",
    score_json AS "scoreJson",
    created_at AS "createdAt",
    sealed_at AS "sealedAt",
    revealed_at AS "revealedAt",
    completed_at AS "completedAt"
  FROM scenario_runs
`;

const LEDGER_EVENT_SELECT_COLUMNS = `
    id,
    user_id AS "userId",
    kind,
    asset,
    amount,
    reason,
    promo,
    run_id AS "runId",
    scenario_id AS "scenarioId",
    source_id AS "sourceId",
    risk_state AS "riskState",
    idempotency_key AS "idempotencyKey",
    created_at AS "createdAt"
`;

export class PostgresPersistenceAdapter implements PersistencePort {
  public readonly pool: Pool;
  private readonly ownsPool: boolean;

  public constructor(options: PostgresPersistenceAdapterOptions) {
    if (options.pool) {
      this.pool = options.pool;
      this.ownsPool = false;
      return;
    }

    if (!options.connectionString) {
      throw new Error("PostgreSQL persistence requires DATABASE_URL");
    }

    this.pool = new Pool({
      connectionString: options.connectionString,
      ...(options.max === undefined ? {} : { max: options.max }),
      ...(options.idleTimeoutMillis === undefined ? {} : { idleTimeoutMillis: options.idleTimeoutMillis }),
      ...(options.connectionTimeoutMillis === undefined ? {} : { connectionTimeoutMillis: options.connectionTimeoutMillis })
    });
    this.ownsPool = true;
  }

  public async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await applyPostgresMigrations({
        query: async (text, parameters) => ({
          rows: await queryRows(client, text, parameters ?? [])
        })
      });
    } finally {
      client.release();
    }
  }

  public async checkReadiness(): Promise<void> {
    const rows = await queryRows<{ tableName: string | null }>(this.pool, `
      SELECT to_regclass('public.scenarios') AS "tableName";
    `);
    if (rows[0]?.tableName !== "scenarios") {
      throw new Error("PostgreSQL schema is not migrated");
    }
  }

  public async close(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end();
    }
  }

  public async getOrCreateUserForIdentity(
    input: PlatformIdentityInput
  ): Promise<{ userId: string; created: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN;");
      const existingIdentity = (await queryRows<{ userId: string }>(client, `
        SELECT user_id AS "userId"
        FROM user_identities
        WHERE provider = $1 AND provider_user_id = $2
      `, [input.provider, input.providerUserId]))[0];

      if (existingIdentity) {
        await client.query("COMMIT;");
        return { userId: existingIdentity.userId, created: false };
      }

      const externalId = `${input.provider}:${input.providerUserId}`;
      const candidateUserId = randomUUID();
      const createdAt = new Date().toISOString();
      const insertedUser = await queryRows<{ userId: string }>(client, `
        INSERT INTO users (user_id, external_id, created_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (external_id) DO NOTHING
        RETURNING user_id AS "userId"
      `, [candidateUserId, externalId, createdAt]);
      const persistedUser = insertedUser[0] ?? (await queryRows<{ userId: string }>(client, `
        SELECT user_id AS "userId"
        FROM users
        WHERE external_id = $1
      `, [externalId]))[0];

      if (!persistedUser) {
        throw new Error("User was not persisted");
      }

      await queryRows(client, `
        INSERT INTO user_identities (
          identity_id,
          user_id,
          provider,
          provider_user_id,
          created_at
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (provider, provider_user_id) DO NOTHING
      `, [randomUUID(), persistedUser.userId, input.provider, input.providerUserId, createdAt]);
      const identity = (await queryRows<{ userId: string }>(client, `
        SELECT user_id AS "userId"
        FROM user_identities
        WHERE provider = $1 AND provider_user_id = $2
      `, [input.provider, input.providerUserId]))[0];

      if (!identity) {
        throw new Error("User identity was not persisted");
      }

      await client.query("COMMIT;");
      return { userId: identity.userId, created: insertedUser.length === 1 };
    } catch (error) {
      await client.query("ROLLBACK;");
      throw error;
    } finally {
      client.release();
    }
  }

  public async consumeAuthReplayKey(
    replayKey: string,
    expiresAtMs: number,
    nowMs = Date.now()
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN;");
      await queryRows(client, "DELETE FROM auth_replay_keys WHERE expires_at <= $1;", [
        new Date(nowMs).toISOString()
      ]);
      const inserted = await queryRows<{ replayKey: string }>(client, `
        INSERT INTO auth_replay_keys (replay_key, expires_at)
        VALUES ($1, $2)
        ON CONFLICT (replay_key) DO NOTHING
        RETURNING replay_key AS "replayKey"
      `, [replayKey, new Date(expiresAtMs).toISOString()]);
      await client.query("COMMIT;");
      return inserted.length === 1;
    } catch (error) {
      await client.query("ROLLBACK;");
      throw error;
    } finally {
      client.release();
    }
  }

  public async createAuthSession(input: CreateAuthSessionInput): Promise<AuthSessionRecord> {
    await queryRows(this.pool, `
      INSERT INTO auth_sessions (
        session_id,
        user_id,
        token_hash,
        created_at,
        expires_at
      ) VALUES ($1, $2, $3, $4, $5)
    `, [input.sessionId, input.userId, input.tokenHash, input.createdAt, input.expiresAt]);

    return { ...input, revokedAt: null };
  }

  public async getActiveAuthSession(
    tokenHash: string,
    now = new Date().toISOString()
  ): Promise<AuthSessionRecord | undefined> {
    const row = (await queryRows<{
      sessionId: string;
      userId: string;
      tokenHash: string;
      createdAt: unknown;
      expiresAt: unknown;
      revokedAt: unknown;
    }>(this.pool, `
      SELECT
        session_id AS "sessionId",
        user_id AS "userId",
        token_hash AS "tokenHash",
        created_at AS "createdAt",
        expires_at AS "expiresAt",
        revoked_at AS "revokedAt"
      FROM auth_sessions
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND expires_at > $2
    `, [tokenHash, now]))[0];
    return row
      ? {
        sessionId: row.sessionId,
        userId: row.userId,
        tokenHash: row.tokenHash,
        createdAt: readRequiredTimestamp(row.createdAt),
        expiresAt: readRequiredTimestamp(row.expiresAt),
        revokedAt: readTimestamp(row.revokedAt)
      }
      : undefined;
  }

  public async revokeAuthSession(
    sessionId: string,
    revokedAt = new Date().toISOString()
  ): Promise<boolean> {
    const rows = await queryRows<{ sessionId: string }>(this.pool, `
      UPDATE auth_sessions
      SET revoked_at = $1
      WHERE session_id = $2 AND revoked_at IS NULL
      RETURNING session_id AS "sessionId"
    `, [revokedAt, sessionId]);
    return rows.length === 1;
  }

  public async upsertHistoricalSnapshot(
    snapshot: HistoricalMarketSnapshot,
    snapshotId: string = randomUUID(),
    createdAt: string = new Date().toISOString()
  ): Promise<HistoricalSnapshotRecord> {
    const parsed = HistoricalMarketSnapshotSchema.parse(snapshot);
    await queryRows(this.pool, `
      INSERT INTO historical_snapshots (
        snapshot_id,
        provider,
        symbol,
        interval,
        as_of,
        content_hash,
        snapshot_json,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      ON CONFLICT (content_hash) DO NOTHING
    `, [
      snapshotId,
      parsed.provider,
      parsed.symbol,
      parsed.interval,
      parsed.asOf,
      parsed.provenance.contentHash,
      JSON.stringify(parsed),
      createdAt
    ]);
    const row = (await queryRows<{
      snapshotId: string;
      provider: "binance";
      symbol: string;
      interval: string;
      asOf: unknown;
      contentHash: string;
      snapshotJson: unknown;
      createdAt: unknown;
    }>(this.pool, `
      SELECT
        snapshot_id AS "snapshotId",
        provider,
        symbol,
        interval,
        as_of AS "asOf",
        content_hash AS "contentHash",
        snapshot_json AS "snapshotJson",
        created_at AS "createdAt"
      FROM historical_snapshots
      WHERE content_hash = $1
    `, [parsed.provenance.contentHash]))[0];

    if (!row) {
      throw new Error(`Historical snapshot was not persisted: ${parsed.provenance.contentHash}`);
    }

    return {
      snapshotId: row.snapshotId,
      provider: row.provider,
      symbol: row.symbol,
      interval: row.interval,
      asOf: readRequiredTimestamp(row.asOf),
      contentHash: row.contentHash,
      snapshot: HistoricalMarketSnapshotSchema.parse(parseJsonValue(row.snapshotJson)),
      createdAt: readRequiredTimestamp(row.createdAt)
    };
  }

  public async getHistoricalSnapshot(
    snapshotId: string
  ): Promise<HistoricalSnapshotRecord | undefined> {
    const row = (await queryRows<{
      snapshotId: string;
      provider: "binance";
      symbol: string;
      interval: string;
      asOf: unknown;
      contentHash: string;
      snapshotJson: unknown;
      createdAt: unknown;
    }>(this.pool, `
      SELECT
        snapshot_id AS "snapshotId",
        provider,
        symbol,
        interval,
        as_of AS "asOf",
        content_hash AS "contentHash",
        snapshot_json AS "snapshotJson",
        created_at AS "createdAt"
      FROM historical_snapshots
      WHERE snapshot_id = $1
    `, [snapshotId]))[0];

    if (!row) {
      return undefined;
    }

    return {
      snapshotId: row.snapshotId,
      provider: row.provider,
      symbol: row.symbol,
      interval: row.interval,
      asOf: readRequiredTimestamp(row.asOf),
      contentHash: row.contentHash,
      snapshot: HistoricalMarketSnapshotSchema.parse(parseJsonValue(row.snapshotJson)),
      createdAt: readRequiredTimestamp(row.createdAt)
    };
  }

  public async getScenarioPackage(
    scenarioId: string,
    version: string
  ): Promise<ScenarioPackage | undefined> {
    const row = (await queryRows<{ packageJson: unknown }>(this.pool, `
      SELECT package_json AS "packageJson"
      FROM scenarios
      WHERE scenario_id = $1 AND version = $2
    `, [scenarioId, version]))[0];
    return row
      ? ScenarioPackageSchema.parse(parseJsonValue(row.packageJson))
      : undefined;
  }

  public async createScenarioRun(input: CreateScenarioRunInput): Promise<ScenarioRunRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN;");
      const run = await this.createScenarioRunOn(client, input);
      await client.query("COMMIT;");
      return run;
    } catch (error) {
      await client.query("ROLLBACK;");
      throw error;
    } finally {
      client.release();
    }
  }

  private async createScenarioRunOn(
    executor: SqlQueryable,
    input: CreateScenarioRunInput
  ): Promise<ScenarioRunRecord> {
    const createdAt = new Date().toISOString();
    await queryRows(executor, `
      INSERT INTO scenario_runs (
        run_id,
        user_id,
        scenario_id,
        scenario_version,
        state,
        idempotency_key,
        created_at
      ) VALUES ($1, $2, $3, $4, 'started', $5, $6)
      ON CONFLICT (idempotency_key) DO NOTHING
    `, [
      input.runId,
      input.userId,
      input.scenarioId,
      input.scenarioVersion,
      input.idempotencyKey,
      createdAt
    ]);

    const record = (await queryRows<ScenarioRunDbRow>(executor, `
      ${SCENARIO_RUN_SELECT}
      WHERE idempotency_key = $1
    `, [input.idempotencyKey]))[0];
    if (!record) {
      throw new Error(`Scenario run was not persisted: ${input.idempotencyKey}`);
    }

    const result = readScenarioRunRow(record);
    if (
      result.userId !== input.userId
      || result.scenarioId !== input.scenarioId
      || result.scenarioVersion !== input.scenarioVersion
    ) {
      throw new Error(`Idempotency key is bound to a different scenario run: ${input.idempotencyKey}`);
    }
    return result;
  }

  private async getScenarioRunByIdempotencyKey(
    executor: SqlQueryable,
    idempotencyKey: string
  ): Promise<ScenarioRunRecord | undefined> {
    const row = (await queryRows<ScenarioRunDbRow>(executor, `
      ${SCENARIO_RUN_SELECT}
      WHERE idempotency_key = $1
    `, [idempotencyKey]))[0];
    return row ? readScenarioRunRow(row) : undefined;
  }

  public async getScenarioRun(
    runId: string,
    userId: string
  ): Promise<ScenarioRunRecord | undefined> {
    const row = (await queryRows<ScenarioRunDbRow>(this.pool, `
      ${SCENARIO_RUN_SELECT}
      WHERE run_id = $1 AND user_id = $2
    `, [runId, userId]))[0];
    return row ? readScenarioRunRow(row) : undefined;
  }

  public async sealScenarioRun(
    runId: string,
    userId: string,
    decision: DecisionTrace,
    score: ScoreResult
  ): Promise<ScenarioRunRecord> {
    const parsedDecision = DecisionTraceSchema.parse(decision);
    const parsedScore = ScoreResultSchema.parse(score);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN;");
      const currentRow = (await queryRows<ScenarioRunDbRow>(client, `
        ${SCENARIO_RUN_SELECT}
        WHERE run_id = $1 AND user_id = $2
        FOR UPDATE
      `, [runId, userId]))[0];
      if (!currentRow) {
        throw new Error(`Scenario run was not found: ${runId}`);
      }
      const current = readScenarioRunRow(currentRow);
      if (current.state !== "started") {
        if (current.decision && isDeepStrictEqual(current.decision, parsedDecision)) {
          await client.query("COMMIT;");
          return current;
        }
        throw new Error(`Scenario run is already sealed: ${runId}`);
      }

      const sealedAt = new Date().toISOString();
      await queryRows(client, `
        UPDATE scenario_runs
        SET state = 'sealed', decision_json = $1::jsonb, score_json = $2::jsonb, sealed_at = $3
        WHERE run_id = $4 AND user_id = $5 AND state = 'started'
      `, [JSON.stringify(parsedDecision), JSON.stringify(parsedScore), sealedAt, runId, userId]);
      const sealedRow = (await queryRows<ScenarioRunDbRow>(client, `
        ${SCENARIO_RUN_SELECT}
        WHERE run_id = $1 AND user_id = $2
      `, [runId, userId]))[0];
      if (!sealedRow) {
        throw new Error(`Scenario run disappeared while sealing: ${runId}`);
      }
      const sealed = readScenarioRunRow(sealedRow);
      if (!["sealed", "revealed", "completed"].includes(sealed.state)) {
        throw new Error(`Scenario run was not sealed: ${runId}`);
      }
      await client.query("COMMIT;");
      return sealed;
    } catch (error) {
      await client.query("ROLLBACK;");
      throw error;
    } finally {
      client.release();
    }
  }

  public async revealScenarioRun(
    runId: string,
    userId: string
  ): Promise<ScenarioRunRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN;");
      const currentRow = (await queryRows<ScenarioRunDbRow>(client, `
        ${SCENARIO_RUN_SELECT}
        WHERE run_id = $1 AND user_id = $2
        FOR UPDATE
      `, [runId, userId]))[0];
      if (!currentRow) {
        throw new Error(`Scenario run was not found: ${runId}`);
      }
      const current = readScenarioRunRow(currentRow);
      if (current.state === "started") {
        throw new Error(`Scenario run must be sealed before reveal: ${runId}`);
      }
      if (current.state === "revealed" || current.state === "completed") {
        await client.query("COMMIT;");
        return current;
      }

      const revealedAt = new Date().toISOString();
      await queryRows(client, `
        UPDATE scenario_runs
        SET state = 'revealed', revealed_at = $1
        WHERE run_id = $2 AND user_id = $3 AND state = 'sealed'
      `, [revealedAt, runId, userId]);
      const revealedRow = (await queryRows<ScenarioRunDbRow>(client, `
        ${SCENARIO_RUN_SELECT}
        WHERE run_id = $1 AND user_id = $2
      `, [runId, userId]))[0];
      if (!revealedRow) {
        throw new Error(`Scenario run was not revealed: ${runId}`);
      }
      const revealed = readScenarioRunRow(revealedRow);
      if (revealed.state !== "revealed" && revealed.state !== "completed") {
        throw new Error(`Scenario run was not revealed: ${runId}`);
      }
      await client.query("COMMIT;");
      return revealed;
    } catch (error) {
      await client.query("ROLLBACK;");
      throw error;
    } finally {
      client.release();
    }
  }

  private async readEconomyState(
    executor: SqlQueryable,
    userId: string
  ): Promise<UserEconomyState | undefined> {
    const row = (await queryRows<{
      userId: string;
      xp: number;
      coins: number;
      promoCoins: number;
      masteryStars: number;
      energy: number;
      energyUpdatedAt: unknown;
      version: number;
    }>(executor, `
      SELECT
        user_id AS "userId",
        xp,
        coins,
        promo_coins AS "promoCoins",
        mastery_stars AS "masteryStars",
        energy,
        energy_updated_at AS "energyUpdatedAt",
        version
      FROM user_economy_state
      WHERE user_id = $1
    `, [userId]))[0];
    if (!row) {
      return undefined;
    }
    return UserEconomyStateSchema.parse({
      userId: row.userId,
      xp: row.xp,
      coins: row.coins,
      promoCoins: row.promoCoins,
      masteryStars: row.masteryStars,
      energy: row.energy,
      energyUpdatedAt: readRequiredTimestamp(row.energyUpdatedAt),
      version: row.version
    });
  }

  private async ensureEconomyStateRow(
    executor: SqlQueryable,
    userId: string,
    now: string
  ): Promise<UserEconomyState> {
    await queryRows(executor, `
      INSERT INTO user_economy_state (user_id, energy_updated_at)
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO NOTHING
    `, [userId, now]);
    const state = await this.readEconomyState(executor, userId);
    if (!state) {
      throw new Error(`Economy state was not initialized for user: ${userId}`);
    }
    return state;
  }

  private mapLedgerRow(row: LedgerDbRow): LedgerEvent {
    return LedgerEventSchema.parse({
      id: row.id,
      userId: row.userId,
      kind: row.kind,
      asset: row.asset,
      amount: row.amount,
      reason: row.reason,
      promo: row.promo,
      runId: row.runId,
      scenarioId: row.scenarioId,
      sourceId: row.sourceId,
      riskState: row.riskState,
      idempotencyKey: row.idempotencyKey,
      createdAt: readRequiredTimestamp(row.createdAt)
    });
  }

  private async selectLedgerEvent(
    executor: SqlQueryable,
    userId: string,
    idempotencyKey: string
  ): Promise<LedgerEvent | undefined> {
    const row = (await queryRows<LedgerDbRow>(executor, `SELECT ${LEDGER_EVENT_SELECT_COLUMNS} FROM ledger_events WHERE user_id = $1 AND idempotency_key = $2`, [userId, idempotencyKey]))[0];
    return row ? this.mapLedgerRow(row) : undefined;
  }

  private async writeEconomyStateRow(
    executor: SqlQueryable,
    state: UserEconomyState
  ): Promise<void> {
    await queryRows(executor, `
      UPDATE user_economy_state
      SET xp = $1, coins = $2, promo_coins = $3, mastery_stars = $4, energy = $5,
          energy_updated_at = $6, version = $7
      WHERE user_id = $8
    `, [
      state.xp,
      state.coins,
      state.promoCoins,
      state.masteryStars,
      state.energy,
      state.energyUpdatedAt,
      state.version,
      state.userId
    ]);
  }

  public async getEconomyState(userId: string): Promise<UserEconomyState | undefined> {
    return this.readEconomyState(this.pool, userId);
  }

  public async ensureEconomyState(userId: string, now?: string): Promise<UserEconomyState> {
    return this.ensureEconomyStateRow(this.pool, userId, now ?? new Date().toISOString());
  }

  /**
   * Append one ledger event inside an already-open transaction. Mirrors the
   * SQLite repository: the cached projection advances only on a real insert; a
   * replayed key with the same payload returns the prior result, and a key
   * reused with a different payload throws `ledger_idempotency_conflict`.
   */
  private async appendLedgerEventOn(
    client: PoolClient,
    input: AppendLedgerEventInput
  ): Promise<AppendLedgerEventResult> {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const runId = input.runId ?? null;
    const scenarioId = input.scenarioId ?? null;
    const sourceId = input.sourceId ?? null;
    const riskState: RiskState = input.riskState ?? "clear";
    const asset: LedgerAsset = KIND_ASSET[input.kind];
    const id = input.id ?? randomUUID();

    await this.ensureEconomyStateRow(client, input.userId, createdAt);

    const existing = await this.selectLedgerEvent(client, input.userId, input.idempotencyKey);
    if (existing) {
      const matches =
        existing.kind === input.kind &&
        existing.asset === asset &&
        existing.amount === input.amount &&
        existing.promo === input.promo &&
        (existing.runId ?? null) === runId &&
        (existing.scenarioId ?? null) === scenarioId &&
        (existing.sourceId ?? null) === sourceId;
      if (!matches) {
        throw new Error(`ledger_idempotency_conflict: ${input.idempotencyKey}`);
      }
      const state = (await this.readEconomyState(client, input.userId))!;
      return { event: existing, state, created: false };
    }

    await queryRows(client, `
      INSERT INTO ledger_events (
        id, user_id, kind, asset, amount, reason, promo, run_id,
        scenario_id, source_id, risk_state, idempotency_key, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [
      id,
      input.userId,
      input.kind,
      asset,
      input.amount,
      input.reason,
      input.promo,
      runId,
      scenarioId,
      sourceId,
      riskState,
      input.idempotencyKey,
      createdAt
    ]);

    const base = (await this.readEconomyState(client, input.userId))!;
    const next = applyLedgerEventToState(base, {
      kind: input.kind,
      amount: input.amount,
      promo: input.promo
    });
    await this.writeEconomyStateRow(client, next);

    const event = (await this.selectLedgerEvent(client, input.userId, input.idempotencyKey))!;
    const state = (await this.readEconomyState(client, input.userId))!;
    return { event, state, created: true };
  }

  public async appendLedgerEvent(
    input: AppendLedgerEventInput
  ): Promise<AppendLedgerEventResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN;");
      const result = await this.appendLedgerEventOn(client, input);
      await client.query("COMMIT;");
      return result;
    } catch (error) {
      await client.query("ROLLBACK;");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Lazily regenerate Energy inside an open transaction, preserving the partial
   * interval remainder via an idempotent `energy_regenerated` event keyed by the
   * new anchor epoch. When the bar is already full the anchor moves to `now`
   * without a grant event.
   */
  private async applyLazyRegenOn(
    client: PoolClient,
    userId: string,
    now: string
  ): Promise<UserEconomyState> {
    const state = await this.ensureEconomyStateRow(client, userId, now);
    const elapsedMs = Math.max(0, Date.parse(now) - Date.parse(state.energyUpdatedAt));
    if (elapsedMs === 0) return state;

    const regen = applyEnergyRegen(state.energy, elapsedMs);

    if (regen.energy === state.energy) {
      if (state.energy >= ENERGY_CAP) {
        const reanchored = UserEconomyStateSchema.parse({ ...state, energyUpdatedAt: now });
        await this.writeEconomyStateRow(client, reanchored);
        return reanchored;
      }
      return state;
    }

    const newAnchorMs = Date.parse(state.energyUpdatedAt) + regen.advancedMs;
    await this.appendLedgerEventOn(client, {
      userId,
      kind: "energy_regenerated",
      amount: regen.energy - state.energy,
      reason: "timer_regen",
      promo: false,
      idempotencyKey: `energy:regen:${userId}:${newAnchorMs}`,
      createdAt: now
    });
    const after = (await this.readEconomyState(client, userId))!;
    const withAnchor = UserEconomyStateSchema.parse({
      ...after,
      energyUpdatedAt: new Date(newAnchorMs).toISOString()
    });
    await this.writeEconomyStateRow(client, withAnchor);
    return withAnchor;
  }

  /**
   * Read-only projection of balance with regeneration applied for display; never
   * persists, so `GET /balance` stays side-effect free with respect to the ledger.
   */
  public async projectEconomyState(userId: string, now?: string): Promise<UserEconomyState> {
    const timestamp = now ?? new Date().toISOString();
    const state =
      (await this.readEconomyState(this.pool, userId)) ??
      (await this.ensureEconomyStateRow(this.pool, userId, timestamp));
    const elapsedMs = Math.max(0, Date.parse(timestamp) - Date.parse(state.energyUpdatedAt));
    const regen = applyEnergyRegen(state.energy, elapsedMs);
    if (regen.energy === state.energy) return state;
    return UserEconomyStateSchema.parse({ ...state, energy: regen.energy });
  }

  public async startEligibleScenarioRun(
    input: StartEligibleRunInput
  ): Promise<StartEligibleRunResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN;");
      const now = input.occurredAt ?? new Date().toISOString();
      const state = await this.applyLazyRegenOn(client, input.userId, now);

      const existing = await this.getScenarioRunByIdempotencyKey(client, input.idempotencyKey);
      if (existing) {
        if (existing.userId !== input.userId) {
          throw new Error(`Idempotency key is bound to a different scenario run: ${input.idempotencyKey}`);
        }
        await client.query("COMMIT;");
        return { run: existing, state, energySpent: 0, insufficientEnergy: false };
      }

      const cost = energyCostForMode(input.scenarioMode);
      if (cost > state.energy) {
        await client.query("COMMIT;");
        return { run: null, state, energySpent: 0, insufficientEnergy: true };
      }

      // Create the run first so a spend event can reference it via the ledger
      // `run_id` foreign key; both happen in this one transaction.
      const run = await this.createScenarioRunOn(client, {
        runId: input.runId,
        userId: input.userId,
        scenarioId: input.scenarioId,
        scenarioVersion: input.scenarioVersion,
        idempotencyKey: input.idempotencyKey
      });

      if (cost > 0) {
        await this.appendLedgerEventOn(client, {
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

      const finalState = (await this.readEconomyState(client, input.userId))!;
      await client.query("COMMIT;");
      return { run, state: finalState, energySpent: cost, insufficientEnergy: false };
    } catch (error) {
      await client.query("ROLLBACK;");
      throw error;
    } finally {
      client.release();
    }
  }

  public async applyScenarioCompletionRewards(
    input: ScenarioCompletionRewardsInput
  ): Promise<ScenarioCompletionRewardsResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN;");
      const now = input.occurredAt ?? new Date().toISOString();
      await this.ensureEconomyStateRow(client, input.userId, now);

      const prior = (await queryRows<{
        rewardGrantId: string;
        xpGranted: number;
        masteryDelta: number;
      }>(client, `
        SELECT
          reward_grant_id AS "rewardGrantId",
          xp_granted AS "xpGranted",
          mastery_delta AS "masteryDelta"
        FROM reward_grants
        WHERE user_id = $1 AND run_id = $2
      `, [input.userId, input.runId]))[0];

      if (prior) {
        const state = (await this.readEconomyState(client, input.userId))!;
        await client.query("COMMIT;");
        return {
          granted: false,
          rewardGrantId: prior.rewardGrantId,
          xpGranted: prior.xpGranted,
          masteryDelta: prior.masteryDelta,
          events: [],
          state
        };
      }

      const comp = (await queryRows<{
        completions: number;
        bestScore: number;
        lastCompletedAt: unknown;
      }>(client, `
        SELECT
          completions,
          best_score AS "bestScore",
          last_completed_at AS "lastCompletedAt"
        FROM scenario_completions
        WHERE user_id = $1 AND scenario_id = $2 AND scenario_version = $3
      `, [input.userId, input.scenarioId, input.scenarioVersion]))[0];

      const firstCompletion = !comp;
      const withinWindow = comp
        ? Date.parse(now) - Date.parse(readRequiredTimestamp(comp.lastCompletedAt)) <= XP_REPEAT_WINDOW_MS
        : false;
      const qualifiesForReduced = comp ? input.qualityScore > comp.bestScore : false;
      const desiredXp = xpForCompletion({
        qualityScore: input.qualityScore,
        firstCompletion,
        withinWindow,
        qualifiesForReduced
      });

      const todayRow = (await queryRows<{ total: number }>(client, `
        SELECT COALESCE(SUM(amount), 0)::int AS total
        FROM ledger_events
        WHERE user_id = $1
          AND kind = 'xp_awarded'
          AND created_at::date = ($2::timestamptz)::date
      `, [input.userId, now]))[0];
      const todayXp = todayRow?.total ?? 0;
      const xpGranted = xpGrantedAfterDailyCap(desiredXp, todayXp);

      const events: LedgerEvent[] = [];
      if (xpGranted > 0) {
        const xpEvent = await this.appendLedgerEventOn(client, {
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
      const prevMastery = (await queryRows<{ bestStars: number }>(client, `
        SELECT best_stars AS "bestStars"
        FROM user_scenario_mastery
        WHERE user_id = $1 AND scenario_id = $2
      `, [input.userId, input.scenarioId]))[0];
      const prevBest = prevMastery?.bestStars ?? 0;
      const masteryDelta = Math.max(0, earnedStars - prevBest);

      if (masteryDelta > 0) {
        const masteryEvent = await this.appendLedgerEventOn(client, {
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

      await queryRows(client, `
        INSERT INTO user_scenario_mastery (user_id, scenario_id, best_stars, best_score, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, scenario_id) DO UPDATE SET
          best_stars = GREATEST(user_scenario_mastery.best_stars, EXCLUDED.best_stars),
          best_score = GREATEST(user_scenario_mastery.best_score, EXCLUDED.best_score),
          updated_at = EXCLUDED.updated_at
      `, [input.userId, input.scenarioId, earnedStars, input.qualityScore, now]);

      await queryRows(client, `
        INSERT INTO scenario_completions (
          user_id, scenario_id, scenario_version, completions, best_score,
          first_completed_at, last_completed_at
        ) VALUES ($1, $2, $3, 1, $4, $5, $5)
        ON CONFLICT (user_id, scenario_id, scenario_version) DO UPDATE SET
          completions = scenario_completions.completions + 1,
          best_score = GREATEST(scenario_completions.best_score, EXCLUDED.best_score),
          last_completed_at = EXCLUDED.last_completed_at
      `, [input.userId, input.scenarioId, input.scenarioVersion, input.qualityScore, now]);

      const rewardGrantId = randomUUID();
      await queryRows(client, `
        INSERT INTO reward_grants (
          reward_grant_id, user_id, run_id, scenario_id, xp_granted, mastery_delta, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [rewardGrantId, input.userId, input.runId, input.scenarioId, xpGranted, masteryDelta, now]);

      const state = (await this.readEconomyState(client, input.userId))!;
      await client.query("COMMIT;");
      return { granted: true, rewardGrantId, xpGranted, masteryDelta, events, state };
    } catch (error) {
      await client.query("ROLLBACK;");
      throw error;
    } finally {
      client.release();
    }
  }

  public async listLedgerEvents(
    userId: string,
    options: ListLedgerEventsOptions = {}
  ): Promise<LedgerPage> {
    const limit = Math.max(1, Math.min(100, options.limit ?? 20));
    const after = options.after ?? null;

    let rows: LedgerDbRow[];
    if (after) {
      const anchor = (await queryRows<{ createdAt: unknown; id: string }>(this.pool, `
        SELECT created_at AS "createdAt", id
        FROM ledger_events
        WHERE id = $1 AND user_id = $2
      `, [after, userId]))[0];
      if (!anchor) {
        throw new Error(`invalid ledger cursor: ${after}`);
      }
      const anchorAt = readRequiredTimestamp(anchor.createdAt);
      rows = await queryRows<LedgerDbRow>(this.pool, `
        SELECT ${LEDGER_EVENT_SELECT_COLUMNS}
        FROM ledger_events
        WHERE user_id = $1
          AND (created_at < $2 OR (created_at = $2 AND id < $3))
        ORDER BY created_at DESC, id DESC
        LIMIT $4
      `, [userId, anchorAt, anchor.id, limit]);
    } else {
      rows = await queryRows<LedgerDbRow>(this.pool, `
        SELECT ${LEDGER_EVENT_SELECT_COLUMNS}
        FROM ledger_events
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2
      `, [userId, limit]);
    }

    const events = rows.map((row) => this.mapLedgerRow(row));
    const nextCursor = rows.length === limit ? rows[rows.length - 1]!.id : null;
    return { events, nextCursor };
  }

  // --- Academy Level 0 learning persistence (Iteration 04 Phase 2) ----------

  public async upsertLearningModule(
    input: UpsertLearningModuleInput
  ): Promise<LearningModuleRecord> {
    const content = AcademyModuleSchema.parse(input.content);
    const now = new Date().toISOString();
    await queryRows(this.pool, `
      INSERT INTO learning_modules (
        module_id, version, title, level, content_json, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
      ON CONFLICT(module_id, version) DO UPDATE SET
        title = excluded.title,
        level = excluded.level,
        content_json = excluded.content_json,
        status = excluded.status,
        updated_at = excluded.updated_at
    `, [
      content.moduleId, content.version, input.title, input.level,
      JSON.stringify(content), input.status, now, now
    ]);
    return (await this.getLearningModule(content.moduleId, content.version))!;
  }

  public async getLearningModule(
    moduleId: string,
    version: string
  ): Promise<LearningModuleRecord | undefined> {
    const row = (await queryRows<{
      moduleId: string;
      version: string;
      title: string;
      level: number;
      contentJson: unknown;
      status: string;
      createdAt: unknown;
      updatedAt: unknown;
    }>(this.pool, `
      SELECT
        module_id AS "moduleId", version, title, level,
        content_json AS "contentJson", status,
        created_at AS "createdAt", updated_at AS "updatedAt"
      FROM learning_modules
      WHERE module_id = $1 AND version = $2
    `, [moduleId, version]))[0];
    if (!row) {
      return undefined;
    }
    return {
      moduleId: row.moduleId,
      version: row.version,
      title: row.title,
      level: row.level,
      content: AcademyModuleSchema.parse(parseJsonValue(row.contentJson)),
      status: row.status as LearningPublicationStatus,
      createdAt: readRequiredTimestamp(row.createdAt),
      updatedAt: readRequiredTimestamp(row.updatedAt)
    };
  }

  public async getModuleProgress(
    userId: string,
    moduleId: string,
    moduleVersion: string
  ): Promise<ModuleProgressRecord | undefined> {
    const row = (await queryRows<{
      userId: string;
      moduleId: string;
      moduleVersion: string;
      status: string;
      startedAt: unknown;
      verifiedAt: unknown;
      masteredAt: unknown;
      reviewDueAt: unknown;
      verificationSource: string | null;
      bestScore: number;
      version: number;
    }>(this.pool, `
      SELECT
        user_id AS "userId", module_id AS "moduleId", module_version AS "moduleVersion",
        status, started_at AS "startedAt", verified_at AS "verifiedAt",
        mastered_at AS "masteredAt", review_due_at AS "reviewDueAt",
        verification_source AS "verificationSource", best_score AS "bestScore", version
      FROM user_module_progress
      WHERE user_id = $1 AND module_id = $2 AND module_version = $3
    `, [userId, moduleId, moduleVersion]))[0];
    if (!row) {
      return undefined;
    }
    return {
      userId: row.userId,
      moduleId: row.moduleId,
      moduleVersion: row.moduleVersion,
      status: row.status as LearningStatus,
      startedAt: readTimestamp(row.startedAt),
      verifiedAt: readTimestamp(row.verifiedAt),
      masteredAt: readTimestamp(row.masteredAt),
      reviewDueAt: readTimestamp(row.reviewDueAt),
      verificationSource: (row.verificationSource as VerificationSource | null) ?? null,
      bestScore: row.bestScore,
      version: row.version
    };
  }

  public async upsertModuleProgress(
    input: UpsertModuleProgressInput
  ): Promise<ModuleProgressRecord> {
    await queryRows(this.pool, `
      INSERT INTO user_module_progress (
        user_id, module_id, module_version, status,
        started_at, verified_at, mastered_at, review_due_at,
        verification_source, best_score, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0)
      ON CONFLICT(user_id, module_id, module_version) DO UPDATE SET
        status = excluded.status,
        started_at = COALESCE(user_module_progress.started_at, excluded.started_at),
        verified_at = COALESCE(user_module_progress.verified_at, excluded.verified_at),
        mastered_at = COALESCE(user_module_progress.mastered_at, excluded.mastered_at),
        review_due_at = COALESCE(excluded.review_due_at, user_module_progress.review_due_at),
        verification_source = COALESCE(user_module_progress.verification_source, excluded.verification_source),
        best_score = CASE WHEN excluded.best_score > user_module_progress.best_score
          THEN excluded.best_score ELSE user_module_progress.best_score END,
        version = user_module_progress.version + 1
    `, [
      input.userId, input.moduleId, input.moduleVersion, input.status,
      input.startedAt, input.verifiedAt, input.masteredAt, input.reviewDueAt,
      input.verificationSource, input.bestScore
    ]);
    return (await this.getModuleProgress(input.userId, input.moduleId, input.moduleVersion))!;
  }

  public async createLearningAttempt(
    input: CreateLearningAttemptInput
  ): Promise<LearningAttemptRecord> {
    const startedAt = new Date().toISOString();
    await queryRows(this.pool, `
      INSERT INTO learning_attempts (
        attempt_id, user_id, module_id, module_version, attempt_type,
        scenario_id, scenario_version, run_id, status, started_at, completed_at, result_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'started', $9, NULL, NULL)
      ON CONFLICT(attempt_id) DO NOTHING
    `, [
      input.attemptId, input.userId, input.moduleId, input.moduleVersion,
      input.attemptType, input.scenarioId, input.scenarioVersion, input.runId, startedAt
    ]);
    return (await this.getLearningAttempt(input.attemptId, input.userId))!;
  }

  public async getLearningAttempt(
    attemptId: string,
    userId: string
  ): Promise<LearningAttemptRecord | undefined> {
    const row = (await queryRows<{
      attemptId: string;
      userId: string;
      moduleId: string;
      moduleVersion: string;
      attemptType: string;
      scenarioId: string;
      scenarioVersion: string;
      runId: string | null;
      status: string;
      startedAt: unknown;
      completedAt: unknown;
      resultJson: unknown;
    }>(this.pool, `
      SELECT
        attempt_id AS "attemptId", user_id AS "userId", module_id AS "moduleId",
        module_version AS "moduleVersion", attempt_type AS "attemptType",
        scenario_id AS "scenarioId", scenario_version AS "scenarioVersion",
        run_id AS "runId", status, started_at AS "startedAt",
        completed_at AS "completedAt", result_json AS "resultJson"
      FROM learning_attempts
      WHERE attempt_id = $1 AND user_id = $2
    `, [attemptId, userId]))[0];
    if (!row) {
      return undefined;
    }
    return {
      attemptId: row.attemptId,
      userId: row.userId,
      moduleId: row.moduleId,
      moduleVersion: row.moduleVersion,
      attemptType: row.attemptType as LearningAttemptRecord["attemptType"],
      scenarioId: row.scenarioId,
      scenarioVersion: row.scenarioVersion,
      runId: row.runId,
      status: row.status as LearningAttemptRecord["status"],
      startedAt: readRequiredTimestamp(row.startedAt),
      completedAt: readTimestamp(row.completedAt),
      result: parseJsonValue(row.resultJson)
    };
  }

  public async finalizeLearningAttempt(
    input: FinalizeLearningAttemptInput
  ): Promise<LearningAttemptRecord> {
    const current = await this.getLearningAttempt(input.attemptId, input.userId);
    if (!current) {
      throw new Error(`Learning attempt was not found: ${input.attemptId}`);
    }
    if (current.status !== "started") {
      return current;
    }
    await queryRows(this.pool, `
      UPDATE learning_attempts
      SET status = $1, completed_at = $2, result_json = $3::jsonb
      WHERE attempt_id = $4 AND user_id = $5 AND status = 'started'
    `, [
      input.status, new Date().toISOString(), JSON.stringify(input.result),
      input.attemptId, input.userId
    ]);
    return (await this.getLearningAttempt(input.attemptId, input.userId))!;
  }

  public async appendDecisionEvents(
    events: readonly DecisionEventRecord[]
  ): Promise<AppendDecisionEventsResult> {
    if (events.length === 0) {
      return { accepted: 0, duplicates: 0 };
    }
    let accepted = 0;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN;");
      for (const event of events) {
        const result = await client.query(`
          INSERT INTO decision_events (
            event_id, user_id, session_id, event_type, event_version, sequence,
            occurred_at, server_received_at, client_elapsed_ms,
            run_id, scenario_id, scenario_version, module_id, skill_ids, payload_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb)
          ON CONFLICT (event_id) DO NOTHING
        `, [
          event.eventId, event.userId, event.sessionId, event.eventType,
          event.eventVersion, event.sequence, event.occurredAt,
          event.serverReceivedAt, event.clientElapsedMs, event.runId,
          event.scenarioId, event.scenarioVersion, event.moduleId,
          JSON.stringify(event.skillIds), JSON.stringify(event.payload)
        ]);
        if ((result.rowCount ?? 0) > 0) accepted += 1;
      }
      await client.query("COMMIT;");
    } catch (error) {
      await client.query("ROLLBACK;");
      throw error;
    } finally {
      client.release();
    }
    return { accepted, duplicates: events.length - accepted };
  }

  public async listDecisionEventsByRun(
    userId: string,
    runId: string
  ): Promise<DecisionEventRecord[]> {
    const rows = await queryRows<{
      eventId: string;
      userId: string;
      sessionId: string;
      eventType: string;
      eventVersion: number;
      sequence: number;
      occurredAt: unknown;
      serverReceivedAt: unknown;
      clientElapsedMs: number;
      runId: string | null;
      scenarioId: string | null;
      scenarioVersion: string | null;
      moduleId: string | null;
      skillIds: unknown;
      payloadJson: unknown;
    }>(this.pool, `
      SELECT
        event_id AS "eventId", user_id AS "userId", session_id AS "sessionId",
        event_type AS "eventType", event_version AS "eventVersion", sequence,
        occurred_at AS "occurredAt", server_received_at AS "serverReceivedAt",
        client_elapsed_ms AS "clientElapsedMs", run_id AS "runId",
        scenario_id AS "scenarioId", scenario_version AS "scenarioVersion",
        module_id AS "moduleId", skill_ids AS "skillIds", payload_json AS "payloadJson"
      FROM decision_events
      WHERE user_id = $1 AND run_id = $2
      ORDER BY sequence ASC, occurred_at ASC, event_id ASC
    `, [userId, runId]);

    return rows.map((row) => ({
      eventId: row.eventId,
      userId: row.userId,
      sessionId: row.sessionId,
      eventType: row.eventType as DecisionEventType,
      eventVersion: row.eventVersion,
      sequence: row.sequence,
      occurredAt: readRequiredTimestamp(row.occurredAt),
      serverReceivedAt: readRequiredTimestamp(row.serverReceivedAt),
      clientElapsedMs: row.clientElapsedMs,
      runId: row.runId,
      scenarioId: row.scenarioId,
      scenarioVersion: row.scenarioVersion,
      moduleId: row.moduleId,
      skillIds: (parseJsonValue(row.skillIds) as string[] | null) ?? [],
      payload: (parseJsonValue(row.payloadJson) as TelemetryPayload | null) ?? {}
    }));
  }
}
