import assert from "node:assert/strict";
import test from "node:test";

import { buildServer } from "../../apps/api-server/src/server.js";

const MODULE_ID = "invalidation_before_direction";
const CHALLENGE_SCENARIO = "invalidation-challenge-a-001";
const NOT_IN_CHALLENGE = "invalidation-transfer-001";
const TRANSFER_SCENARIO = "invalidation-transfer-001";

type ModuleView = {
  data: {
    status: string;
    bestScore: number;
    verifiedAt: string | null;
    module: { challengeScenarioIds: string[] };
  };
};

type ChallengeStart = {
  data: {
    attempt: { attemptId: string; status: string; runId: string | null };
    run: { runId: string; state: string };
  };
};

const PASSING_DECISION = {
  action: "wait_for_confirmation",
  evidenceSourceIds: ["source_ohlcv_beta", "source_volume_beta"],
  invalidation: "A four hour close back below the reclaimed level kills the long idea entirely.",
  confidence: 62
};

test("opening a Challenge Test never changes module progression", async () => {
  const server = buildServer();

  const before = await server.inject({ method: "GET", url: `/api/v1/academy/modules/${MODULE_ID}` });
  assert.equal(before.statusCode, 200);
  assert.equal(before.json<ModuleView>().data.status, "available");

  const badScenario = await server.inject({
    method: "POST",
    url: `/api/v1/academy/modules/${MODULE_ID}/challenge`,
    payload: { scenarioId: NOT_IN_CHALLENGE, idempotencyKey: "e2e-academy-bad" }
  });
  assert.equal(badScenario.statusCode, 400);
  assert.equal(badScenario.json<{ error: string }>().error, "scenario_not_in_challenge");

  const open = await server.inject({
    method: "POST",
    url: `/api/v1/academy/modules/${MODULE_ID}/challenge`,
    payload: { scenarioId: CHALLENGE_SCENARIO, idempotencyKey: "e2e-academy-open" }
  });
  assert.equal(open.statusCode, 201);
  assert.equal(open.json<ChallengeStart>().data.run.state, "started");

  // The button press only opened a run; the topic is still "available".
  const after = await server.inject({ method: "GET", url: `/api/v1/academy/modules/${MODULE_ID}` });
  assert.equal(after.json<ModuleView>().data.status, "available");

  // Verifying an unsealed run is refused.
  const early = await server.inject({
    method: "POST",
    url: `/api/v1/academy/attempts/${open.json<ChallengeStart>().data.attempt.attemptId}/verify`
  });
  assert.equal(early.statusCode, 409);
  assert.equal(early.json<{ error: string }>().error, "scenario_run_not_sealed");

  await server.close();
});

test("a server-verified Challenge Test is the only thing that confirms the topic", async () => {
  const server = buildServer();

  const open = await server.inject({
    method: "POST",
    url: `/api/v1/academy/modules/${MODULE_ID}/challenge`,
    payload: { scenarioId: CHALLENGE_SCENARIO, idempotencyKey: "e2e-academy-pass" }
  });
  const { attempt, run } = open.json<ChallengeStart>().data;

  const seal = await server.inject({
    method: "POST",
    url: `/api/v1/scenario-runs/${run.runId}/seal`,
    payload: PASSING_DECISION
  });
  assert.equal(seal.statusCode, 200);

  const verify = await server.inject({
    method: "POST",
    url: `/api/v1/academy/attempts/${attempt.attemptId}/verify`
  });
  assert.equal(verify.statusCode, 200);
  const verdict = verify.json<{
    data: { verification: { verified: boolean; status: string }; progress: { bestScore: number } };
  }>().data;
  assert.equal(verdict.verification.verified, true);
  assert.equal(verdict.verification.status, "verified");

  const module = await server.inject({ method: "GET", url: `/api/v1/academy/modules/${MODULE_ID}` });
  assert.equal(module.json<ModuleView>().data.status, "verified");
  assert.notEqual(module.json<ModuleView>().data.verifiedAt, null);

  // Re-verifying the same attempt is idempotent and returns the stored verdict.
  const replay = await server.inject({
    method: "POST",
    url: `/api/v1/academy/attempts/${attempt.attemptId}/verify`
  });
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json<{ data: { verification: unknown } }>().data.verification, verdict.verification);

  await server.close();
});

test("a failed Challenge Test returns the learner to learning with no penalty", async () => {
  const server = buildServer();

  const open = await server.inject({
    method: "POST",
    url: `/api/v1/academy/modules/${MODULE_ID}/challenge`,
    payload: { scenarioId: CHALLENGE_SCENARIO, idempotencyKey: "e2e-academy-fail" }
  });
  const { attempt, run } = open.json<ChallengeStart>().data;

  const seal = await server.inject({
    method: "POST",
    url: `/api/v1/scenario-runs/${run.runId}/seal`,
    payload: {
      action: "long",
      // Only one evidence source: fails the mandatory evidence_sufficient gate.
      evidenceSourceIds: ["source_ohlcv_beta"],
      invalidation: "Close below the level.",
      confidence: 55
    }
  });
  assert.equal(seal.statusCode, 200);

  const verify = await server.inject({
    method: "POST",
    url: `/api/v1/academy/attempts/${attempt.attemptId}/verify`
  });
  assert.equal(verify.statusCode, 200);
  const verdict = verify.json<{ data: { verification: { verified: boolean; status: string } } }>().data;
  assert.equal(verdict.verification.verified, false);
  assert.equal(verdict.verification.status, "learning");

  const module = await server.inject({ method: "GET", url: `/api/v1/academy/modules/${MODULE_ID}` });
  assert.equal(module.json<ModuleView>().data.status, "learning");
  assert.equal(module.json<ModuleView>().data.verifiedAt, null);

  await server.close();
});

