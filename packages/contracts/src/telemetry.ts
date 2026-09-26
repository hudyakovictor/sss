import { z } from "zod";

// Decision Telemetry v1 — Iteration 04 Phase 3.
//
// Purpose: an append-only, server-received event stream that lets one run be
// reconstructed as an ordered timeline. This is the raw material for the future
// Premium AI analysis, but it is *strictly observational*: a telemetry event can
// never change a Quality Score, an economy state, or scenario truth. That is why
// the ingest contract carries no score, no reward, and no hidden/future fields.
//
// Trust model (spec §3.4): client timestamps are advisory, not authoritative.
// The server stamps `receivedAt` on receipt and keeps the client-supplied clock,
// elapsed ms, and per-run sequence alongside it so downstream diagnostics can
// prefer the verifiable ordering and drop background-tab / long-pause artefacts.

const IsoDate = z.string().datetime({ offset: true });
const StableId = z.string().min(1).max(120);

// The closed allowlist. Anything outside this enum is rejected at the wire, so a
// client cannot invent event types.
export const DecisionEventTypeSchema = z.enum([
  "academy_module_opened",
  "lesson_started",
  "lesson_completed",
  "challenge_requested",
  "challenge_started",
  "challenge_completed",
  "scenario_started",
  "source_group_opened",
  "source_opened",
  "evidence_selected",
  "evidence_removed",
  "action_selected",
  "action_changed",
  "invalidation_started",
  "invalidation_changed",
  "confidence_changed",
  "decision_seal_requested",
  "decision_sealed",
  "outcome_revealed",
  "debrief_opened",
  "reward_claimed"
]);

// Payloads are small bags of primitives. We cap key count, key length, and value
// size so telemetry stays cheap to store and cannot smuggle large or nested data.
const TelemetryPayloadValue = z.union([
  z.string().max(200),
  z.number().safe(),
  z.boolean()
]);

// Keys that would let a client exfiltrate or assert server-only truth into the
// timeline. Rejected outright (spec: "невозможность передать hidden/future data").
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "hiddenentities",
  "future",
  "futuredata",
  "futurehash",
  "historicalfuturesegment",
  "historicaloutcome",
  "outcome",
  "reveal",
  "score",
  "qualityscore",
  "reward",
  "solution",
  "answer"
]);

export const TelemetryPayloadSchema = z
  .record(z.string().min(1).max(40), TelemetryPayloadValue)
  .refine((payload) => Object.keys(payload).length <= 8, {
    message: "Telemetry payload may carry at most 8 fields"
  })
  .refine(
    (payload) =>
      Object.keys(payload).every((key) => !FORBIDDEN_PAYLOAD_KEYS.has(key.toLowerCase())),
    { message: "Telemetry payload must not carry server-only or hidden data" }
  );

// One event as submitted by the client. Note there is intentionally no `userId`:
// ingest is self-scoped and the server fills the actor from the session, so a
// client can never attribute events to somebody else.
export const TelemetryEventInputSchema = z
  .object({
    eventId: StableId,
    eventType: DecisionEventTypeSchema,
    eventVersion: z.number().int().min(1).max(100),
    sessionId: StableId,
    sequence: z.number().int().min(0).max(1_000_000),
    occurredAt: IsoDate,
    clientElapsedMs: z.number().int().min(0).max(86_400_000),
    runId: StableId.optional(),
    scenarioId: StableId.optional(),
    scenarioVersion: StableId.optional(),
    moduleId: StableId.optional(),
    skillIds: z.array(StableId).max(10).optional(),
    payload: TelemetryPayloadSchema
  })
  .strict();

export const TelemetryIngestRequestSchema = z
  .object({
    events: z.array(TelemetryEventInputSchema).min(1).max(50)
  })
  .strict()
  .superRefine((request, ctx) => {
    const ids = new Set<string>();
    for (const event of request.events) {
      if (ids.has(event.eventId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events"],
          message: `Duplicate eventId in batch: ${event.eventId}`
        });
        return;
      }
      ids.add(event.eventId);
    }
  });

export type DecisionEventType = z.infer<typeof DecisionEventTypeSchema>;
export type TelemetryPayload = z.infer<typeof TelemetryPayloadSchema>;
export type TelemetryEventInput = z.infer<typeof TelemetryEventInputSchema>;
export type TelemetryIngestRequest = z.infer<typeof TelemetryIngestRequestSchema>;
