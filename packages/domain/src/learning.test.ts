import assert from "node:assert/strict";
import test from "node:test";

import type { ChallengePassCriteria, LearningStatus } from "../../contracts/src/learning.js";
import type { DecisionTrace, ScoreResult } from "../../contracts/src/index.js";
import {
  LEARNING_GATE,
  evaluateChallengeVerification,
  nextLearningStatus,
  type LearningEvent
} from "./learning.js";

const CRITERIA: ChallengePassCriteria = {
  minQualityScore: 70,
  requireInvalidationBeforeAction: true,
  minEvidenceCount: 2,
  confidenceMin: 40,
  confidenceMax: 90
};

const REQUIRED_GATES = [
  LEARNING_GATE.invalidationPresent,
  LEARNING_GATE.invalidationBeforeAction,
  LEARNING_GATE.evidenceSufficient,
  LEARNING_GATE.confidenceInRange
];

function score(quality: number): ScoreResult {
  return { score: quality, breakdown: {} as ScoreResult["breakdown"], rubricVersion: "score-v1" };
}

function decision(overrides: Partial<DecisionTrace> = {}): DecisionTrace {
  return {
    action: "wait_for_confirmation",
    evidenceSourceIds: ["source_ohlcv", "source_volume"],
    invalidation: "Close back below the reclaimed level.",
    confidence: 65,
    ...overrides
  };
}

test("a fully satisfying challenge is verified with no failed gates", () => {
  const result = evaluateChallengeVerification({
    criteria: CRITERIA,
    requiredGates: REQUIRED_GATES,
    decision: decision(),
    score: score(82),
    invalidationBeforeAction: true
  });
  assert.equal(result.verified, true);
  assert.deepEqual(result.failedGates, []);
  assert.ok(result.satisfiedGates.includes(LEARNING_GATE.qualityThreshold));
});

test("quality score below threshold is always a hard failure", () => {
  const result = evaluateChallengeVerification({
    criteria: CRITERIA,
    requiredGates: [],
    decision: decision(),
    score: score(69),
    invalidationBeforeAction: true
  });
  assert.equal(result.verified, false);
  assert.ok(result.failedGates.includes(LEARNING_GATE.qualityThreshold));
});

test("direction chosen before invalidation blocks verification even at high score", () => {
  const result = evaluateChallengeVerification({
    criteria: CRITERIA,
    requiredGates: REQUIRED_GATES,
    decision: decision(),
    score: score(95),
    invalidationBeforeAction: false
  });
  assert.equal(result.verified, false);
  assert.ok(result.failedGates.includes(LEARNING_GATE.invalidationBeforeAction));
  assert.ok(result.reasons.some((reason) => /before/iu.test(reason)));
});

test("insufficient evidence count fails the evidence gate", () => {
  const result = evaluateChallengeVerification({
    criteria: CRITERIA,
    requiredGates: REQUIRED_GATES,
    decision: decision({ evidenceSourceIds: ["only_one"] }),
    score: score(90),
    invalidationBeforeAction: true
  });
  assert.equal(result.verified, false);
  assert.ok(result.failedGates.includes(LEARNING_GATE.evidenceSufficient));
});

test("confidence outside the range fails the calibration gate", () => {
  const tooHigh = evaluateChallengeVerification({
    criteria: CRITERIA,
    requiredGates: REQUIRED_GATES,
    decision: decision({ confidence: 95 }),
    score: score(90),
    invalidationBeforeAction: true
  });
  assert.ok(tooHigh.failedGates.includes(LEARNING_GATE.confidenceInRange));
  const tooLow = evaluateChallengeVerification({
    criteria: CRITERIA,
    requiredGates: REQUIRED_GATES,
    decision: decision({ confidence: 10 }),
    score: score(90),
    invalidationBeforeAction: true
  });
  assert.ok(tooLow.failedGates.includes(LEARNING_GATE.confidenceInRange));
});

test("an unmotivated (empty) invalidation fails the invalidation-present gate", () => {
  const result = evaluateChallengeVerification({
    criteria: CRITERIA,
    requiredGates: REQUIRED_GATES,
    decision: decision({ invalidation: "   " }),
    score: score(90),
    invalidationBeforeAction: true
  });
  assert.equal(result.verified, false);
  assert.ok(result.failedGates.includes(LEARNING_GATE.invalidationPresent));
});

function advance(events: LearningEvent[], from: LearningStatus = "available") {
  return events.reduce<LearningStatus>((status, event) => nextLearningStatus(status, event), from);
}

test("the guided path reaches verified only through a server challenge pass", () => {
  const status = advance([
    { type: "lesson_completed" },
    { type: "ready_for_verification" },
    { type: "challenge_passed", source: "guided_path" }
  ]);
  assert.equal(status, "verified");
});

test("reading the lesson never reaches verified on its own", () => {
  const status = advance([{ type: "lesson_completed" }, { type: "ready_for_verification" }]);
  assert.equal(status, "ready_for_verification");
});

test("a failed challenge keeps the learner in `learning`, never a negative state", () => {
  assert.equal(
    nextLearningStatus("ready_for_verification", { type: "challenge_failed" }),
    "learning"
  );
  assert.equal(nextLearningStatus("learning", { type: "challenge_failed" }), "learning");
});

test("a failed challenge never downgrades an already verified skill", () => {
  assert.equal(nextLearningStatus("verified", { type: "challenge_failed" }), "verified");
  assert.equal(nextLearningStatus("mastered", { type: "challenge_failed" }), "mastered");
});

test("one challenge pass does not grant mastery: mastery needs transfer + rematch", () => {
  const afterChallenge = nextLearningStatus("ready_for_verification", {
    type: "challenge_passed",
    source: "challenge_out"
  });
  assert.equal(afterChallenge, "verified");

  const afterTransferOpen = nextLearningStatus(afterChallenge, { type: "transfer_opened" });
  assert.equal(afterTransferOpen, "transfer_pending");

  const afterTransfer = nextLearningStatus(afterTransferOpen, { type: "transfer_passed" });
  assert.equal(afterTransfer, "review_due");
  assert.notEqual(afterTransfer, "mastered");

  const afterRematch = nextLearningStatus(afterTransfer, { type: "rematch_passed" });
  assert.equal(afterRematch, "mastered");
});

test("inapplicable events never skip the learner ahead", () => {
  // A locked module cannot be verified without unlocking and learning first.
  assert.equal(nextLearningStatus("locked", { type: "challenge_passed", source: "exam" }), "locked");
  // A challenge pass cannot jump straight past transfer to mastered.
  assert.equal(nextLearningStatus("transfer_pending", { type: "challenge_passed", source: "exam" }), "transfer_pending");
});
