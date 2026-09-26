import type { DecisionEventType } from "../../contracts/src/telemetry.js";

// Diagnostic Engine + Personal Insight v0 — Iteration 04 Phase 4.
//
// This is a pure, deterministic module: no LLM, no I/O, no clock of its own.
// Personal Insight is produced *only* from verifiable per-run features derived
// from the ordered telemetry timeline (Phase 3), so every insight can be
// explained by concrete run ids and feature values (Phase 4 gate).
//
// Two hard guardrails from the iteration:
//   - The system never concludes from a single attempt: an insight needs at
//     least `REQUIRED_OBSERVATIONS` qualifying runs, and "reading theory" or
//     one lucky guided pass is not evidence of a habit.
//   - The pattern must show up outside guided practice too, otherwise it is a
//     context-specific slip, not a transferable weakness.

export const DIRECTION_BEFORE_INVALIDATION = "direction_before_invalidation" as const;

const MIN_INVALIDATION_CHARS = 12;
const REQUIRED_OBSERVATIONS = 2;

export type AttemptContext = "guided_practice" | "challenge" | "transfer" | "exam";

// A single telemetry observation the diagnostics care about. The server maps its
// stored `decision_events` into this shape, preferring the per-run `sequence` for
// ordering and `clientElapsedMs` for durations (client wall-clock is not trusted).
export interface TelemetryObservation {
  readonly sequence: number;
  readonly eventType: DecisionEventType;
  readonly clientElapsedMs: number;
  readonly payload?: Readonly<Record<string, string | number | boolean>>;
}

export interface RunTimeline {
  readonly runId: string;
  readonly skillId: string;
  readonly context: AttemptContext;
  readonly events: readonly TelemetryObservation[];
  // Whether this run's attempt was server-verified (challenge/transfer passed).
  readonly verified: boolean;
}

export interface RunFeatures {
  readonly runId: string;
  readonly skillId: string;
  readonly context: AttemptContext;
  readonly verified: boolean;
  readonly timeToFirstActionMs: number | null;
  readonly timeToInvalidationMs: number | null;
  readonly actionBeforeInvalidation: boolean;
  readonly evidenceBeforeActionCount: number;
  readonly evidenceAfterActionCount: number;
  readonly confidenceBeforeEvidence: boolean;
  readonly confidenceChangeCount: number;
  readonly decisionChangeCount: number;
}

function payloadCharCount(event: TelemetryObservation): number {
  const raw = event.payload?.textLength ?? event.payload?.chars;
  return typeof raw === "number" ? raw : 0;
}

function isSubstantiveInvalidation(event: TelemetryObservation): boolean {
  if (event.eventType !== "invalidation_started" && event.eventType !== "invalidation_changed") {
    return false;
  }
  // An explicit length that is too small is not a real death condition; if no
  // length is reported, an edit event is treated as substantive content.
  const length = payloadCharCount(event);
  return length === 0 ? event.eventType === "invalidation_changed" : length >= MIN_INVALIDATION_CHARS;
}

function firstSequence(
  events: readonly TelemetryObservation[],
  predicate: (event: TelemetryObservation) => boolean
): { sequence: number; elapsedMs: number } | null {
  let best: TelemetryObservation | null = null;
  for (const event of events) {
    if (!predicate(event)) continue;
    if (!best || event.sequence < best.sequence) best = event;
  }
  return best ? { sequence: best.sequence, elapsedMs: best.clientElapsedMs } : null;
}

function countMatching(
  events: readonly TelemetryObservation[],
  predicate: (event: TelemetryObservation) => boolean
): number {
  let total = 0;
  for (const event of events) if (predicate(event)) total += 1;
  return total;
}

// Compute the deterministic Phase 4 feature vector for one run, using `sequence`
// as the authoritative order (background-tab clock drift cannot reorder it).
export function computeRunFeatures(timeline: RunTimeline): RunFeatures {
  const events = timeline.events;
  const action = firstSequence(events, (e) => e.eventType === "action_selected");
  const invalidation = firstSequence(events, isSubstantiveInvalidation);
  const evidence = firstSequence(events, (e) => e.eventType === "evidence_selected");
  const confidence = firstSequence(events, (e) => e.eventType === "confidence_changed");

  const evidenceBeforeActionCount = action
    ? countMatching(events, (e) => e.eventType === "evidence_selected" && e.sequence < action.sequence)
    : countMatching(events, (e) => e.eventType === "evidence_selected");
  const evidenceAfterActionCount = action
    ? countMatching(events, (e) => e.eventType === "evidence_selected" && e.sequence > action.sequence)
    : 0;

  // Action chosen before any substantive invalidation (or an invalidation never
  // appeared at all) is the core slip this diagnostic looks for.
  const actionBeforeInvalidation = action
    ? invalidation === null || action.sequence < invalidation.sequence
    : false;

  const confidenceBeforeEvidence =
    confidence !== null && (evidence === null || confidence.sequence < evidence.sequence);

  return {
    runId: timeline.runId,
    skillId: timeline.skillId,
    context: timeline.context,
    verified: timeline.verified,
    timeToFirstActionMs: action?.elapsedMs ?? null,
    timeToInvalidationMs: invalidation?.elapsedMs ?? null,
    actionBeforeInvalidation,
    evidenceBeforeActionCount,
    evidenceAfterActionCount,
    confidenceBeforeEvidence,
    confidenceChangeCount: countMatching(events, (e) => e.eventType === "confidence_changed"),
    decisionChangeCount: countMatching(events, (e) => e.eventType === "action_changed")
  };
}

