import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Iteration 03 · Phase E — API integration gate.
//
// This is the full authoritative loop exercised purely over HTTP with no
// browser in the loop: auth → scenario → start → seal → reveal → reward. It
// asserts the two invariants the economy rests on: a completion earns XP and
// Mastery, and it never mints Coins. Fixture auth is self-scoped to the seed
// user, so identity, balance, and the ledger all address the same principal.

const SCENARIO_ID = "foundation-false-breakout-001";
const SCENARIO_VERSION = "1.0.0";

const GOOD_DECISION = {
  action: "wait_for_confirmation",
  evidenceSourceIds: ["source_ohlcv_demo", "source_volume_demo"],
  invalidation: "Close below the failed breakout level.",
  confidence: 72
};

type Envelope = { data: any };

test("auth → scenario → start → seal → reveal → reward earns XP + Mastery and zero Coins", async ({
  request
}) => {
  const me = await request.get("/api/v1/auth/me");
  expect(me.ok()).toBeTruthy();
  const userId = ((await me.json()) as Envelope).data.userId as string;
  expect(userId.length).toBeGreaterThan(0);

  const scenarioRes = await request.get(
    `/api/v1/scenarios/${SCENARIO_ID}?version=${SCENARIO_VERSION}`
  );
  expect(scenarioRes.ok()).toBeTruthy();
  const scenario = ((await scenarioRes.json()) as Envelope).data;
  expect(scenario.scenarioId).toBe(SCENARIO_ID);
  expect(scenario.allowedActions).toContain(GOOD_DECISION.action);

  const startRes = await request.post("/api/v1/scenario-runs", {
    data: {
      scenarioId: SCENARIO_ID,
      scenarioVersion: SCENARIO_VERSION,
      idempotencyKey: `pw:${randomUUID()}`
    }
  });
  expect(startRes.status()).toBe(201);
  const startBody = ((await startRes.json()) as Envelope).data;
  const runId = startBody.run.runId as string;
  expect(startBody.run.state).toBe("started");
  expect(startBody.balance.coins).toBe(0);

  const sealRes = await request.post(`/api/v1/scenario-runs/${runId}/seal`, {
    data: GOOD_DECISION
  });
  expect(sealRes.ok()).toBeTruthy();
  expect(((await sealRes.json()) as Envelope).data.run.state).toBe("sealed");

  const revealRes = await request.get(`/api/v1/scenario-runs/${runId}/reveal`);
  expect(revealRes.ok()).toBeTruthy();
  const revealBody = ((await revealRes.json()) as Envelope).data;
  expect(revealBody.reveal).toBeTruthy();
  const qualityScore = revealBody.run.score.score as number;
  expect(qualityScore).toBeGreaterThan(0);

  const rewardRes = await request.post(`/api/v1/scenario-runs/${runId}/rewards`);
  expect(rewardRes.ok()).toBeTruthy();
  const reward = ((await rewardRes.json()) as Envelope).data;
  expect(reward.granted).toBe(true);
  expect(reward.xpGranted).toBeGreaterThan(0);
  expect(reward.masteryDelta).toBeGreaterThan(0);
  expect(reward.balance.coins).toBe(0);

  // Idempotent replay must not grant twice.
  const replay = await request.post(`/api/v1/scenario-runs/${runId}/rewards`);
  expect(replay.ok()).toBeTruthy();
  expect(((await replay.json()) as Envelope).data.granted).toBe(false);

  // Ledger invariant: scenario completion never writes a coin-asset event.
  const ledgerRes = await request.get(`/api/v1/users/${userId}/ledger`);
  expect(ledgerRes.ok()).toBeTruthy();
  const ledger = ((await ledgerRes.json()) as Envelope).data;
  const coinEvents = (ledger.events as Array<{ asset: string }>).filter((e) => e.asset === "coin");
  expect(coinEvents).toHaveLength(0);
  expect((ledger.events as Array<{ kind: string }>).some((e) => e.kind === "xp_awarded")).toBe(true);
});
