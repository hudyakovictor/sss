import type {
  ChallengePassCriteria,
  LearningStatus,
  VerificationSource
} from "../../contracts/src/learning.js";
import type { DecisionTrace, ScoreResult } from "../../contracts/src/index.js";

// Server-authoritative learning progression — Iteration 04 Phase 2.
//
// These are pure functions with no I/O and no store access: they are the single
// definition of *when a topic counts as verified* and *how a module's status may
// move*. The server is the only caller; the client never runs this logic and
// therefore cannot fabricate progression.
//
// Guardrails encoded here:
//   - Reading theory is not mastery: verification always needs a sealed, scored
//     attempt plus the critical gates below.
//   - A failed Challenge Test never penalises the learner: it returns the module
//     to `learning` and grants no negative state. (XP/Energy are handled by the
//     economy layer, which this module deliberately does not touch.)
//   - Every gate that fails is named, so the corrective lesson can be chosen
//     deterministically downstream.

export const LEARNING_GATE = {
  invalidationPresent: "invalidation_present",
  invalidationBeforeAction: "invalidation_before_action",
  evidenceSufficient: "evidence_sufficient",
  confidenceInRange: "confidence_in_range",
  qualityThreshold: "quality_threshold"
} as const;

export type LearningGateId = (typeof LEARNING_GATE)[keyof typeof LEARNING_GATE];

export interface ChallengeVerificationInput {
  readonly criteria: ChallengePassCriteria;
  readonly requiredGates: readonly string[];
  readonly decision: DecisionTrace;
  readonly score: ScoreResult;
  // Whether the decision timeline (Decision Telemetry, Phase 3/4) shows the
  // invalidation being authored before the final action was locked in. The
  // verification policy cannot infer ordering from a sealed snapshot alone, so
  // the server supplies it explicitly.
  readonly invalidationBeforeAction: boolean;
}

export interface ChallengeVerificationResult {
  readonly verified: boolean;
  readonly qualityScore: number;
  readonly satisfiedGates: readonly LearningGateId[];
  readonly failedGates: readonly LearningGateId[];
  readonly reasons: readonly string[];
}

function evaluateGates(input: ChallengeVerificationInput): {
  satisfied: Set<LearningGateId>;
  reasons: Map<LearningGateId, string>;
} {
  const satisfied = new Set<LearningGateId>();
  const reasons = new Map<LearningGateId, string>();
  const { criteria, decision, score } = input;

  if (decision.invalidation.trim().length > 0) {
    satisfied.add(LEARNING_GATE.invalidationPresent);
  } else {
    reasons.set(LEARNING_GATE.invalidationPresent, "Invalidation is empty; the idea has no death condition.");
  }

  if (input.invalidationBeforeAction) {
    satisfied.add(LEARNING_GATE.invalidationBeforeAction);
  } else {
    reasons.set(LEARNING_GATE.invalidationBeforeAction, "Direction was chosen before the invalidation was written.");
  }

  if (decision.evidenceSourceIds.length >= criteria.minEvidenceCount) {
    satisfied.add(LEARNING_GATE.evidenceSufficient);
  } else {
    reasons.set(
      LEARNING_GATE.evidenceSufficient,
      `Selected ${decision.evidenceSourceIds.length} evidence source(s); ${criteria.minEvidenceCount} required.`
    );
  }

  if (decision.confidence >= criteria.confidenceMin && decision.confidence <= criteria.confidenceMax) {
    satisfied.add(LEARNING_GATE.confidenceInRange);
  } else {
    reasons.set(
      LEARNING_GATE.confidenceInRange,
      `Confidence ${decision.confidence} is outside ${criteria.confidenceMin}..${criteria.confidenceMax}.`
    );
  }

  if (score.score >= criteria.minQualityScore) {
    satisfied.add(LEARNING_GATE.qualityThreshold);
  } else {
    reasons.set(
      LEARNING_GATE.qualityThreshold,
      `Quality Score ${score.score} is below the ${criteria.minQualityScore} threshold.`
    );
  }

  return { satisfied, reasons };
}

export function evaluateChallengeVerification(
  input: ChallengeVerificationInput
): ChallengeVerificationResult {
  const { satisfied, reasons } = evaluateGates(input);

  // The named critical gates decide which checks are mandatory. Quality Score is
  // always a hard floor; `requireInvalidationBeforeAction` forces the ordering
  // gate even if a caller omits it from the list.
  const required = new Set<string>(input.requiredGates);
  if (input.criteria.requireInvalidationBeforeAction) {
    required.add(LEARNING_GATE.invalidationBeforeAction);
  }
  required.add(LEARNING_GATE.qualityThreshold);

  const satisfiedList = (Object.values(LEARNING_GATE) as LearningGateId[]).filter((gate) => satisfied.has(gate));
  const failedList = (Object.values(LEARNING_GATE) as LearningGateId[]).filter(
    (gate) => required.has(gate) && !satisfied.has(gate)
  );

  const reasonTexts = failedList
    .map((gate) => reasons.get(gate))
    .filter((text): text is string => text !== undefined);

  return {
    verified: failedList.length === 0,
    qualityScore: input.score.score,
    satisfiedGates: satisfiedList,
    failedGates: failedList,
    reasons: reasonTexts
  };
}

export type LearningEvent =
  | { readonly type: "module_unlocked" }
  | { readonly type: "lesson_completed" }
  | { readonly type: "ready_for_verification" }
  | { readonly type: "challenge_passed"; readonly source: VerificationSource }
  | { readonly type: "challenge_failed" }
  | { readonly type: "transfer_opened" }
  | { readonly type: "transfer_passed" }
  | { readonly type: "rematch_due" }
  | { readonly type: "rematch_passed" };

// A conservative, deterministic state machine. Unknown or inapplicable events
// leave the status unchanged so no client-driven event can skip ahead: the only
// path into `verified` is a server-verified challenge, and the only path into
// `mastered` runs through Arena Transfer and a delayed rematch (Phase 6).
export function nextLearningStatus(current: LearningStatus, event: LearningEvent): LearningStatus {
  switch (event.type) {
    case "module_unlocked":
      return current === "locked" ? "available" : current;
    case "lesson_completed":
      return current === "locked" ? current : current === "verified" || current === "mastered" ? current : "learning";
    case "ready_for_verification":
      return current === "learning" ? "ready_for_verification" : current;
    case "challenge_passed":
      return current === "ready_for_verification" || current === "learning" || current === "available"
        ? "verified"
        : current;
    case "challenge_failed":
      // A failed attempt never downgrades a confirmed skill and never penalises;
      // it simply keeps the learner in the active learning region.
      return current === "verified" || current === "transfer_pending" || current === "mastered"
        ? current
        : "learning";
    case "transfer_opened":
      return current === "verified" ? "transfer_pending" : current;
    case "transfer_passed":
      return current === "transfer_pending" ? "review_due" : current;
    case "rematch_due":
      return current === "review_due" ? "review_due" : current;
    case "rematch_passed":
      return current === "review_due" ? "mastered" : current;
    default:
      return current;
  }
}
