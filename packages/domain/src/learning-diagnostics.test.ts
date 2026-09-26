import assert from "node:assert/strict";
import test from "node:test";

import type { DecisionEventType } from "../../contracts/src/telemetry.js";
import {
  DIRECTION_BEFORE_INVALIDATION,
  computeRunFeatures,
  derivePersonalInsight,
  type RunTimeline,
  type TelemetryObservation
} from "./learning-diagnostics.js";

function obs(
  sequence: number,
  eventType: DecisionEventType,
  clientElapsedMs: number,
  payload?: Record<string, string | number | boolean>
): TelemetryObservation {
  return { sequence, eventType, clientElapsedMs, ...(payload ? { payload } : {}) };
}

// A run where the learner picks a direction before writing a substantive
// invalidation — the exact slip the diagnostic looks for.
function directionFirstRun(runId: string, context: RunTimeline["context"], verified = false): RunTimeline {
  return {
    runId,
    skillId: "invalidation_before_direction",
    context,
    verified,
    events: [
      obs(1, "evidence_selected", 800),
      obs(2, "action_selected", 1500),
      obs(3, "confidence_changed", 2000, { value: 70 }),
      obs(4, "invalidation_changed", 6000, { textLength: 42 })
    ]
  };
}

// A disciplined run: invalidation is written before the direction is chosen.
function invalidationFirstRun(runId: string, context: RunTimeline["context"], verified = false): RunTimeline {
  return {
    runId,
    skillId: "invalidation_before_direction",
    context,
    verified,
    events: [
      obs(1, "evidence_selected", 700),
      obs(2, "invalidation_changed", 2200, { textLength: 55 }),
      obs(3, "action_selected", 4000),
      obs(4, "confidence_changed", 4600, { value: 60 })
    ]
  };
}

test("computeRunFeatures flags action-before-invalidation and counts evidence around the action", () => {
  const features = computeRunFeatures(directionFirstRun("run-a", "challenge"));

  assert.equal(features.runId, "run-a");
  assert.equal(features.actionBeforeInvalidation, true);
  assert.equal(features.evidenceBeforeActionCount, 1);
  assert.equal(features.evidenceAfterActionCount, 0);
  assert.equal(features.confidenceBeforeEvidence, false);
  assert.equal(features.confidenceChangeCount, 1);
  assert.equal(features.decisionChangeCount, 0);
  // Durations come from the trustworthy clientElapsedMs, ordered by sequence.
  assert.equal(features.timeToFirstActionMs, 1500);
  assert.equal(features.timeToInvalidationMs, 6000);
});

test("computeRunFeatures treats a disciplined run as clean", () => {
  const features = computeRunFeatures(invalidationFirstRun("run-b", "guided_practice"));
  assert.equal(features.actionBeforeInvalidation, false);
  assert.equal(features.evidenceBeforeActionCount, 1);
});

test("computeRunFeatures ignores trivial invalidation text as non-substantive", () => {
  const trivial: RunTimeline = {
    runId: "run-trivial",
    skillId: "invalidation_before_direction",
    context: "challenge",
    verified: false,
    events: [
      obs(1, "action_selected", 900),
      // A one-word stub is not a real death condition.
      obs(2, "invalidation_changed", 5000, { textLength: 4 })
    ]
  };
  const features = computeRunFeatures(trivial);
  // No substantive invalidation existed, so the action still counts as first.
  assert.equal(features.actionBeforeInvalidation, true);
  assert.equal(features.timeToInvalidationMs, null);
});

test("computeRunFeatures counts action changes as decision changes", () => {
  const run: RunTimeline = {
    runId: "run-changes",
    skillId: "invalidation_before_direction",
    context: "exam",
    verified: false,
    events: [
      obs(1, "action_selected", 1000),
      obs(2, "action_changed", 3000),
      obs(3, "action_changed", 4000),
      obs(4, "confidence_changed", 5000, { value: 50 }),
      obs(5, "confidence_changed", 6000, { value: 80 }),
      obs(6, "invalidation_changed", 9000, { textLength: 30 })
    ]
  };
  const features = computeRunFeatures(run);
  assert.equal(features.decisionChangeCount, 2);
  assert.equal(features.confidenceChangeCount, 2);
  assert.equal(features.actionBeforeInvalidation, true);
});

