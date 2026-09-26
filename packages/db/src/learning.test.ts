import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { invalidationModule } from "../../content/src/academy/invalidation-before-direction.js";
import { starterScenario } from "../../content/src/fixtures/starter-scenario.js";
import {
  closeDatabase,
  createDatabase,
  createLearningAttempt,
  createScenarioRun,
  finalizeLearningAttempt,
  getLearningAttempt,
  getLearningModule,
  getModuleProgress,
  seedFoundation,
  upsertLearningModule,
  upsertModuleProgress,
  type DatabaseHandle,
  type UpsertModuleProgressInput
} from "./index.js";

function ensureUser(handle: DatabaseHandle, userId: string): void {
  handle.sqlite.prepare(`
    INSERT INTO users (user_id, external_id, created_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId, `test:${userId}`, new Date().toISOString());
}

function progressInput(
  overrides: Partial<UpsertModuleProgressInput> = {}
): UpsertModuleProgressInput {
  return {
    userId: "user-progress",
    moduleId: invalidationModule.moduleId,
    moduleVersion: invalidationModule.version,
    status: "available",
    startedAt: null,
    verifiedAt: null,
    masteredAt: null,
    reviewDueAt: null,
    verificationSource: null,
    bestScore: 0,
    ...overrides
  };
}

test("learning modules upsert by (moduleId, version) and round-trip content", () => {
  const handle = createDatabase();

  const created = upsertLearningModule(handle, {
    moduleId: invalidationModule.moduleId,
    version: invalidationModule.version,
    title: invalidationModule.title,
    level: invalidationModule.level,
    content: invalidationModule,
    status: "published"
  });
  assert.equal(created.status, "published");
  assert.equal(created.content.moduleId, invalidationModule.moduleId);

  const republished = upsertLearningModule(handle, {
    moduleId: invalidationModule.moduleId,
    version: invalidationModule.version,
    title: "Инвалидация до направления (обновлено)",
    level: invalidationModule.level,
    content: invalidationModule,
    status: "validated"
  });
  assert.equal(republished.title, "Инвалидация до направления (обновлено)");
  assert.equal(republished.status, "validated");
  assert.equal(
    getLearningModule(handle, invalidationModule.moduleId, invalidationModule.version)?.status,
    "validated"
  );

  closeDatabase(handle);
});

test("learning attempts start open and finalize idempotently", () => {
  const handle = createDatabase();
  seedFoundation({ ...handle, scenario: starterScenario });
  upsertLearningModule(handle, {
    moduleId: invalidationModule.moduleId,
    version: invalidationModule.version,
    title: invalidationModule.title,
    level: invalidationModule.level,
    content: invalidationModule,
    status: "published"
  });
  const run = createScenarioRun(handle, {
    runId: randomUUID(),
    userId: "seed-user-001",
    scenarioId: starterScenario.scenarioId,
    scenarioVersion: starterScenario.version,
    idempotencyKey: randomUUID()
  });

  const attemptId = randomUUID();
  const attempt = createLearningAttempt(handle, {
    attemptId,
    userId: "seed-user-001",
    moduleId: invalidationModule.moduleId,
    moduleVersion: invalidationModule.version,
    attemptType: "challenge",
    scenarioId: starterScenario.scenarioId,
    scenarioVersion: starterScenario.version,
    runId: run.runId
  });
  assert.equal(attempt.status, "started");
  assert.equal(attempt.runId, run.runId);
  assert.equal(attempt.completedAt, null);

  const finalized = finalizeLearningAttempt(handle, {
    attemptId,
    userId: "seed-user-001",
    status: "verified",
    result: { verified: true, qualityScore: 88 }
  });
  assert.equal(finalized.status, "verified");
  assert.notEqual(finalized.completedAt, null);
  assert.deepEqual(finalized.result, { verified: true, qualityScore: 88 });

  // A second finalize must not reopen or mutate an already-closed attempt.
  const replay = finalizeLearningAttempt(handle, {
    attemptId,
    userId: "seed-user-001",
    status: "failed",
    result: { verified: false, qualityScore: 10 }
  });
  assert.equal(replay.status, "verified");
  assert.deepEqual(replay.result, { verified: true, qualityScore: 88 });

  assert.equal(getLearningAttempt(handle, attemptId, "someone-else"), undefined);

  closeDatabase(handle);
});

test("module progress keeps the best score and never clears earlier timestamps", () => {
  const handle = createDatabase();
  ensureUser(handle, "user-progress");
  assert.equal(
    getModuleProgress(handle, "user-progress", invalidationModule.moduleId, invalidationModule.version),
    undefined
  );

  const first = upsertModuleProgress(handle, progressInput({
    status: "learning",
    startedAt: "2026-09-01T00:00:00.000Z",
    bestScore: 61
  }));
  assert.equal(first.status, "learning");
  assert.equal(first.bestScore, 61);
  assert.equal(first.version, 0);

  const laterStart = upsertModuleProgress(handle, progressInput({
    status: "ready_for_verification",
    startedAt: "2026-09-05T00:00:00.000Z",
    bestScore: 40
  }));
  // best_score is a MAX, started_at is COALESCE-preserved, version increments.
  assert.equal(laterStart.bestScore, 61);
  assert.equal(laterStart.startedAt, "2026-09-01T00:00:00.000Z");
  assert.equal(laterStart.status, "ready_for_verification");
  assert.equal(laterStart.version, 1);

  const verified = upsertModuleProgress(handle, progressInput({
    status: "verified",
    verificationSource: "challenge_out",
    verifiedAt: "2026-09-06T00:00:00.000Z",
    bestScore: 92
  }));
  assert.equal(verified.status, "verified");
  assert.equal(verified.verificationSource, "challenge_out");
  assert.equal(verified.bestScore, 92);
  assert.equal(verified.verifiedAt, "2026-09-06T00:00:00.000Z");
  assert.equal(verified.version, 2);

  closeDatabase(handle);
});
