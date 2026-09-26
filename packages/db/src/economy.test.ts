import assert from "node:assert/strict";
import test from "node:test";

import { starterScenario } from "../../content/src/fixtures/starter-scenario.js";
import { KIND_ASSET } from "../../contracts/src/economy.js";
import { ENERGY_REGEN_INTERVAL_MS } from "../../domain/src/economy.js";
import {
  appendLedgerEvent,
  applyLedgerEventToState,
  applyScenarioCompletionRewards,
  closeDatabase,
  createDatabase,
  ensureEconomyState,
  getEconomyState,
  getEnergyRegenState,
  getOrCreateUserForIdentity,
  listLedgerEvents,
  projectEconomyState,
  seedFoundation,
  startEligibleScenarioRun,
  SqlitePersistenceAdapter,
  type DatabaseHandle
} from "./index.js";

const DAY_1 = "2026-09-26T00:00:00.000Z";
const SCENARIO_ID = "foundation-false-breakout-001";
const SCENARIO_VERSION = "1.0.0";

function freshHandle(): { handle: DatabaseHandle; userId: string } {
  const handle = createDatabase();
  seedFoundation({ ...handle, scenario: starterScenario });
  return { handle, userId: "seed-user-001" };
}

// Create a run row (Academy => free) so reward-ledger events have a valid
// scenario_runs FK target. Returns the run id.
function seedRun(handle: DatabaseHandle, userId: string, runId: string): string {
  const result = startEligibleScenarioRun(handle, {
    runId,
    userId,
    scenarioId: SCENARIO_ID,
    scenarioVersion: SCENARIO_VERSION,
    scenarioMode: "academy",
    idempotencyKey: `seed-run:${runId}`,
    occurredAt: DAY_1
  });
  assert.ok(result.run, "seed run must be created");
  return runId;
}

test("economy state initializes to default starting balances and is idempotent", () => {
  const { handle, userId } = freshHandle();
  const state = ensureEconomyState(handle, userId, DAY_1);

  assert.equal(state.xp, 0);
  assert.equal(state.coins, 0);
  assert.equal(state.promoCoins, 0);
  assert.equal(state.masteryStars, 0);
  assert.equal(state.energy, 5);
  assert.equal(state.version, 0);
  assert.deepEqual(ensureEconomyState(handle, userId, DAY_1), state, "ensure does not reset an existing row");

  closeDatabase(handle);
});

test("getEconomyState returns undefined before initialization", () => {
  const { handle, userId } = freshHandle();
  assert.equal(getEconomyState(handle, userId), undefined);
  closeDatabase(handle);
});

test("appendLedgerEvent derives the asset from the kind matrix (never trusts the caller)", () => {
  const { handle, userId } = freshHandle();

  const xp = appendLedgerEvent(handle, {
    userId,
    kind: "xp_awarded",
    amount: 30,
    reason: "scenario_completion",
    promo: false,
    idempotencyKey: "xp-1",
    createdAt: DAY_1
  });
  assert.equal(xp.created, true);
  assert.equal(xp.event.asset, KIND_ASSET.xp_awarded);
  assert.equal(xp.state.xp, 30);
  assert.equal(xp.state.coins, 0, "an XP event must never touch Coins");

  const pack = appendLedgerEvent(handle, {
    userId,
    kind: "coin_pack_credited",
    amount: 100,
    reason: "coin_pack",
    promo: false,
    idempotencyKey: "pack-1",
    createdAt: DAY_1
  });
  assert.equal(pack.event.asset, KIND_ASSET.coin_pack_credited);
  assert.equal(pack.state.coins, 100);
  assert.equal(pack.state.promoCoins, 0, "purchased Coins stay separate from promo Coins");

  const promo = appendLedgerEvent(handle, {
    userId,
    kind: "coin_promo_granted",
    amount: 25,
    reason: "referral_activation",
    promo: true,
    idempotencyKey: "promo-1",
    createdAt: DAY_1
  });
  assert.equal(promo.state.promoCoins, 25);
  assert.equal(promo.state.coins, 100, "promo grants never touch purchased Coins");

  closeDatabase(handle);
});

