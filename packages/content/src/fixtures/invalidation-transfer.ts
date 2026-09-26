import { ScenarioPackageSchema } from "../../../contracts/src/scenario.js";

// Arena Transfer scenario for `invalidation_before_direction`.
// Same threat as the Challenge Test, but a different asset and timeframe and
// no teaching scaffolding: passing here is what moves a verified skill toward
// provisional mastery (Iteration 04 Phase 6).
export const invalidationTransfer = ScenarioPackageSchema.parse({
  scenarioId: "invalidation-transfer-001",
  version: "1.0.0",
  scenarioLevel: 6,
  mode: "arena",
  assetClass: "crypto_perp",
  assetId: "asset_demo_delta",
  marketSegment: "large_cap",
  timeframe: "1h",
  decisionPoint: {
    t0: "2024-07-08T12:00:00Z",
    timezone: "UTC"
  },
  availableSourceGroups: ["PRICE", "CONTEXT", "FLOW"],
  availableSources: [
    {
      sourceId: "source_ohlcv_delta",
      sourceGroup: "PRICE",
      observedAt: "2024-07-08T11:58:00Z",
      availableAt: "2024-07-08T11:59:00Z",
      timezone: "UTC",
      sourceReference: "fixture://ohlcv/invalidation-transfer-001",
      reliability: "high",
      contentHash: "sha256:fixture-ohlcv-inval-t",
      revisionStatus: "original"
    },
    {
      sourceId: "source_context_delta",
      sourceGroup: "CONTEXT",
      observedAt: "2024-07-08T11:50:00Z",
      availableAt: "2024-07-08T11:59:00Z",
      timezone: "UTC",
      sourceReference: "fixture://context/invalidation-transfer-001",
      reliability: "medium",
      contentHash: "sha256:fixture-context-inval-t",
      revisionStatus: "original"
    },
    {
      sourceId: "source_volume_delta",
      sourceGroup: "FLOW",
      observedAt: "2024-07-08T11:55:00Z",
      availableAt: "2024-07-08T11:59:00Z",
      timezone: "UTC",
      sourceReference: "fixture://volume/invalidation-transfer-001",
      reliability: "high",
      contentHash: "sha256:fixture-volume-inval-t",
      revisionStatus: "original"
    }
  ],
  availableCards: ["c19_define_invalidation", "c27_risk_first_mode"],
  activeProtocols: ["p01_evidence_only"],
  hiddenEntities: ["certainty_siren"],
  allowedActions: ["long", "short", "wait", "no_trade", "wait_for_confirmation", "invalidate_idea"],
  historicalFutureSegment: {
    from: "2024-07-08T13:00:00Z",
    to: "2024-07-08T20:00:00Z",
    contentHash: "sha256:fixture-future-inval-t"
  },
  historicalOutcome: {
    outcomeId: "false_confirmation_reversal",
    summary: "An early confirmation trap reversed after the decision point."
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
    summary: "Transfer proof: the invalidation rule held on a new market context."
  },
  rematchLogic: {
    targetSkillId: "invalidation-before-direction",
    scenarioConstraints: ["different_asset", "different_timeframe"]
  },
  contentVersion: "content-academy-1",
  dataVersion: "data-fixture-1",
  futureHash: "sha256:fixture-future-inval-t",
  locale: "en-US",
  reviewStatus: "validated"
});
