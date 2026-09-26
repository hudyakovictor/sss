import assert from "node:assert/strict";
import test from "node:test";

import { starterScenario } from "../../content/src/fixtures/starter-scenario.js";
import {
  applyMigrations,
  closeDatabase,
  consumeAuthReplayKey,
  createAuthSession,
  createDatabase,
  createScenarioRun,
  getActiveAuthSession,
  getHistoricalSnapshot,
  getOrCreateUserForIdentity,
  getScenarioPackage,
  getScenarioRun,
  revokeAuthSession,
  revealScenarioRun,
  sealScenarioRun,
  seedFoundation,
  upsertHistoricalSnapshot
} from "./index.js";

test("migrations are idempotent and create the foundation schema", () => {
  const handle = createDatabase();

  handle.sqlite.exec("SELECT 1");
  const before = handle.sqlite
    .prepare("SELECT COUNT(*) AS count FROM _migrations")
    .get() as { count: number };

  applyMigrations(handle.sqlite);
  const after = handle.sqlite
    .prepare("SELECT COUNT(*) AS count FROM _migrations")
    .get() as { count: number };
  const tables = handle.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>;


  assert.equal(before.count, 7);
  assert.equal(after.count, 7);
  assert.deepEqual(tables.map((table) => table.name), [
    "_migrations",
    "auth_replay_keys",
    "auth_sessions",
    "decision_events",
    "historical_snapshots",
    "learning_attempts",
    "learning_modules",
    "ledger_events",
    "reward_grants",
    "scenario_completions",
    "scenario_runs",
    "scenarios",
    "user_economy_state",
    "user_identities",
    "user_module_progress",
    "user_scenario_mastery",
    "user_skill_state",
    "users"
  ]);

  closeDatabase(handle);
});

test("historical snapshots persist by content hash and remain point-in-time", () => {
  const handle = createDatabase();
  const snapshot = {
    provider: "binance" as const,
    symbol: "BTCUSDT",
    interval: "1h",
    asOf: "2026-09-14T12:00:00.000Z",
    candles: [{
      openTime: "2026-09-14T11:00:00.000Z",
      closeTime: "2026-09-14T11:59:59.999Z",
      open: "100",
      high: "102",
      low: "99",
      close: "101",
      volume: "42.5"
    }],
    provenance: {
      sourceReference: "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h",
      observedAt: "2026-09-14T12:00:00.000Z",
      availableAt: "2026-09-14T12:01:00.000Z",
      timezone: "UTC",
      reliability: "high" as const,
      contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      revisionStatus: "original" as const
    }
  };

  const first = upsertHistoricalSnapshot(handle, snapshot, "snapshot-001");
  const retry = upsertHistoricalSnapshot(handle, snapshot, "snapshot-002");
  assert.equal(first.snapshotId, "snapshot-001");
  assert.equal(retry.snapshotId, "snapshot-001");
  assert.deepEqual(getHistoricalSnapshot(handle, "snapshot-001")?.snapshot, snapshot);
  assert.equal(getHistoricalSnapshot(handle, "snapshot-002"), undefined);

  closeDatabase(handle);
});

test("platform identities map to one internal user and remain idempotent", () => {
  const handle = createDatabase();

  const first = getOrCreateUserForIdentity(handle, {
    provider: "telegram",
    providerUserId: "777001"
  });
  const retry = getOrCreateUserForIdentity(handle, {
    provider: "telegram",
    providerUserId: "777001"
  });
  const otherProvider = getOrCreateUserForIdentity(handle, {
    provider: "base",
    providerUserId: "777001"
  });

  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(retry.userId, first.userId);
  assert.notEqual(otherProvider.userId, first.userId);

  closeDatabase(handle);
});

test("auth replay keys are atomic and expire without process memory", () => {
  const handle = createDatabase();
  const nowMs = Date.parse("2026-09-14T12:00:00.000Z");
  const expiresAtMs = nowMs + 60_000;

  assert.equal(consumeAuthReplayKey(handle, "hash-001", expiresAtMs, nowMs), true);
  assert.equal(consumeAuthReplayKey(handle, "hash-001", expiresAtMs, nowMs), false);
  assert.equal(
    consumeAuthReplayKey(handle, "hash-001", nowMs + 120_000, nowMs + 120_000),
    true
  );

  closeDatabase(handle);
});

test("auth sessions are lookupable, expiry-aware and revocable", () => {
  const handle = createDatabase();
  seedFoundation({ ...handle, scenario: starterScenario });
  const createdAt = "2026-09-14T12:00:00.000Z";
  const expiresAt = "2026-09-14T13:00:00.000Z";

  createAuthSession(handle, {
    sessionId: "session-001",
    userId: "seed-user-001",
    tokenHash: "sha256:session-token",
    createdAt,
    expiresAt
  });

  assert.equal(
    getActiveAuthSession(handle, "sha256:session-token", "2026-09-14T12:30:00.000Z")?.userId,
    "seed-user-001"
  );
  assert.equal(
    getActiveAuthSession(handle, "sha256:session-token", "2026-09-14T13:00:00.000Z"),
    undefined
  );
  assert.equal(revokeAuthSession(handle, "session-001", "2026-09-14T12:40:00.000Z"), true);
  assert.equal(revokeAuthSession(handle, "session-001", "2026-09-14T12:41:00.000Z"), false);
  assert.equal(
    getActiveAuthSession(handle, "sha256:session-token", "2026-09-14T12:30:00.000Z"),
    undefined
  );

  closeDatabase(handle);
});

