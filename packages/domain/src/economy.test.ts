import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_DAILY_SOLO_XP,
  MAX_ENERGY,
  ENERGY_REGEN_INTERVAL_MS,
  xpToNext,
  cumulativeXpAtLevelStart,
  levelFromXp,
  xpQualityModifier,
  applyQualityModifier,
  xpGrantedAfterDailyCap,
  regenerateEnergy,
  msUntilNextEnergy,
  masteryStarsForScore,
  QUICK_RUN_BASE_XP,
  XP_REPEAT_WINDOW_MS,
  xpRepeatMultiplier,
  xpForCompletion,
  applyEnergyRegen,
  keyConditionsMetForBreakdown,
  energyCostForMode
} from "./economy.js";

// Reference snapshot from docs/game_balance_spec.md §3.1. The generated server
// configuration is authoritative, so the formula must reproduce this table.
const XP_TO_NEXT: Record<number, number> = {
  1: 125, 2: 175, 3: 250, 4: 300, 5: 350, 6: 425, 7: 500, 8: 575, 9: 650,
  10: 725, 15: 1150, 20: 1625, 30: 2700, 40: 3925, 50: 5275, 60: 6750,
  70: 8325, 80: 10025, 90: 11800, 98: 13275
};

const CUMULATIVE_AT_START: Record<number, number> = {
  1: 0, 2: 125, 3: 300, 4: 550, 5: 850, 6: 1200, 7: 1625, 8: 2125, 9: 2700,
  10: 3350, 15: 7775, 20: 14450, 30: 35375, 40: 67800, 50: 113025,
  60: 172350, 70: 246900, 80: 337750, 90: 445875, 98: 545400, 99: 558675
};

test("xpToNext reproduces the balance-spec level curve snapshot", () => {
  for (const [level, expected] of Object.entries(XP_TO_NEXT)) {
    assert.equal(xpToNext(Number(level)), expected, `level ${level}`);
  }
});

test("cumulativeXpAtLevelStart reproduces the balance-spec cumulative snapshot", () => {
  for (const [level, expected] of Object.entries(CUMULATIVE_AT_START)) {
    assert.equal(cumulativeXpAtLevelStart(Number(level)), expected, `level ${level}`);
  }
});

test("xpToNext rejects out-of-range and non-integer levels", () => {
  assert.throws(() => xpToNext(0), RangeError);
  assert.throws(() => xpToNext(100), RangeError);
  assert.throws(() => xpToNext(2.5), RangeError);
});

test("level 99 is the cap and requires no further XP", () => {
  assert.equal(xpToNext(99), 0);
});

test("levelFromXp is the inverse of the cumulative curve", () => {
  assert.equal(levelFromXp(0), 1);
  assert.equal(levelFromXp(124), 1);
  assert.equal(levelFromXp(125), 2);
  assert.equal(levelFromXp(558675), 99);
  assert.equal(levelFromXp(558675 + 10_000), 99, "cannot exceed the level cap");
  assert.throws(() => levelFromXp(-1), RangeError);
});

test("quality modifier bands match §3.3", () => {
  assert.equal(xpQualityModifier(0), 0.75);
  assert.equal(xpQualityModifier(49), 0.75);
  assert.equal(xpQualityModifier(50), 1.0);
  assert.equal(xpQualityModifier(69), 1.0);
  assert.equal(xpQualityModifier(70), 1.15);
  assert.equal(xpQualityModifier(84), 1.15);
  assert.equal(xpQualityModifier(85), 1.3);
  assert.equal(xpQualityModifier(94), 1.3);
  assert.equal(xpQualityModifier(95), 1.4);
  assert.equal(xpQualityModifier(100), 1.4);
  assert.throws(() => xpQualityModifier(101), RangeError);
});

test("applyQualityModifier scales base XP and rounds to whole units", () => {
  assert.equal(applyQualityModifier(40, 75), 46); // 40 * 1.15 = 46
  assert.equal(applyQualityModifier(100, 40), 75); // 100 * 0.75
  assert.equal(applyQualityModifier(35, 60), 35); // neutral band
});

test("daily solo cap clamps grants to remaining budget", () => {
  assert.equal(xpGrantedAfterDailyCap(200, 0), 200);
  assert.equal(xpGrantedAfterDailyCap(200, 400), 100);
  assert.equal(xpGrantedAfterDailyCap(200, MAX_DAILY_SOLO_XP), 0);
  assert.equal(xpGrantedAfterDailyCap(200, MAX_DAILY_SOLO_XP + 500), 0);
  assert.throws(() => xpGrantedAfterDailyCap(10.5, 0), RangeError);
});

test("regenerateEnergy accrues one unit per 30-minute interval, capped", () => {
  assert.equal(regenerateEnergy(2, 0), 2);
  assert.equal(regenerateEnergy(2, ENERGY_REGEN_INTERVAL_MS - 1), 2, "partial interval does not count");
  assert.equal(regenerateEnergy(2, ENERGY_REGEN_INTERVAL_MS), 3);
  assert.equal(regenerateEnergy(0, ENERGY_REGEN_INTERVAL_MS * 5), MAX_ENERGY, "clamped to cap");
  assert.equal(regenerateEnergy(MAX_ENERGY, ENERGY_REGEN_INTERVAL_MS * 10), MAX_ENERGY);
  assert.throws(() => regenerateEnergy(6, 0), RangeError);
});

