import { ScenarioPackageSchema } from "../../../contracts/src/scenario.js";

// Challenge Test scenario B — the equivalent alternative used on a retry after
// a failed Challenge Test (see Iteration 04 Phase 2.4: next attempt must use a
// different but equivalent scenario). Same skill, different asset/timeframe.
export const invalidationChallengeB = ScenarioPackageSchema.parse({
  scenarioId: "invalidation-challenge-b-001",
  version: "1.0.0",
  scenarioLevel: 5,
  mode: "exam",
  assetClass: "crypto_perp",
  assetId: "asset_demo_gamma",
  marketSegment: "large_cap",
  timeframe: "1d",
  decisionPoint: {
    t0: "2024-05-06T00:00:00Z",
    timezone: "UTC"
  },
  availableSourceGroups: ["PRICE", "CONTEXT", "FLOW"],
  availableSources: [
    {
      sourceId: "source_ohlcv_gamma",
      sourceGroup: "PRICE",
      observedAt: "2024-05-05T23:58:00Z",
      availableAt: "2024-05-05T23:59:00Z",
      timezone: "UTC",
      sourceReference: "fixture://ohlcv/invalidation-challenge-b-001",
      reliability: "high",
      contentHash: "sha256:fixture-ohlcv-inval-b",
      revisionStatus: "original"
    },
    {
      sourceId: "source_context_gamma",
      sourceGroup: "CONTEXT",
      observedAt: "2024-05-05T23:50:00Z",
      availableAt: "2024-05-05T23:59:00Z",
      timezone: "UTC",
      sourceReference: "fixture://context/invalidation-challenge-b-001",
      reliability: "medium",
      contentHash: "sha256:fixture-context-inval-b",
      revisionStatus: "original"
    },
    {
      sourceId: "source_volume_gamma",
      sourceGroup: "FLOW",
      observedAt: "2024-05-05T23:55:00Z",
      availableAt: "2024-05-05T23:59:00Z",
      timezone: "UTC",
      sourceReference: "fixture://volume/invalidation-challenge-b-001",
      reliability: "high",
      contentHash: "sha256:fixture-volume-inval-b",
      revisionStatus: "original"
    }
  ],
  availableCards: ["c19_define_invalidation", "c20_set_structural_stop"],
  activeProtocols: ["p01_evidence_only"],
  hiddenEntities: ["wick_mimic"],
  allowedActions: ["long", "short", "wait", "no_trade", "wait_for_confirmation", "invalidate_idea"],
  historicalFutureSegment: {
    from: "2024-05-06T04:00:00Z",
    to: "2024-05-08T00:00:00Z",
    contentHash: "sha256:fixture-future-inval-b"
  },
  historicalOutcome: {
    outcomeId: "wick_reject_no_invalidation",
    summary: "A long wick rejected the move; the plan lacked a prior invalidation."
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
    summary: "Invalidation defined the exit before direction was chosen."
  },
  rematchLogic: {
    targetSkillId: "invalidation-before-direction",
    scenarioConstraints: ["different_asset", "different_timeframe"]
  },
  contentVersion: "content-academy-1",
  dataVersion: "data-fixture-1",
  futureHash: "sha256:fixture-future-inval-b",
  locale: "en-US",
  reviewStatus: "validated"
});