test("energy kinds: spend draws down, regen/refill clamp to the cap", () => {
  const { handle, userId } = freshHandle();
  ensureEconomyState(handle, userId, DAY_1);

  const spent = appendLedgerEvent(handle, {
    userId,
    kind: "energy_spent",
    amount: -1,
    reason: "arena_launch",
    promo: false,
    idempotencyKey: "spend-1",
    createdAt: DAY_1
  });
  assert.equal(spent.state.energy, 4);

  const refilled = appendLedgerEvent(handle, {
    userId,
    kind: "energy_refilled",
    amount: 10,
    reason: "service_refill",
    promo: false,
    idempotencyKey: "refill-1",
    createdAt: DAY_1
  });
  assert.equal(refilled.state.energy, 5, "energy never exceeds the cap");

  closeDatabase(handle);
});

test("coin_spent draws down purchased Coins and never goes negative", () => {
  const { handle, userId } = freshHandle();
  appendLedgerEvent(handle, {
    userId,
    kind: "coin_pack_credited",
    amount: 50,
    reason: "coin_pack",
    promo: false,
    idempotencyKey: "earn",
    createdAt: DAY_1
  });
  const spent = appendLedgerEvent(handle, {
    userId,
    kind: "coin_spent",
    amount: -20,
    reason: "commerce_checkout",
    promo: false,
    idempotencyKey: "spend",
    createdAt: DAY_1
  });
  assert.equal(spent.state.coins, 30);

  const overdraw = appendLedgerEvent(handle, {
    userId,
    kind: "coin_spent",
    amount: -100,
    reason: "commerce_checkout",
    promo: false,
    idempotencyKey: "overdraw",
    createdAt: DAY_1
  });
  assert.equal(overdraw.state.coins, 0, "negative balances are impossible");

  closeDatabase(handle);
});

test("a negative-sign violation is rejected by the ledger contract", () => {
  const { handle, userId } = freshHandle();
  ensureEconomyState(handle, userId, DAY_1);
  // `xp_awarded` must carry a positive amount; a negative one fails the state
  // projection guard, so the whole append throws and rolls back.
  assert.throws(() => appendLedgerEvent(handle, {
    userId,
    kind: "xp_awarded",
    amount: -5,
    reason: "scenario_completion",
    promo: false,
    idempotencyKey: "bad-sign",
    createdAt: DAY_1
  }));
  assert.equal(getEconomyState(handle, userId)?.xp, 0, "the rejected append left no state change");
  closeDatabase(handle);
});

test("same idempotency key with a different payload is rejected as a conflict", () => {
  const { handle, userId } = freshHandle();
  appendLedgerEvent(handle, {
    userId,
    kind: "xp_awarded",
    amount: 10,
    reason: "scenario_completion",
    promo: false,
    idempotencyKey: "k-conflict",
    createdAt: DAY_1
  });

  assert.throws(() => appendLedgerEvent(handle, {
    userId,
    kind: "xp_awarded",
    amount: 999,
    reason: "scenario_completion",
    promo: false,
    idempotencyKey: "k-conflict",
    createdAt: DAY_1
  }), /ledger_idempotency_conflict/);

  closeDatabase(handle);
});

test("an idempotency key may be reused by a different user without collision", () => {
  const { handle } = freshHandle();
  const other = getOrCreateUserForIdentity(handle, { provider: "telegram", providerUserId: "999001" });

  const a = appendLedgerEvent(handle, {
    userId: "seed-user-001",
    kind: "mastery_awarded",
    amount: 1,
    reason: "scenario_quality",
    promo: false,
    idempotencyKey: "shared-key",
    createdAt: DAY_1
  });
  const b = appendLedgerEvent(handle, {
    userId: other.userId,
    kind: "mastery_awarded",
    amount: 1,
    reason: "scenario_quality",
    promo: false,
    idempotencyKey: "shared-key",
    createdAt: DAY_1
  });

  assert.equal(a.created, true);
  assert.equal(b.created, true, "uniqueness is scoped per (user_id, idempotency_key)");
  closeDatabase(handle);
});