test("the Academy module read serves server-authored lesson content and challenge frontmatter", async () => {
  const server = buildServer();

  const res = await server.inject({ method: "GET", url: `/api/v1/academy/modules/${MODULE_ID}` });
  assert.equal(res.statusCode, 200);
  const view = res.json<{
    data: {
      lessons: Array<{ lessonId: string; contentBlocks: Array<{ blockType: string }> }>;
      challenge: { challengeDefinitionId: string; scenarioIds: string[]; passCriteria: { minQualityScore: number } } | null;
    };
  }>().data;

  // The client renders this verbatim; it is published curriculum, never hidden
  // or future scenario truth, and it carries no user-computed metrics.
  assert.equal(view.lessons.length, 1);
  assert.ok(view.lessons[0]!.contentBlocks.some((block) => block.blockType === "worked_example"));
  assert.ok(view.challenge);
  assert.equal(view.challenge!.scenarioIds[0], CHALLENGE_SCENARIO);
  assert.equal(view.challenge!.passCriteria.minQualityScore, 70);

  await server.close();
});

test("Arena Transfer is gated on a prior server-verified challenge", async () => {
  const server = buildServer();

  const premature = await server.inject({
    method: "POST",
    url: `/api/v1/academy/modules/${MODULE_ID}/transfer`,
    payload: { scenarioId: TRANSFER_SCENARIO, idempotencyKey: "e2e-transfer-early" }
  });
  assert.equal(premature.statusCode, 409);
  assert.equal(premature.json<{ error: string }>().error, "transfer_not_available");

  await server.close();
});

test("passing a Challenge then an Arena Transfer yields provisional mastery, never Mastery", async () => {
  const server = buildServer();

  // 1) Verify the topic through a Challenge Test.
  const open = await server.inject({
    method: "POST",
    url: `/api/v1/academy/modules/${MODULE_ID}/challenge`,
    payload: { scenarioId: CHALLENGE_SCENARIO, idempotencyKey: "e2e-transfer-prep" }
  });
  const challenge = open.json<ChallengeStart>().data;
  await server.inject({
    method: "POST",
    url: `/api/v1/scenario-runs/${challenge.run.runId}/seal`,
    payload: PASSING_DECISION
  });
  const challengeVerify = await server.inject({
    method: "POST",
    url: `/api/v1/academy/attempts/${challenge.attempt.attemptId}/verify`
  });
  assert.equal(challengeVerify.json<{ data: { verification: { status: string } } }>().data.verification.status, "verified");

  // 2) Open the Arena Transfer: verified → transfer_pending.
  const transfer = await server.inject({
    method: "POST",
    url: `/api/v1/academy/modules/${MODULE_ID}/transfer`,
    payload: { scenarioId: TRANSFER_SCENARIO, idempotencyKey: "e2e-transfer-open" }
  });
  assert.equal(transfer.statusCode, 201);
  const t = transfer.json<{
    data: { attempt: { attemptId: string; attemptType: string }; run: { runId: string }; progress: { status: string } };
  }>().data;
  assert.equal(t.attempt.attemptType, "transfer");
  assert.equal(t.progress.status, "transfer_pending");

  // 3) Seal + verify the transfer attempt. Passing yields review_due (provisional),
  //    not mastered — one familiar test never grants Mastery.
  await server.inject({
    method: "POST",
    url: `/api/v1/scenario-runs/${t.run.runId}/seal`,
    payload: {
      action: "wait_for_confirmation",
      evidenceSourceIds: ["source_ohlcv_delta", "source_volume_delta"],
      invalidation: "A one hour close back below the reclaimed level voids the long idea entirely.",
      confidence: 60
    }
  });
  const transferVerify = await server.inject({
    method: "POST",
    url: `/api/v1/academy/attempts/${t.attempt.attemptId}/verify`
  });
  assert.equal(transferVerify.statusCode, 200);
  const verdict = transferVerify.json<{
    data: { verification: { verified: boolean; status: string } };
  }>().data.verification;
  assert.equal(verdict.verified, true);
  assert.equal(verdict.status, "review_due");
  assert.notEqual(verdict.status, "mastered");

  const module = await server.inject({ method: "GET", url: `/api/v1/academy/modules/${MODULE_ID}` });
  assert.equal(module.json<ModuleView>().data.status, "review_due");

  await server.close();
});
