import { ScenarioPackageSchema } from "../../../contracts/src/scenario.js";

// Challenge Test scenario A for `invalidation_before_direction`.
// Directly probes the skill: the correct move is to define the invalidation
// and wait for confirmation rather than anticipate direction on a weak break.
// Canonical Entity names remain exact English (see AGENTS.md invariants).
export const invalidationChallengeA = ScenarioPackageSchema.parse({
  scenarioId: "invalidation-challenge-a-001",
  version: "1.0.0",
  scenarioLevel: 4,
  mode: "exam",
  assetClass: "crypto_spot",
  assetId: "asset_demo_beta",
  marketSegment: "mid_cap",
  timeframe: "4h",
  decisionPoint: {
    t0: "2024-03-04T16:00:00Z",
    timezone: "UTC"
  },
  availableSourceGroups: ["PRICE", "FLOW"],
  availableSources: [
    {
      sourceId: "source_ohlcv_beta",
      sourceGroup: "PRICE",
      observedAt: "2024-03-04T15:58:00Z",
      availableAt: "2024-03-04T15:59:00Z",
      timezone: "UTC",
      sourceReference: "fixture://ohlcv/invalidation-challenge-a-001",
      reliability: "high",
      contentHash: "sha256:fixture-ohlcv-inval-a",
      revisionStatus: "original"
    },
    {
      sourceId: "source_volume_beta",
      sourceGroup: "FLOW",
      observedAt: "2024-03-04T15:57:00Z",
      availableAt: "2024-03-04T15:59:00Z",
      timezone: "UTC",
      sourceReference: "fixture://volume/invalidation-challenge-a-001",
      reliability: "medium",
      contentHash: "sha256:fixture-volume-inval-a",
      revisionStatus: "original"
    }
  ],
  availableCards: ["c19_define_invalidation", "c28_no_confirmation_no_trade"],
  activeProtocols: ["p01_evidence_only"],
  hiddenEntities: ["fake_breakout_phantom"],
  allowedActions: ["long", "short", "wait", "no_trade", "wait_for_confirmation", "invalidate_idea"],
  historicalFutureSegment: {
    from: "2024-03-04T20:00:00Z",
    to: "2024-03-05T12:00:00Z",
    contentHash: "sha256:fixture-future-inval-a"
  },
  historicalOutcome: {
    outcomeId: "breakout-fails-without-invalidation",
    summary: "The level broke back below before any directional follow-through."
  },
  evaluationRules: {
    rubricVersion: "score-v1",
    dimensions: [
      "decision_quality",
      "protocol_adherence",
      "evidence_quality",
      "follow_up_decision_quality",
      "risk_management",
      "invalidation",
      "discipline",
      "entity_resistance",
      "confidence_calibration"
    ]
  },
  debrief: {
    summary: "A valid invalidation would have exited the idea before the reversal."
  },
  rematchLogic: {
    targetSkillId: "invalidation-before-direction",
    scenarioConstraints: ["different_asset", "different_timeframe"]
  },
  contentVersion: "content-academy-1",
  dataVersion: "data-fixture-1",
  futureHash: "sha256:fixture-future-inval-a",
  locale: "en-US",
  reviewStatus: "validated"
});
