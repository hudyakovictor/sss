import assert from "node:assert/strict";
import test from "node:test";

import {
  appendDecisionEvents,
  closeDatabase,
  createDatabase,
  listDecisionEventsByRun,
  type AppendDecisionEventInput,
  type DecisionEventRecord
} from "./index.js";

function event(overrides: Partial<DecisionEventRecord>): AppendDecisionEventInput {
  return {
    eventId: "evt-1",
    userId: "user-tel",
    sessionId: "sess-1",
    eventType: "action_selected",
    eventVersion: 1,
    sequence: 0,
    occurredAt: "2026-09-26T10:00:00.000Z",
    serverReceivedAt: "2026-09-26T10:00:01.000Z",
    clientElapsedMs: 1200,
    runId: "run-tel",
    scenarioId: "invalidation-challenge-a-001",
    scenarioVersion: "1.0.0",
    moduleId: null,
    skillIds: [],
    payload: {},
    ...overrides
  };
}

function ensureUser(handle: ReturnType<typeof createDatabase>, userId: string): void {
  handle.sqlite.prepare(`
    INSERT INTO users (user_id, external_id, created_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId, `test:${userId}`, new Date().toISOString());
}

test("decision events are append-only, ordered, and idempotent by eventId", () => {
  const handle = createDatabase();
  ensureUser(handle, "user-tel");

  const first = appendDecisionEvents(handle, [
    event({ eventId: "evt-3", sequence: 3, eventType: "decision_sealed" }),
    event({ eventId: "evt-1", sequence: 1, eventType: "action_selected" }),
    event({ eventId: "evt-2", sequence: 2, eventType: "invalidation_changed" })
  ]);
  assert.equal(first.accepted, 3);
  assert.equal(first.duplicates, 0);

  // Replaying a batch (one new, two already stored) must not create duplicates.
  const replay = appendDecisionEvents(handle, [
    event({ eventId: "evt-1", sequence: 1 }),
    event({ eventId: "evt-2", sequence: 2 }),
    event({ eventId: "evt-4", sequence: 4, eventType: "outcome_revealed" })
  ]);
  assert.equal(replay.accepted, 1);
  assert.equal(replay.duplicates, 2);

  const timeline = listDecisionEventsByRun(handle, "user-tel", "run-tel");
  assert.deepEqual(timeline.map((row) => row.sequence), [1, 2, 3, 4]);
  assert.deepEqual(timeline.map((row) => row.eventId), ["evt-1", "evt-2", "evt-3", "evt-4"]);
  assert.equal(timeline[2]?.eventType, "decision_sealed");

  closeDatabase(handle);
});

test("decision events round-trip skill ids and payload", () => {
  const handle = createDatabase();
  ensureUser(handle, "user-tel");

  appendDecisionEvents(handle, [
    event({
      eventId: "evt-p",
      skillIds: ["invalidation-before-direction"],
      payload: { action: "wait_for_confirmation", confidence: 62 }
    })
  ]);

  const timeline = listDecisionEventsByRun(handle, "user-tel", "run-tel");
  assert.equal(timeline.length, 1);
  assert.deepEqual(timeline[0]?.skillIds, ["invalidation-before-direction"]);
  assert.deepEqual(timeline[0]?.payload, { action: "wait_for_confirmation", confidence: 62 });

  closeDatabase(handle);
});

test("a run's timeline is scoped to its owner", () => {
  const handle = createDatabase();
  ensureUser(handle, "user-tel");
  ensureUser(handle, "user-other");

  appendDecisionEvents(handle, [event({ eventId: "evt-mine" })]);
  const other = listDecisionEventsByRun(handle, "user-other", "run-tel");
  assert.equal(other.length, 0);

  closeDatabase(handle);
});