test("listLedgerEvents pages newest-first with a stable cursor", () => {
  const { handle, userId } = freshHandle();
  for (const [index, createdAt] of [
    "2026-09-26T10:00:00.000Z",
    "2026-09-26T11:00:00.000Z",
    "2026-09-26T12:00:00.000Z"
  ].entries()) {
    appendLedgerEvent(handle, {
      userId,
      kind: "xp_awarded",
      amount: index + 1,
      reason: "scenario_completion",
      promo: false,
      idempotencyKey: `page-${index}`,
      createdAt
    });
  }

  const page1 = listLedgerEvents(handle, userId, { limit: 2 });
  assert.equal(page1.events.length, 2);
  assert.equal(page1.events[0]!.amount, 3, "newest first");
  assert.notEqual(page1.nextCursor, null);

  const page2 = listLedgerEvents(handle, userId, { limit: 2, after: page1.nextCursor });
  assert.equal(page2.events.length, 1);
  assert.equal(page2.events[0]!.amount, 1);
  assert.equal(page2.nextCursor, null);

  closeDatabase(handle);
});

test("concurrent appends sharing one idempotency key yield a single ledger row", async () => {
  const { handle, userId } = freshHandle();
  const adapter = new SqlitePersistenceAdapter(handle);
  const payload = {
    userId,
    kind: "xp_awarded" as const,
    amount: 12,
    reason: "scenario_completion",
    promo: false,
    idempotencyKey: "econ:xp:concurrent",
    createdAt: DAY_1
  };

  const results = await Promise.all([adapter.appendLedgerEvent(payload), adapter.appendLedgerEvent(payload)]);
  const createdCount = results.filter((result) => result.created).length;
  assert.equal(createdCount, 1, "exactly one append wins the idempotency key");
  assert.equal(results[0]!.state.xp, 12, "no double-grant under concurrency");
  assert.equal(results[1]!.state.xp, 12);

  const count = handle.sqlite
    .prepare("SELECT COUNT(*) AS count FROM ledger_events")
    .get() as { count: number };
  assert.equal(count.count, 1);

  closeDatabase(handle);
});

test("applyLedgerEventToState is a pure versioned projection", () => {
  const base = {
    userId: "u-1",
    xp: 100,
    coins: 10,
    promoCoins: 0,
    masteryStars: 1,
    energy: 3,
    energyUpdatedAt: DAY_1,
    version: 7
  };
  const next = applyLedgerEventToState(base, {
    kind: "xp_awarded",
    amount: 5,
    promo: false
  });

  assert.equal(base.version, 7, "input state is not mutated");
  assert.equal(next.xp, 105);
  assert.equal(next.coins, 10, "XP projection never mints Coins");
  assert.equal(next.version, 8);
});

test("scenario completion grants XP + Mastery and NEVER Coins", () => {
  const { handle, userId } = freshHandle();
  const runId = seedRun(handle, userId, "run-reward-1");

  const result = applyScenarioCompletionRewards(handle, {
    userId,
    runId,
    scenarioId: SCENARIO_ID,
    scenarioVersion: SCENARIO_VERSION,
    qualityScore: 88,
    breakdown: { protocol_adherence: 80, discipline: 80 },
    occurredAt: DAY_1
  });

  assert.equal(result.granted, true);
  assert.ok(result.xpGranted > 0, "a first completion earns XP");
  assert.equal(result.masteryDelta, 3, "QS >= 85 with key conditions earns all three stars");
  assert.equal(result.state.coins, 0, "completion must never mint Coins");

  for (const event of result.events) {
    assert.notEqual(event.asset, "coin", "no coin-asset event may appear on completion");
  }
  const kinds = result.events.map((event) => event.kind).sort();
  assert.deepEqual(kinds, ["mastery_awarded", "xp_awarded"]);

  closeDatabase(handle);
});

