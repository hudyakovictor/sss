// Server-authoritative economy domain rules for XP / Level / Energy / Mastery Stars.
//
// Every constant and threshold here is taken from `docs/game_balance_spec.md`
// (§3 Account Level and XP, §4 Mastery Stars, §5 Energy). These are pure
// functions: no DB, no clock reads, no provider calls. Time and prior state are
// passed in by the caller so behavior stays deterministic and testable.
//
// Invariants (canonical, from AGENTS.md):
//   - Coins, XP, Energy and Mastery Stars never change score, outcome, ranking,
//     or risk advantage. Nothing in this file reads or writes a Score.

export const MAX_LEVEL = 99;
export const MAX_ENERGY = 5;

/** 1 Energy per 30 minutes (`H-ECON-1`). */
export const ENERGY_REGEN_INTERVAL_MS = 30 * 60 * 1000;

/** Maximum normal solo XP per UTC day (§3.4). */
export const MAX_DAILY_SOLO_XP = 500;

/** Base XP for a Quick Run / eligible Arena launch (§3.2). */
export const QUICK_RUN_BASE_XP = 25;

/** Repeat-eligibility window for the 25% second completion (§3.4). */
export const XP_REPEAT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function roundTo25(value: number): number {
  return Math.round(value / 25) * 25;
}

function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
    throw new RangeError(`Account level must be an integer 1..${MAX_LEVEL}, got ${level}`);
  }
}

/**
 * XP required to advance from `level` to the next one (`H-BAL-1`):
 *   xpToNext(L) = roundTo25(90 + 35L + 8L^1.55)
 * Level 99 is the cap and has no next level (returns 0).
 */
export function xpToNext(level: number): number {
  assertLevel(level);
  if (level === MAX_LEVEL) return 0;
  return roundTo25(90 + 35 * level + 8 * Math.pow(level, 1.55));
}

/** Cumulative XP held at the instant a level starts (level 1 starts at 0). */
export function cumulativeXpAtLevelStart(level: number): number {
  assertLevel(level);
  let total = 0;
  for (let l = 1; l < level; l += 1) total += xpToNext(l);
  return total;
}

/** Highest account level reachable with the given cumulative XP. */
export function levelFromXp(totalXp: number): number {
  if (!Number.isFinite(totalXp) || totalXp < 0) {
    throw new RangeError(`totalXp must be a non-negative number, got ${totalXp}`);
  }
  let level = 1;
  let remaining = Math.floor(totalXp);
  while (level < MAX_LEVEL) {
    const need = xpToNext(level);
    if (remaining < need) break;
    remaining -= need;
    level += 1;
  }
  return level;
}

/**
 * Quality-score XP modifier bands (§3.3). Applied only to the first rewardable
 * completion in the relevant reward window; callers gate that elsewhere.
 */
export function xpQualityModifier(qualityScore: number): number {
  if (!Number.isFinite(qualityScore) || qualityScore < 0 || qualityScore > 100) {
    throw new RangeError(`qualityScore must be 0..100, got ${qualityScore}`);
  }
  if (qualityScore <= 49) return 0.75;
  if (qualityScore <= 69) return 1.0;
  if (qualityScore <= 84) return 1.15;
  if (qualityScore <= 94) return 1.3;
  return 1.4;
}

/** Base XP scaled by the quality modifier, rounded to a whole XP unit. */
export function applyQualityModifier(baseXp: number, qualityScore: number): number {
  if (!Number.isInteger(baseXp) || baseXp < 0) {
    throw new RangeError(`baseXp must be a non-negative integer, got ${baseXp}`);
  }
  return Math.round(baseXp * xpQualityModifier(qualityScore));
}

/**
 * Clamp a deserved XP grant to the remaining daily solo cap (§3.4). The
 * exempt categories (onboarding, first Exam pass, compensation) are granted
 * outside this function by the caller; here we only model the capped path.
 */
export function xpGrantedAfterDailyCap(
  deservedXp: number,
  alreadyEarnedToday: number
): number {
  if (!Number.isInteger(deservedXp) || deservedXp < 0) {
    throw new RangeError(`deservedXp must be a non-negative integer, got ${deservedXp}`);
  }
  const remaining = Math.max(0, MAX_DAILY_SOLO_XP - Math.max(0, alreadyEarnedToday));
  return Math.min(deservedXp, remaining);
}

/**
 * XP repeat multiplier (§3.4):
 *   - first completion of a scenario version  -> normal (1.0);
 *   - a second completion within 7 days that is a valid Rematch OR a
 *     best-score improvement                   -> 25% (0.25);
 *   - any further identical repeat             -> 0.
 * `firstCompletion` is decided by the caller from persisted completion history;
 * `qualifiesForReduced` means the replay was a Rematch or improved the best score.
 */
export function xpRepeatMultiplier(input: {
  firstCompletion: boolean;
  withinWindow: boolean;
  qualifiesForReduced: boolean;
}): number {
  if (input.firstCompletion) return 1;
  if (input.withinWindow && input.qualifiesForReduced) return 0.25;
  return 0;
}