test("derivePersonalInsight refuses to conclude from a single attempt", () => {
  const insight = derivePersonalInsight({
    skillId: "invalidation_before_direction",
    runs: [directionFirstRun("run-only", "challenge")],
    generatedAt: "2026-09-26T10:00:00.000Z"
  });
  assert.equal(insight, null);
});

test("derivePersonalInsight needs the pattern outside guided practice", () => {
  const insight = derivePersonalInsight({
    skillId: "invalidation_before_direction",
    runs: [
      directionFirstRun("run-g1", "guided_practice"),
      directionFirstRun("run-g2", "guided_practice")
    ],
    generatedAt: "2026-09-26T10:00:00.000Z"
  });
  // Two guided slips are a context-specific slip, not a transferable weakness.
  assert.equal(insight, null);
});

test("derivePersonalInsight confirms a repeated pattern and stays explainable", () => {
  const insight = derivePersonalInsight({
    skillId: "invalidation_before_direction",
    runs: [
      directionFirstRun("run-c1", "guided_practice"),
      directionFirstRun("run-c2", "challenge")
    ],
    generatedAt: "2026-09-26T10:00:00.000Z"
  });

  assert.ok(insight);
  assert.equal(insight.patternId, DIRECTION_BEFORE_INVALIDATION);
  assert.equal(insight.status, "confirmed");
  assert.equal(insight.observationCount, 2);
  assert.equal(insight.contextCount, 2);
  assert.deepEqual([...insight.evidenceRunIds].sort(), ["run-c1", "run-c2"]);
  assert.ok(insight.confidence > 0 && insight.confidence <= 0.95);
  assert.match(insight.text, /направление до/);
});

test("derivePersonalInsight marks a single-context repeat as repeated", () => {
  const insight = derivePersonalInsight({
    skillId: "invalidation_before_direction",
    runs: [directionFirstRun("run-r1", "challenge"), directionFirstRun("run-r2", "exam")],
    generatedAt: "2026-09-26T10:00:00.000Z"
  });
  assert.ok(insight);
  // challenge + exam are two distinct non-guided contexts -> confirmed.
  assert.equal(insight.status, "confirmed");

  const single = derivePersonalInsight({
    skillId: "invalidation_before_direction",
    runs: [directionFirstRun("run-r3", "challenge"), directionFirstRun("run-r4", "challenge")],
    generatedAt: "2026-09-26T10:00:00.000Z"
  });
  assert.ok(single);
  assert.equal(single.status, "repeated");
});

test("derivePersonalInsight reports resolved after the skill is verified and recent runs are clean", () => {
  const insight = derivePersonalInsight({
    skillId: "invalidation_before_direction",
    runs: [
      directionFirstRun("run-p1", "challenge"),
      directionFirstRun("run-p2", "exam"),
      invalidationFirstRun("run-clean1", "challenge", true),
      invalidationFirstRun("run-clean2", "transfer")
    ],
    generatedAt: "2026-09-26T10:00:00.000Z"
  });
  assert.ok(insight);
  assert.equal(insight.status, "resolved");
  // Evidence still points at the earlier runs that established the pattern.
  assert.ok(insight.evidenceRunIds.includes("run-p1"));
});

test("derivePersonalInsight ignores runs for other skills", () => {
  const foreign: RunTimeline = {
    runId: "run-foreign",
    skillId: "risk_management",
    context: "challenge",
    verified: false,
    events: [obs(1, "action_selected", 500), obs(2, "invalidation_changed", 4000, { textLength: 30 })]
  };
  const insight = derivePersonalInsight({
    skillId: "invalidation_before_direction",
    runs: [foreign],
    generatedAt: "2026-09-26T10:00:00.000Z"
  });
  assert.equal(insight, null);
});