test("reward grant is idempotent per run (a replay changes nothing)", () => {
  const { handle, userId } = freshHandle();
  const runId = seedRun(handle, userId, "run-reward-idem");
  const input = {
    userId,
    runId,
    scenarioId: SCENARIO_ID,
    scenarioVersion: SCENARIO_VERSION,
    qualityScore: 90,
    breakdown: { protocol_adherence: 85, discipline: 85 },
    occurredAt: DAY_1
  };

  const first = applyScenarioCompletionRewards(handle, input);
  const before = handle.sqlite.prepare("SELECT COUNT(*) AS count FROM ledger_events").get() as { count: number };

  const replay = applyScenarioCompletionRewards(handle, input);
  const after = handle.sqlite.prepare("SELECT COUNT(*) AS count FROM ledger_events").get() as { count: number };

  assert.equal(first.granted, true);
  assert.equal(replay.granted, false, "a repeated grant is short-circuited");
  assert.equal(replay.xpGranted, first.xpGranted);
  assert.equal(replay.masteryDelta, first.masteryDelta);
  assert.equal(after.count, before.count, "replay writes no new ledger rows");

  closeDatabase(handle);
});

test("Mastery is a per-scenario best (0..3) and only positive deltas are granted", () => {
  const { handle, userId } = freshHandle();

  // First run: QS 75, key conditions met but QS < 85 => 2 stars.
  const run1 = seedRun(handle, userId, "run-mast-1");
  const r1 = applyScenarioCompletionRewards(handle, {
    userId, runId: run1, scenarioId: SCENARIO_ID, scenarioVersion: SCENARIO_VERSION,
    qualityScore: 75, breakdown: { protocol_adherence: 80, discipline: 80 }, occurredAt: DAY_1
  });
  assert.equal(r1.masteryDelta, 2);

  // Second run within window, improved to 3 stars => delta +1 only.
  const run2 = seedRun(handle, userId, "run-mast-2");
  const r2 = applyScenarioCompletionRewards(handle, {
    userId, runId: run2, scenarioId: SCENARIO_ID, scenarioVersion: SCENARIO_VERSION,
    qualityScore: 88, breakdown: { protocol_adherence: 80, discipline: 80 },
    occurredAt: new Date(Date.parse(DAY_1) + 60 * 60 * 1000).toISOString()
  });
  assert.equal(r2.masteryDelta, 1, "only the improvement above the stored best is granted");

  // Third run cannot exceed the per-scenario best of 3 => delta 0.
  const run3 = seedRun(handle, userId, "run-mast-3");
  const r3 = applyScenarioCompletionRewards(handle, {
    userId, runId: run3, scenarioId: SCENARIO_ID, scenarioVersion: SCENARIO_VERSION,
    qualityScore: 95, breakdown: { protocol_adherence: 90, discipline: 90 },
    occurredAt: new Date(Date.parse(DAY_1) + 2 * 60 * 60 * 1000).toISOString()
  });
  assert.equal(r3.masteryDelta, 0, "total per scenario can never exceed 3");

  const mastery = handle.sqlite.prepare(`
    SELECT best_stars AS bestStars FROM user_scenario_mastery WHERE user_id = ? AND scenario_id = ?
  `).get(userId, SCENARIO_ID) as { bestStars: number };
  assert.equal(mastery.bestStars, 3);

  closeDatabase(handle);
});

test("XP repeat rules: full, reduced-on-improvement, then zero", () => {
  const { handle, userId } = freshHandle();
  const base = {
    userId,
    scenarioId: SCENARIO_ID,
    scenarioVersion: SCENARIO_VERSION,
    breakdown: { protocol_adherence: 80, discipline: 80 }
  };

  const run1 = seedRun(handle, userId, "rep-1");
  const r1 = applyScenarioCompletionRewards(handle, {
    ...base, runId: run1, qualityScore: 60, occurredAt: DAY_1
  });
  assert.ok(r1.xpGranted > 0, "first completion earns full XP");

  // A within-window replay that improves the best score earns the reduced 25%.
  const run2 = seedRun(handle, userId, "rep-2");
  const r2 = applyScenarioCompletionRewards(handle, {
    ...base, runId: run2, qualityScore: 66,
    occurredAt: new Date(Date.parse(DAY_1) + 6 * 60 * 60 * 1000).toISOString()
  });
  assert.ok(r2.xpGranted > 0 && r2.xpGranted < r1.xpGranted, "reduced repeat still awards some XP");

  // A further non-improving repeat earns nothing.
  const run3 = seedRun(handle, userId, "rep-3");
  const r3 = applyScenarioCompletionRewards(handle, {
    ...base, runId: run3, qualityScore: 66,
    occurredAt: new Date(Date.parse(DAY_1) + 12 * 60 * 60 * 1000).toISOString()
  });
  assert.equal(r3.xpGranted, 0, "identical repeats earn 0 XP");

  closeDatabase(handle);
});