/**
 * Desired XP for a completion before the daily cap: base XP scaled by the
 * repeat multiplier, then by the quality modifier. A 0 multiplier always yields
 * 0 XP (no reward for identical repeats).
 */
export function xpForCompletion(input: {
  qualityScore: number;
  firstCompletion: boolean;
  withinWindow: boolean;
  qualifiesForReduced: boolean;
  baseXp?: number;
}): number {
  const multiplier = xpRepeatMultiplier(input);
  if (multiplier === 0) return 0;
  const effectiveBase = Math.round((input.baseXp ?? QUICK_RUN_BASE_XP) * multiplier);
  return applyQualityModifier(effectiveBase, input.qualityScore);
}

/**
 * Energy regeneration tick (§5, `H-ECON-1`). Given the current energy and the
 * milliseconds elapsed since `energyUpdatedAt`, return the regenerated value.
 * Never exceeds the cap; partial intervals do not accrue.
 */
export function regenerateEnergy(
  currentEnergy: number,
  elapsedMs: number
): number {
  if (!Number.isInteger(currentEnergy) || currentEnergy < 0 || currentEnergy > MAX_ENERGY) {
    throw new RangeError(`currentEnergy must be an integer 0..${MAX_ENERGY}, got ${currentEnergy}`);
  }
  if (currentEnergy >= MAX_ENERGY) return MAX_ENERGY;
  const ticks = Math.floor(Math.max(0, elapsedMs) / ENERGY_REGEN_INTERVAL_MS);
  return Math.min(MAX_ENERGY, currentEnergy + ticks);
}

/**
 * Lazy regeneration with exact time semantics. Returns the new energy plus how
 * much of `elapsedMs` should be consumed from the reference timestamp, so the
 * leftover partial interval is preserved instead of lost.
 *
 * When the bar is already full, `advancedMs` equals `elapsedMs` (the reference
 * point anchors to "now"), so no phantom accrual can happen after a later spend.
 * When below cap, only the whole ticks actually applied are consumed:
 *   newEnergy     = min(cap, energy + ticks)
 *   advancedMs    = (newEnergy - energy) * interval
 */
export function applyEnergyRegen(
  currentEnergy: number,
  elapsedMs: number
): { energy: number; advancedMs: number } {
  const energy = regenerateEnergy(currentEnergy, elapsedMs);
  if (currentEnergy >= MAX_ENERGY) {
    return { energy: MAX_ENERGY, advancedMs: Math.max(0, elapsedMs) };
  }
  const appliedTicks = energy - currentEnergy;
  return { energy, advancedMs: appliedTicks * ENERGY_REGEN_INTERVAL_MS };
}

/**
 * Milliseconds until the next energy unit regenerates, or null when the bar is
 * already full. `elapsedMs` is time since the last regen reference point.
 */
export function msUntilNextEnergy(
  currentEnergy: number,
  elapsedMs: number
): number | null {
  if (currentEnergy >= MAX_ENERGY) return null;
  const into = Math.max(0, elapsedMs);
  return ENERGY_REGEN_INTERVAL_MS - (into % ENERGY_REGEN_INTERVAL_MS);
}

export interface MasteryInput {
  /** Scenario was completed at all (earns ★☆☆). */
  completed: boolean;
  /** Final Quality Score 0..100. */
  qualityScore: number;
  /** Scenario `evaluationRules` key conditions satisfied (§4). */
  keyConditionsMet: boolean;
}

/**
 * Mastery Stars for a scenario (§4, `H-BAL-3`):
 *   0 — not completed;
 *   1 — completed;
 *   2 — Quality Score >= 70;
 *   3 — Quality Score >= 85 AND key conditions met.
 * The thresholds intentionally mirror the XP quality bands (§3.3).
 */
export function masteryStarsForScore(input: MasteryInput): 0 | 1 | 2 | 3 {
  if (!input.completed) return 0;
  if (!Number.isFinite(input.qualityScore) || input.qualityScore < 0 || input.qualityScore > 100) {
    throw new RangeError(`qualityScore must be 0..100, got ${input.qualityScore}`);
  }
  if (input.qualityScore >= 85 && input.keyConditionsMet) return 3;
  if (input.qualityScore >= 70) return 2;
  return 1;
}

/**
 * Key-condition signal for the third Mastery Star (§4, `H-MASTERY-COND`).
 * Derived only from the process dimensions of the score — never from Coins,
 * XP, Energy, or any risk input. A run meets key conditions when protocol
 * adherence and discipline are both at least 70 (the same floor as the ★2
 * quality band).
 */
export function keyConditionsMetForBreakdown(breakdown: {
  protocol_adherence: number;
  discipline: number;
}): boolean {
  return breakdown.protocol_adherence >= 70 && breakdown.discipline >= 70;
}

/**
 * Server-side Energy cost for starting a run (`H-ENERGY-COST`, §5 / §4).
 * Arena and tournament launches cost 1; Academy, Exam, Collection, historical,
 * and scheduled Rematch are free. Immediate (off-schedule) Rematch is charged by
 * the caller via the Rematch path, not by scenario mode.
 */
export function energyCostForMode(mode: string): 0 | 1 {
  return mode === "arena" || mode === "tournament" ? 1 : 0;
}