export type InsightStatus = "preliminary" | "repeated" | "confirmed" | "resolved";

export interface PersonalInsight {
  readonly insightId: string;
  readonly patternId: typeof DIRECTION_BEFORE_INVALIDATION;
  readonly skillId: string;
  readonly status: InsightStatus;
  readonly observationCount: number;
  readonly contextCount: number;
  readonly confidence: number;
  readonly evidenceRunIds: readonly string[];
  readonly generatedAt: string;
  readonly recommendedAction: string;
  // Server-composed copy the client renders verbatim. It is a deterministic
  // template, not an LLM output; the LLM layer may later rephrase an already
  // confirmed conclusion but must not create one.
  readonly text: string;
}

const RU_NUMERAL: Record<number, string> = {
  2: "двух",
  3: "трёх",
  4: "четырёх",
  5: "пяти",
  6: "шести"
};

function numeral(value: number): string {
  return RU_NUMERAL[value] ?? String(value);
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(0.95, Math.round(value * 100) / 100));
}

function runShowsPattern(features: RunFeatures): boolean {
  const evidenceTotal = features.evidenceBeforeActionCount + features.evidenceAfterActionCount;
  // A diagnosis needs a real decision with some evidence in it, not an empty run.
  return features.actionBeforeInvalidation && evidenceTotal > 0;
}

function buildInsight(
  skillId: string,
  status: InsightStatus,
  observationCount: number,
  contextCount: number,
  evidenceRunIds: readonly string[],
  generatedAt: string
): PersonalInsight {
  const confidence =
    status === "resolved"
      ? clampConfidence(0.8)
      : clampConfidence(0.5 + 0.12 * observationCount + 0.1 * contextCount);

  const recommendedAction =
    status === "resolved"
      ? "Закрепи навык отложенным rematch — привычка формируется, но ещё не стабильна."
      : "Пройди Challenge Test: направление станет доступным только после формулировки условия отмены идеи.";

  const text =
    status === "resolved"
      ? "В последних решениях инвалидация шла перед направлением. Навык восстанавливается — держи формат."
      : `В ${numeral(observationCount)} последних решениях ты выбирал направление до определения инвалидации. Следующий шаг — Challenge Test, где действие станет доступно только после формулировки условия отмены идеи.`;

  return {
    insightId: `insight:${skillId}:${DIRECTION_BEFORE_INVALIDATION}:${status}`,
    patternId: DIRECTION_BEFORE_INVALIDATION,
    skillId,
    status,
    observationCount,
    contextCount,
    confidence,
    evidenceRunIds,
    generatedAt,
    recommendedAction,
    text
  };
}

// Derive Personal Insight v0 for a skill from the learner's recent runs. Runs are
// expected to be supplied oldest→newest. Returns zero or one insight for the
// `direction_before_invalidation` pattern; empty means "we cannot conclude yet".
export function derivePersonalInsight(input: {
  readonly skillId: string;
  readonly runs: readonly RunTimeline[];
  readonly generatedAt: string;
}): PersonalInsight | null {
  const features = input.runs
    .filter((run) => run.skillId === input.skillId)
    .map(computeRunFeatures);
  if (features.length === 0) {
    return null;
  }

  const observations = features.filter(runShowsPattern);
  const nonGuidedObservations = observations.filter((f) => f.context !== "guided_practice");
  const contexts = new Set(observations.map((f) => f.context));

  // Resolved: the habit was observed, but the learner has since verified the
  // skill and the two most recent runs are clean.
  const hasVerified = features.some((f) => f.verified);
  const recentRuns = features.slice(-2);
  const recentClean = recentRuns.length > 0 && recentRuns.every((f) => !runShowsPattern(f));
  if (hasVerified && recentClean && observations.length >= REQUIRED_OBSERVATIONS) {
    return buildInsight(
      input.skillId,
      "resolved",
      observations.length,
      contexts.size,
      observations.map((f) => f.runId),
      input.generatedAt
    );
  }

  // Gate: never conclude from a single attempt, and the pattern must appear
  // outside guided practice to count as a transferable weakness.
  if (observations.length < REQUIRED_OBSERVATIONS || nonGuidedObservations.length === 0) {
    return null;
  }

  const status: InsightStatus = contexts.size >= 2 ? "confirmed" : "repeated";
  return buildInsight(
    input.skillId,
    status,
    observations.length,
    contexts.size,
    observations.map((f) => f.runId),
    input.generatedAt
  );
}