test("UTC daily solo cap clamps a completion to the remaining XP budget", () => {
  const { handle, userId } = freshHandle();
  // Fill today's XP budget to the cap with a non-completion event.
  appendLedgerEvent(handle, {
    userId, kind: "xp_awarded", amount: 500, reason: "seed_to_cap",
    promo: false, idempotencyKey: "cap-fill", createdAt: DAY_1
  });

  const runId = seedRun(handle, userId, "cap-run");
  const result = applyScenarioCompletionRewards(handle, {
    userId, runId, scenarioId: SCENARIO_ID, scenarioVersion: SCENARIO_VERSION,
    qualityScore: 88, breakdown: { protocol_adherence: 80, discipline: 80 }, occurredAt: DAY_1
  });
  assert.equal(result.xpGranted, 0, "no XP beyond the 500/day solo cap");
  assert.ok(result.masteryDelta > 0, "Mastery is independent of the XP cap");
  assert.equal(getEconomyState(handle, userId)!.xp, 500);

  closeDatabase(handle);
});

test("Arena starts spend Energy atomically; Academy is free; insufficient Energy is typed", () => {
  const { handle, userId } = freshHandle();
  ensureEconomyState(handle, userId, DAY_1);

  const academy = startEligibleScenarioRun(handle, {
    runId: "free-1", userId, scenarioId: SCENARIO_ID, scenarioVersion: SCENARIO_VERSION,
    scenarioMode: "academy", idempotencyKey: "free-1", occurredAt: DAY_1
  });
  assert.equal(academy.energySpent, 0);
  assert.equal(academy.state.energy, 5, "Academy never spends Energy");

  const arena = startEligibleScenarioRun(handle, {
    runId: "paid-1", userId, scenarioId: SCENARIO_ID, scenarioVersion: SCENARIO_VERSION,
    scenarioMode: "arena", idempotencyKey: "paid-1", occurredAt: DAY_1
  });
  assert.equal(arena.energySpent, 1);
  assert.equal(arena.state.energy, 4);
  const spendEvent = handle.sqlite.prepare(`
    SELECT amount FROM ledger_events WHERE user_id = ? AND kind = 'energy_spent'
  `).get(userId) as { amount: number };
  assert.equal(spendEvent.amount, -1, "the spend event links to the paid launch");

  // Replay of the same idempotency key must not spend twice.
  const replay = startEligibleScenarioRun(handle, {
    runId: "paid-1", userId, scenarioId: SCENARIO_ID, scenarioVersion: SCENARIO_VERSION,
    scenarioMode: "arena", idempotencyKey: "paid-1", occurredAt: DAY_1
  });
  assert.equal(replay.energySpent, 0, "a replay returns the existing run without a second spend");
  assert.equal(replay.state.energy, 4);

  // Drain Energy to zero, then verify a typed insufficient-energy result and no run.
  for (const [index] of Array.from({ length: 4 }).entries()) {
    startEligibleScenarioRun(handle, {
      runId: `drain-${index}`, userId, scenarioId: SCENARIO_ID, scenarioVersion: SCENARIO_VERSION,
      scenarioMode: "arena", idempotencyKey: `drain-${index}`, occurredAt: DAY_1
    });
  }
  const broke = startEligibleScenarioRun(handle, {
    runId: "nope", userId, scenarioId: SCENARIO_ID, scenarioVersion: SCENARIO_VERSION,
    scenarioMode: "arena", idempotencyKey: "nope", occurredAt: DAY_1
  });
  assert.equal(broke.insufficientEnergy, true);
  assert.equal(broke.run, null, "no run is created without Energy");
  assert.equal(broke.state.energy, 0);

  closeDatabase(handle);
});

