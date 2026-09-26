import assert from "node:assert/strict";
import test from "node:test";

import { buildServer } from "../../apps/api-server/src/server.js";

const RUN_ID = "run-e2e-telemetry";

type IngestResult = { data: { accepted: number; duplicates: number } };
type TimelineResult = {
  data: { runId: string; events: Array<{ sequence: number; eventType: string; payload: unknown }> };
};

function baseEvent(over: Record<string, unknown>) {
  return {
    eventId: "tel-1",
    eventType: "action_selected",
    eventVersion: 1,
    sessionId: "sess-e2e",
    sequence: 1,
    occurredAt: "2026-09-26T10:00:00.000Z",
    clientElapsedMs: 500,
    runId: RUN_ID,
    payload: {},
    ...over
  };
}

test("telemetry ingest stores an ordered, self-scoped timeline and dedups replays", async () => {
  const server = buildServer();

  const first = await server.inject({
    method: "POST",
    url: "/api/v1/telemetry/events",
    payload: {
      events: [
        baseEvent({ eventId: "tel-3", sequence: 3, eventType: "decision_sealed" }),
        baseEvent({ eventId: "tel-1", sequence: 1 }),
        baseEvent({ eventId: "tel-2", sequence: 2, eventType: "invalidation_changed" })
      ]
    }
  });
  assert.equal(first.statusCode, 202);
  assert.deepEqual(first.json<IngestResult>().data, { accepted: 3, duplicates: 0 });

  const timeline = await server.inject({
    method: "GET",
    url: `/api/v1/telemetry/runs/${RUN_ID}/timeline`
  });
  assert.equal(timeline.statusCode, 200);
  assert.deepEqual(
    timeline.json<TimelineResult>().data.events.map((event) => event.sequence),
    [1, 2, 3]
  );

  // Replaying the batch (two known + one new) must add exactly one row.
  const replay = await server.inject({
    method: "POST",
    url: "/api/v1/telemetry/events",
    payload: {
      events: [
        baseEvent({ eventId: "tel-2", sequence: 2 }),
        baseEvent({ eventId: "tel-3", sequence: 3 }),
        baseEvent({ eventId: "tel-4", sequence: 4, eventType: "outcome_revealed" })
      ]
    }
  });
  assert.equal(replay.statusCode, 202);
  assert.deepEqual(replay.json<IngestResult>().data, { accepted: 1, duplicates: 2 });

  const after = await server.inject({
    method: "GET",
    url: `/api/v1/telemetry/runs/${RUN_ID}/timeline`
  });
  assert.equal(after.json<TimelineResult>().data.events.length, 4);

  await server.close();
});

test("telemetry ingest rejects forged attribution, unknown types, and hidden data", async () => {
  const server = buildServer();

  const forgedUser = await server.inject({
    method: "POST",
    url: "/api/v1/telemetry/events",
    payload: { events: [baseEvent({ userId: "attacker" })] }
  });
  assert.equal(forgedUser.statusCode, 400);

  const unknownType = await server.inject({
    method: "POST",
    url: "/api/v1/telemetry/events",
    payload: { events: [baseEvent({ eventId: "tel-x", eventType: "reveal_answer" })] }
  });
  assert.equal(unknownType.statusCode, 400);

  const hiddenPayload = await server.inject({
    method: "POST",
    url: "/api/v1/telemetry/events",
    payload: { events: [baseEvent({ eventId: "tel-h", payload: { hiddenEntities: ["wick_mimic"] } })] }
  });
  assert.equal(hiddenPayload.statusCode, 400);

  const emptyBatch = await server.inject({
    method: "POST",
    url: "/api/v1/telemetry/events",
    payload: { events: [] }
  });
  assert.equal(emptyBatch.statusCode, 400);

  await server.close();
});

test("telemetry is observational: ingest never changes economy or progression", async () => {
  const server = buildServer();

  const balanceBefore = await server.inject({
    method: "GET",
    url: "/api/v1/users/seed-user-001/balance"
  });
  assert.equal(balanceBefore.statusCode, 200);

  await server.inject({
    method: "POST",
    url: "/api/v1/telemetry/events",
    payload: {
      events: [
        baseEvent({ eventId: "tel-e1", sequence: 1, eventType: "reward_claimed" }),
        baseEvent({ eventId: "tel-e2", sequence: 2, eventType: "outcome_revealed" })
      ]
    }
  });

  const balanceAfter = await server.inject({
    method: "GET",
    url: "/api/v1/users/seed-user-001/balance"
  });
  assert.equal(balanceAfter.statusCode, 200);
  assert.deepEqual(balanceAfter.json(), balanceBefore.json());

  const module = await server.inject({
    method: "GET",
    url: "/api/v1/academy/modules/invalidation_before_direction"
  });
  assert.equal(module.json<{ data: { status: string } }>().data.status, "available");

  await server.close();
});
