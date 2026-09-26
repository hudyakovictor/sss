import assert from "node:assert/strict";
import test from "node:test";

import {
  LedgerEventSchema,
  UserEconomyStateSchema,
  LedgerPageSchema,
  KIND_ASSET
} from "./economy.js";

const BASE_EVENT = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  userId: "u-1",
  kind: "xp_awarded" as const,
  asset: "xp" as const,
  amount: 20,
  reason: "scenario_completion",
  promo: false,
  riskState: "clear" as const,
  idempotencyKey: "run:run-1:xp",
  createdAt: "2026-09-26T12:00:00Z"
};

const PROMO_EVENT = {
  ...BASE_EVENT,
  kind: "coin_promo_granted" as const,
  asset: "coin" as const,
  reason: "referral_activation",
  promo: true,
  riskState: "granted" as const,
  idempotencyKey: "activation:invitee-1:invitee"
};

test("LedgerEvent accepts a canonical XP award", () => {
  const ev = LedgerEventSchema.parse(BASE_EVENT);
  assert.equal(ev.amount, 20);
  assert.equal(ev.kind, "xp_awarded");
  assert.equal(ev.asset, KIND_ASSET.xp_awarded);
});

test("LedgerEvent enforces the asset x kind matrix", () => {
  // xp_awarded may only touch xp.
  assert.equal(LedgerEventSchema.safeParse({ ...BASE_EVENT, asset: "coin" }).success, false);
  // coin_spent must be a negative coin event.
  assert.ok(LedgerEventSchema.safeParse({
    ...BASE_EVENT, kind: "coin_spent", asset: "coin", amount: -10, reason: "store_purchase"
  }).success);
  assert.equal(LedgerEventSchema.safeParse({
    ...BASE_EVENT, kind: "coin_spent", asset: "energy", amount: -10
  }).success, false);
});

test("LedgerEvent rejects zero or negative amount on positive-kind events", () => {
  assert.equal(LedgerEventSchema.safeParse({ ...BASE_EVENT, amount: 0 }).success, false);
  assert.equal(LedgerEventSchema.safeParse({ ...BASE_EVENT, amount: -5 }).success, false);
});

test("LedgerEvent rejects non-negative amount on coin_spent", () => {
  assert.equal(
    LedgerEventSchema.safeParse({ ...BASE_EVENT, kind: "coin_spent", asset: "coin", amount: 10 }).success,
    false
  );
  assert.equal(
    LedgerEventSchema.safeParse({ ...BASE_EVENT, kind: "coin_spent", asset: "coin", amount: 0 }).success,
    false
  );
});

test("energy_spent is negative; energy_regenerated and energy_refilled are positive", () => {
  assert.ok(LedgerEventSchema.safeParse({
    ...BASE_EVENT, kind: "energy_spent", asset: "energy", amount: -1, reason: "arena_launch"
  }).success);
  assert.equal(LedgerEventSchema.safeParse({
    ...BASE_EVENT, kind: "energy_spent", asset: "energy", amount: 1
  }).success, false);
  assert.ok(LedgerEventSchema.safeParse({
    ...BASE_EVENT, kind: "energy_regenerated", asset: "energy", amount: 1, reason: "timer"
  }).success);
  assert.ok(LedgerEventSchema.safeParse({
    ...BASE_EVENT, kind: "energy_refilled", asset: "energy", amount: 5, reason: "paid_refill"
  }).success);
});

test("promo = true is only allowed on coin_promo_granted with a canonical reason", () => {
  assert.ok(LedgerEventSchema.safeParse(PROMO_EVENT).success);
  // promo on a non-promo kind is rejected.
  assert.equal(LedgerEventSchema.safeParse({ ...BASE_EVENT, promo: true }).success, false);
  // coin_pack_credited cannot be promo.
  assert.equal(LedgerEventSchema.safeParse({
    ...PROMO_EVENT, kind: "coin_pack_credited", asset: "coin", promo: true
  }).success, false);
  // coin_promo_granted without promo is rejected.
  assert.equal(LedgerEventSchema.safeParse({ ...PROMO_EVENT, promo: false }).success, false);
  // coin_promo_granted with a non-canonical reason is rejected.
  assert.equal(LedgerEventSchema.safeParse({ ...PROMO_EVENT, reason: "because" }).success, false);
});

test("LedgerEvent requires a non-empty idempotency key", () => {
  assert.equal(LedgerEventSchema.safeParse({ ...BASE_EVENT, idempotencyKey: "" }).success, false);
  const { idempotencyKey: _drop, ...rest } = BASE_EVENT;
  assert.equal(LedgerEventSchema.safeParse(rest).success, false);
});

test("LedgerEvent rejects unknown fields (strict wire shape)", () => {
  assert.equal(LedgerEventSchema.safeParse({ ...BASE_EVENT, scoreBoost: 10 }).success, false);
});

test("LedgerEvent rejects fractional amounts (integer-only)", () => {
  assert.equal(LedgerEventSchema.safeParse({ ...BASE_EVENT, amount: 20.5 }).success, false);
});

test("LedgerEvent accepts optional runId / sourceId / scenarioId", () => {
  assert.ok(LedgerEventSchema.safeParse({ ...BASE_EVENT, runId: null }).success);
  assert.ok(LedgerEventSchema.safeParse({ ...BASE_EVENT, runId: "run-42", scenarioId: "s-1", sourceId: "pay-9" }).success);
  assert.ok(LedgerEventSchema.safeParse(BASE_EVENT).success);
});

test("UserEconomyState enforces 0..5 energy and integer non-negative balances", () => {
  assert.ok(UserEconomyStateSchema.safeParse({
    userId: "u-1",
    xp: 100,
    coins: 20,
    promoCoins: 0,
    masteryStars: 3,
    energy: 5,
    energyUpdatedAt: "2026-09-26T12:00:00Z",
    version: 0
  }).success);
  assert.equal(UserEconomyStateSchema.safeParse({
    userId: "u-1", xp: 100, coins: 20, promoCoins: 0, masteryStars: 3, energy: 6,
    energyUpdatedAt: "2026-09-26T12:00:00Z", version: 0
  }).success, false);
  assert.equal(UserEconomyStateSchema.safeParse({
    userId: "u-1", xp: -1, coins: 20, promoCoins: 0, masteryStars: 3, energy: 3,
    energyUpdatedAt: "2026-09-26T12:00:00Z", version: 0
  }).success, false);
  assert.equal(UserEconomyStateSchema.safeParse({
    userId: "u-1", xp: 100, coins: 20, promoCoins: 0, masteryStars: 3, energy: 3,
    energyUpdatedAt: "2026-09-26T12:00:00Z", version: 0, riskOverride: true
  }).success, false);
});

test("LedgerPage wraps events with a nullable cursor", () => {
  const page = LedgerPageSchema.parse({ events: [BASE_EVENT, PROMO_EVENT], nextCursor: null });
  assert.equal(page.events.length, 2);
  assert.equal(page.nextCursor, null);
});