test("msUntilNextEnergy reports the countdown to the next tick", () => {
  assert.equal(msUntilNextEnergy(MAX_ENERGY, 0), null, "full bar has no countdown");
  assert.equal(msUntilNextEnergy(1, 0), ENERGY_REGEN_INTERVAL_MS);
  assert.equal(msUntilNextEnergy(1, ENERGY_REGEN_INTERVAL_MS / 2), ENERGY_REGEN_INTERVAL_MS / 2);
});

test("masteryStarsForScore follows the 0-3 star ladder (§4)", () => {
  assert.equal(masteryStarsForScore({ completed: false, qualityScore: 99, keyConditionsMet: true }), 0);
  assert.equal(masteryStarsForScore({ completed: true, qualityScore: 69, keyConditionsMet: false }), 1);
  assert.equal(masteryStarsForScore({ completed: true, qualityScore: 70, keyConditionsMet: false }), 2);
  assert.equal(masteryStarsForScore({ completed: true, qualityScore: 85, keyConditionsMet: false }), 2, "85 alone is not 3 stars");
  assert.equal(masteryStarsForScore({ completed: true, qualityScore: 85, keyConditionsMet: true }), 3);
});

test("keyConditionsMetForBreakdown gates the third star on process floors (§4)", () => {
  assert.equal(keyConditionsMetForBreakdown({ protocol_adherence: 70, discipline: 70 }), true);
  assert.equal(keyConditionsMetForBreakdown({ protocol_adherence: 69, discipline: 99 }), false);
  assert.equal(keyConditionsMetForBreakdown({ protocol_adherence: 99, discipline: 69 }), false);
});

test("xpRepeatMultiplier models 100% / 25% / 0% completion repeats (§3.4)", () => {
  assert.equal(xpRepeatMultiplier({ firstCompletion: true, withinWindow: false, qualifiesForReduced: false }), 1);
  assert.equal(
    xpRepeatMultiplier({ firstCompletion: false, withinWindow: true, qualifiesForReduced: true }),
    0.25,
    "a within-window rematch or best-score improvement earns the reduced repeat"
  );
  assert.equal(xpRepeatMultiplier({ firstCompletion: false, withinWindow: true, qualifiesForReduced: false }), 0);
  assert.equal(xpRepeatMultiplier({ firstCompletion: false, withinWindow: false, qualifiesForReduced: true }), 0);
});

test("xpForCompletion scales base XP by the repeat multiplier then the quality band", () => {
  // First completion at Quick Run base (25), quality 90 => band 1.3 => 33.
  assert.equal(
    xpForCompletion({ qualityScore: 90, firstCompletion: true, withinWindow: false, qualifiesForReduced: false }),
    applyQualityModifier(QUICK_RUN_BASE_XP, 90)
  );
  // Reduced repeat: round(25 * 0.25) = 6, then the quality band.
  assert.equal(
    xpForCompletion({ qualityScore: 60, firstCompletion: false, withinWindow: true, qualifiesForReduced: true }),
    applyQualityModifier(Math.round(QUICK_RUN_BASE_XP * 0.25), 60)
  );
  assert.equal(
    xpForCompletion({ qualityScore: 90, firstCompletion: false, withinWindow: false, qualifiesForReduced: false }),
    0,
    "a non-qualifying repeat earns nothing"
  );
});

test("applyEnergyRegen consumes only whole ticks and preserves the remainder", () => {
  const partial = applyEnergyRegen(2, ENERGY_REGEN_INTERVAL_MS + 10 * 60 * 1000);
  assert.equal(partial.energy, 3, "one whole tick applies");
  assert.equal(partial.advancedMs, ENERGY_REGEN_INTERVAL_MS, "only the consumed interval advances the anchor");

  const atCap = applyEnergyRegen(MAX_ENERGY, ENERGY_REGEN_INTERVAL_MS * 3);
  assert.equal(atCap.energy, MAX_ENERGY);
  assert.equal(atCap.advancedMs, ENERGY_REGEN_INTERVAL_MS * 3, "a full bar anchors the reference point to now");

  const none = applyEnergyRegen(2, ENERGY_REGEN_INTERVAL_MS - 1);
  assert.equal(none.energy, 2);
  assert.equal(none.advancedMs, 0, "a sub-tick interval grants nothing and advances nothing");
});

test("energyCostForMode charges Arena/Tournament and frees the rest (§5)", () => {
  assert.equal(energyCostForMode("arena"), 1);
  assert.equal(energyCostForMode("tournament"), 1);
  for (const free of ["academy", "exam", "collection", "historical", "rematch", "series"]) {
    assert.equal(energyCostForMode(free), 0, `${free} must not spend Energy at launch`);
  }
});

test("XP repeat window is a 7-day span (§3.4)", () => {
  assert.equal(XP_REPEAT_WINDOW_MS, 7 * 24 * 60 * 60 * 1000);
});