test("lazy Energy regen preserves the partial-interval remainder", () => {
  const { handle, userId } = freshHandle();
  ensureEconomyState(handle, userId, DAY_1);
  // Spend one Energy so the bar is below the cap, anchored at DAY_1.
  startEligibleScenarioRun(handle, {
    runId: "regen-spend", userId, scenarioId: SCENARIO_ID, scenarioVersion: SCENARIO_VERSION,
    scenarioMode: "arena", idempotencyKey: "regen-spend", occurredAt: DAY_1
  });

  // 45 minutes later: one whole 30m tick regenerates, 15m remainder is preserved
  // (the anchor advances by exactly one interval, not to "now").
  const later = new Date(Date.parse(DAY_1) + 45 * 60 * 1000).toISOString();
  const regen = getEnergyRegenState(handle, userId, later);
  assert.equal(regen.energy, 5, "one tick regains the spent Energy");
  assert.equal(
    Date.parse(regen.energyUpdatedAt),
    Date.parse(DAY_1) + ENERGY_REGEN_INTERVAL_MS,
    "the anchor advances by consumed ticks only, preserving the remainder"
  );

  closeDatabase(handle);
});

test("repeated lazy regen for the same interval never double-grants Energy", () => {
  const { handle, userId } = freshHandle();
  ensureEconomyState(handle, userId, DAY_1);
  startEligibleScenarioRun(handle, {
    runId: "regen-spend-2", userId, scenarioId: SCENARIO_ID, scenarioVersion: SCENARIO_VERSION,
    scenarioMode: "arena", idempotencyKey: "regen-spend-2", occurredAt: DAY_1
  });

  const later = new Date(Date.parse(DAY_1) + 45 * 60 * 1000).toISOString();
  // Two "simultaneous" regen evaluations for the same target anchor must yield a
  // single energy_regenerated event (the key is derived from the new anchor).
  const a = getEnergyRegenState(handle, userId, later);
  const b = getEnergyRegenState(handle, userId, later);
  assert.equal(a.energy, 5);
  assert.equal(b.energy, 5, "a second pass cannot exceed the cap or double-grant");

  const regenRows = handle.sqlite.prepare(`
    SELECT COUNT(*) AS count FROM ledger_events WHERE user_id = ? AND kind = 'energy_regenerated'
  `).get(userId) as { count: number };
  assert.equal(regenRows.count, 1, "exactly one regen grant for the elapsed window");

  closeDatabase(handle);
});

test("projectEconomyState shows regen without persisting (GET stays side-effect free)", () => {
  const { handle, userId } = freshHandle();
  ensureEconomyState(handle, userId, DAY_1);
  startEligibleScenarioRun(handle, {
    runId: "proj-spend", userId, scenarioId: SCENARIO_ID, scenarioVersion: SCENARIO_VERSION,
    scenarioMode: "arena", idempotencyKey: "proj-spend", occurredAt: DAY_1
  });

  const later = new Date(Date.parse(DAY_1) + 45 * 60 * 1000).toISOString();
  const projected = projectEconomyState(handle, userId, later);
  assert.equal(projected.energy, 5, "the projection displays regenerated Energy");

  const persisted = getEconomyState(handle, userId)!;
  assert.equal(persisted.energy, 4, "the stored state is unchanged by a read-only projection");
  const regenRows = handle.sqlite.prepare(`
    SELECT COUNT(*) AS count FROM ledger_events WHERE user_id = ? AND kind = 'energy_regenerated'
  `).get(userId) as { count: number };
  assert.equal(regenRows.count, 0, "a projection must not write ledger events");

  closeDatabase(handle);
});
