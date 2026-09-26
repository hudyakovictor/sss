import assert from "node:assert/strict";
import test from "node:test";

import { buildServer } from "../../apps/api-server/src/server.js";
import { BalanceResponseSchema, LedgerPageSchema } from "../../packages/contracts/src/economy.js";

const DECISION = {
  action: "wait_for_confirmation" as const,
  evidenceSourceIds: ["source_ohlcv_demo", "source_volume_demo"],
  invalidation: "Close below the failed breakout level.",
  confidence: 72
};

const USER_ID = "seed-user-001";

async function startAndSealRun(server: ReturnType<typeof buildServer>, idempotencyKey: string) {
  const start = await server.inject({
    method: "POST",
    url: "/api/v1/scenario-runs",
    payload: {
      scenarioId: "foundation-false-breakout-001",
      scenarioVersion: "1.0.0",
      idempotencyKey
    }
  });
  const runId = start.json<{ data: { run: { runId: string } } }>().data.run.runId;
  const seal = await server.inject({
    method: "POST",
    url: `/api/v1/scenario-runs/${runId}/seal`,
    payload: DECISION
  });
  assert.equal(seal.statusCode, 200);
  return runId;
}

test("balance starts at zero and ledger reads never mutate state", async () => {
  const server = buildServer();

  const balance = await server.inject({ method: "GET", url: `/api/v1/users/${USER_ID}/balance` });
  assert.equal(balance.statusCode, 200);
  const state = BalanceResponseSchema.parse(balance.json<{ data: unknown }>().data);
  assert.equal(state.xp, 0);
  assert.equal(state.coins, 0);
  assert.equal(state.energy, 5);

  const first = await server.inject({ method: "GET", url: `/api/v1/users/${USER_ID}/ledger` });
  const second = await server.inject({ method: "GET", url: `/api/v1/users/${USER_ID}/ledger` });
  assert.deepEqual(first.json(), second.json(), "GET reads are side-effect free");
  assert.equal(LedgerPageSchema.parse(first.json<{ data: unknown }>().data).events.length, 0);

  await server.close();
});

test("a sealed run grants rewards once and a repeated grant is idempotent", async () => {
  const server = buildServer();
  const runId = await startAndSealRun(server, "econ-run-001");
  await server.inject({ method: "GET", url: `/api/v1/scenario-runs/${runId}/reveal` });

  const grant = await server.inject({ method: "POST", url: `/api/v1/scenario-runs/${runId}/rewards` });
  assert.equal(grant.statusCode, 200);
  const grantBody = grant.json<{
    data: {
      granted: boolean;
      xpGranted: number;
      masteryDelta: number;
      balance: { xp: number; coins: number; masteryStars: number };
    };
  }>().data;
  assert.equal(grantBody.granted, true);
  assert.ok(grantBody.xpGranted > 0, "a completion earns XP");
  assert.ok(grantBody.masteryDelta > 0, "a completion earns Mastery");
  assert.equal(grantBody.balance.coins, 0, "scenario completion never mints Coins");

  const replay = await server.inject({ method: "POST", url: `/api/v1/scenario-runs/${runId}/rewards` });
  assert.equal(replay.statusCode, 200);
  const replayBody = replay.json<{
    data: { granted: boolean; balance: { xp: number; coins: number } };
  }>().data;
  assert.equal(replayBody.granted, false, "a repeated grant is idempotent");
  assert.deepEqual(replayBody.balance, grantBody.balance);

  const ledger = await server.inject({ method: "GET", url: `/api/v1/users/${USER_ID}/ledger` });
  const page = LedgerPageSchema.parse(ledger.json<{ data: unknown }>().data);
  assert.ok(page.events.length >= 1, "the grant wrote ledger rows");
  assert.ok(
    page.events.every((event) => event.asset !== "coin"),
    "no coin-asset event may be produced by a completion"
  );

  await server.close();
});

test("rewards cannot be granted for an unsealed run", async () => {
  const server = buildServer();
  const start = await server.inject({
    method: "POST",
    url: "/api/v1/scenario-runs",
    payload: {
      scenarioId: "foundation-false-breakout-001",
      scenarioVersion: "1.0.0",
      idempotencyKey: "econ-run-unsealed"
    }
  });
  const runId = start.json<{ data: { run: { runId: string } } }>().data.run.runId;

  const grant = await server.inject({ method: "POST", url: `/api/v1/scenario-runs/${runId}/rewards` });
  assert.equal(grant.statusCode, 409);
  assert.equal(grant.json<{ error: string }>().error, "scenario_run_not_sealed");

  await server.close();
});

test("economy reads are self-scoped and reject other users", async () => {
  const server = buildServer();
  const balance = await server.inject({ method: "GET", url: "/api/v1/users/someone-else/balance" });
  assert.equal(balance.statusCode, 403);
  const ledger = await server.inject({ method: "GET", url: "/api/v1/users/someone-else/ledger" });
  assert.equal(ledger.statusCode, 403);
  await server.close();
});

test("anti-pay-to-win: Coins and XP never influence the Quality Score", async () => {
  const server = buildServer();

  // Earn rewards on a first run so the account holds XP and Mastery.
  const richRunId = await startAndSealRun(server, "econ-rich");
  await server.inject({ method: "GET", url: `/api/v1/scenario-runs/${richRunId}/reveal` });
  const grant = await server.inject({ method: "POST", url: `/api/v1/scenario-runs/${richRunId}/rewards` });
  assert.equal(grant.statusCode, 200);
  const fundedBalance = grant.json<{ data: { balance: { xp: number; coins: number } } }>().data.balance;
  assert.ok(fundedBalance.xp > 0);
  assert.equal(fundedBalance.coins, 0, "completion never funds Coins");

  // A second, identical decision on a fresh run must score exactly the same as
  // the first — the now-funded balance changes nothing about the outcome.
  const secondRunId = await startAndSealRun(server, "econ-same-decision");
  const reveal = await server.inject({ method: "GET", url: `/api/v1/scenario-runs/${secondRunId}/reveal` });
  const score = reveal.json<{ data: { run: { score: { score: number } } } }>().data.run.score;
  assert.equal(score.score, 87, "score is independent of Coins/XP held");

  // The reward wire shape carries no score, ranking, or risk field.
  const balance = await server.inject({ method: "GET", url: `/api/v1/users/${USER_ID}/balance` });
  const body = balance.json<{ data: Record<string, unknown> }>().data;
  for (const forbidden of ["score", "rank", "risk", "riskOverride", "outcome"]) {
    assert.equal(forbidden in body, false, `balance must never expose ${forbidden}`);
  }

  await server.close();
});
