import assert from "node:assert/strict";
import test from "node:test";

import {
  DecisionEventTypeSchema,
  TelemetryEventInputSchema,
  TelemetryIngestRequestSchema
} from "./telemetry.js";

const BASE_EVENT = {
  eventId: "evt-0001",
  eventType: "decision_sealed" as const,
  eventVersion: 1,
  sessionId: "sess-0001",
  sequence: 12,
  occurredAt: "2026-09-26T10:00:00.000Z",
  clientElapsedMs: 4200,
  runId: "run-0001",
  scenarioId: "invalidation-challenge-a-001",
  scenarioVersion: "1.0.0",
  payload: { action: "wait_for_confirmation" }
};

test("a well-formed telemetry event parses", () => {
  const parsed = TelemetryEventInputSchema.parse(BASE_EVENT);
  assert.equal(parsed.eventType, "decision_sealed");
  assert.equal(parsed.sequence, 12);
});

test("event types outside the allowlist are rejected", () => {
  assert.throws(() =>
    TelemetryEventInputSchema.parse({ ...BASE_EVENT, eventType: "harvest_secrets" })
  );
  assert.deepEqual(DecisionEventTypeSchema.options.includes("reward_claimed"), true);
});

test("a client can never assert a userId onto an event", () => {
  assert.throws(() => TelemetryEventInputSchema.parse({ ...BASE_EVENT, userId: "someone-else" }));
});

test("payloads carrying server-only or hidden data are rejected", () => {
  assert.throws(() =>
    TelemetryEventInputSchema.parse({ ...BASE_EVENT, payload: { hiddenEntities: ["wick_mimic"] } })
  );
  assert.throws(() =>
    TelemetryEventInputSchema.parse({ ...BASE_EVENT, payload: { score: 99 } })
  );
});

test("oversized payloads are rejected", () => {
  const wide: Record<string, number> = {};
  for (let i = 0; i < 9; i += 1) wide[`k${i}`] = i;
  assert.throws(() => TelemetryEventInputSchema.parse({ ...BASE_EVENT, payload: wide }));
});

test("ingest accepts a bounded batch with unique ids", () => {
  const request = TelemetryIngestRequestSchema.parse({
    events: [
      BASE_EVENT,
      { ...BASE_EVENT, eventId: "evt-0002", eventType: "outcome_revealed", sequence: 13 }
    ]
  });
  assert.equal(request.events.length, 2);
});

test("ingest rejects an empty batch and duplicate event ids", () => {
  assert.throws(() => TelemetryIngestRequestSchema.parse({ events: [] }));
  assert.throws(() =>
    TelemetryIngestRequestSchema.parse({ events: [BASE_EVENT, BASE_EVENT] })
  );
});

test("ingest rejects an oversized batch", () => {
  const events = Array.from({ length: 51 }, (_, i) => ({
    ...BASE_EVENT,
    eventId: `evt-${i}`,
    sequence: i
  }));
  assert.throws(() => TelemetryIngestRequestSchema.parse({ events }));
});