test("seed is repeatable and stores the full server-side package", () => {
  const handle = createDatabase();

  seedFoundation({
    ...handle,
    scenario: starterScenario
  });
  seedFoundation({
    ...handle,
    scenario: starterScenario
  });
  seedFoundation({
    ...handle,
    scenario: {
      ...starterScenario,
      version: "1.1.0",
      contentVersion: "content-foundation-2"
    }
  });

  const scenario = handle.sqlite.prepare(`
    SELECT scenario_id AS scenarioId, package_json AS packageJson
    FROM scenarios
  `).get() as { scenarioId: string; packageJson: string };
  const parsedPackage = JSON.parse(scenario.packageJson) as {
    hiddenEntities: string[];
    historicalFutureSegment: { contentHash: string };
  };
  const counts = handle.sqlite.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM scenarios) AS scenarios
  `).get() as { users: number; scenarios: number };

  assert.equal(counts.users, 1);
  assert.equal(counts.scenarios, 2);
  assert.deepEqual(parsedPackage.hiddenEntities, ["fake_breakout_phantom"]);
  assert.equal(parsedPackage.historicalFutureSegment.contentHash, "sha256:fixture-future-001");
  assert.deepEqual(
    getScenarioPackage(handle, starterScenario.scenarioId, starterScenario.version),
    starterScenario
  );
  assert.equal(
    getScenarioPackage(handle, starterScenario.scenarioId, "missing"),
    undefined
  );

  closeDatabase(handle);
});

test("scenario run creation is idempotent by idempotency key", () => {
  const handle = createDatabase();
  seedFoundation({
    ...handle,
    scenario: starterScenario
  });

  const first = createScenarioRun(handle, {
    runId: "run-001",
    userId: "seed-user-001",
    scenarioId: starterScenario.scenarioId,
    scenarioVersion: starterScenario.version,
    idempotencyKey: "decision-submit-001"
  });
  const retry = createScenarioRun(handle, {
    runId: "run-002",
    userId: "seed-user-001",
    scenarioId: starterScenario.scenarioId,
    scenarioVersion: starterScenario.version,
    idempotencyKey: "decision-submit-001"
  });

  assert.equal(first.runId, "run-001");
  assert.deepEqual(retry, first);
  assert.throws(() => createScenarioRun(handle, {
    runId: "run-003",
    userId: "other-user",
    scenarioId: starterScenario.scenarioId,
    scenarioVersion: starterScenario.version,
    idempotencyKey: "decision-submit-001"
  }), /bound to a different/);

  const count = handle.sqlite
    .prepare("SELECT COUNT(*) AS count FROM scenario_runs")
    .get() as { count: number };
  assert.equal(count.count, 1);

  closeDatabase(handle);
});

test("scenario run seal and reveal transitions are immutable and repeatable", () => {
  const handle = createDatabase();
  seedFoundation({ ...handle, scenario: starterScenario });
  const input = {
    runId: "run-lifecycle-001",
    userId: "seed-user-001",
    scenarioId: starterScenario.scenarioId,
    scenarioVersion: starterScenario.version,
    idempotencyKey: "lifecycle-001"
  };
  createScenarioRun(handle, input);
  const decision = {
    action: "wait_for_confirmation" as const,
    evidenceSourceIds: ["source_ohlcv_demo", "source_volume_demo"],
    invalidation: "Close below the failed breakout level.",
    confidence: 72
  };

  assert.throws(
    () => revealScenarioRun(handle, input.runId, input.userId),
    /must be sealed/
  );

  const score = {
    score: 87,
    breakdown: {
      decision_quality: 88,
      protocol_adherence: 90,
      evidence_quality: 84,
      follow_up_decision_quality: 80,
      risk_management: 92,
      invalidation: 86,
      discipline: 95,
      entity_resistance: 82,
      confidence_calibration: 89
    },
    rubricVersion: "score-v1"
  };
  const sealed = sealScenarioRun(handle, input.runId, input.userId, decision, score);
  assert.equal(sealed.state, "sealed");
  assert.deepEqual(sealed.decision, decision);
  assert.deepEqual(
    sealScenarioRun(handle, input.runId, input.userId, decision, score),
    sealed
  );
  assert.throws(
    () => sealScenarioRun(handle, input.runId, input.userId, {
      ...decision,
      confidence: 73
    }, score),
    /already sealed/
  );

  const revealed = revealScenarioRun(handle, input.runId, input.userId);
  assert.equal(revealed.state, "revealed");
  assert.equal(revealed.revealedAt !== null, true);
  assert.deepEqual(
    revealScenarioRun(handle, input.runId, input.userId),
    revealed
  );
  assert.deepEqual(
    getScenarioRun(handle, input.runId, input.userId),
    revealed
  );

  closeDatabase(handle);
});

test("scenario runs enforce user and scenario-version foreign keys", () => {
  const handle = createDatabase();
  seedFoundation({ ...handle, scenario: starterScenario });

  assert.throws(() =>
    createScenarioRun(handle, {
      runId: "run-missing-scenario",
      userId: "seed-user-001",
      scenarioId: starterScenario.scenarioId,
      scenarioVersion: "9.9.9",
      idempotencyKey: "missing-scenario-version"
    })
  );

  assert.throws(() =>
    createScenarioRun(handle, {
      runId: "run-missing-user",
      userId: "missing-user",
      scenarioId: starterScenario.scenarioId,
      scenarioVersion: starterScenario.version,
      idempotencyKey: "missing-user"
    })
  );

  closeDatabase(handle);
});
