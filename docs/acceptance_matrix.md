# SIGNAL ARENA — Acceptance Matrix

Status: REQUIRED
Scope: product and release acceptance gates
Owner: Signal Arena project owner
Last reviewed: 2026-09-26
Supersedes: none
Required evidence: valid gate/evidence records for the relevant commit, environment, contract version and fixture version
Canonical dependencies: `developing_status.md`, `roadmap_and_release_control_plane.md`, `security_architecture.md`, `deployment_and_environments.md`

| Area | Minimum acceptance |
|---|---|
| Contracts | Zod schemas shared by client, API and CRM; contract tests pass |
| Auth | Telegram identity verified server-side; replay rejected; session revocation works |
| Scenarios | Hidden future server-only; content/rubric/data versions fixed |
| Scoring | Golden fixtures pass; process score independent of lucky outcome |
| Learning loop | Theory → worked example → guided practice → verification is server-driven; opening a Challenge never closes a topic; reading theory never grants mastery |
| Skill verification | A `verified` status is written only by a server re-score of a sealed decision against named critical gates; a failed check never downgrades a confirmed skill |
| Arena Transfer | Transfer is gated on `verified` and yields provisional mastery (`review_due`) only; `mastered` requires a later delayed rematch, never a single test |
| Decision telemetry | Append-only, per-user idempotent, self-scoped timeline; closed event allowlist rejects hidden/future/score data; ingest never changes economy or progression |
| Personal insight | Deterministic (no AI/LLM claim); never concludes from fewer than two independent observations; every insight is explainable by referenced run ids and feature values |
| Database | Migration applies; indexes and uniqueness constraints exist; restore tested |
| Payments | Duplicate webhook creates one entitlement; order state is auditable |
| Refunds | Refund/revoke behavior defined and tested |
| Shop | Catalog, preview, order, entitlement, inventory and equip work through API |
| Founder Packs | Supply reservation atomic; no token/income promise; purchase is non-competitive |
| Public profiles | Opt-in; private fields excluded; cosmetics render with fallback |
| Tournaments | Scenario/rubric version locked; duplicate entries and rewards prevented |
| CRM | RBAC server-side; dangerous actions confirmed and audited |
| Localization | Missing key fallback; versions; length and locale validation |
| AI | Jobs versioned, schema-validated and approval-controlled |
| Observability | Request ID, structured errors, audit events and alerts exist |
| Recovery | Backup and restore drill passed; rollback path documented |
| Client | Loading/error/empty/reduced-motion states; no authoritative logic in client; browser visual/responsive/accessibility evidence |
| Scenario pipeline | provider adapter, point-in-time snapshot, scheduling, ScenarioPackage ingestion/publication, immutable hash and recorded replay evidence |
| Release | typecheck, lint, tests, smoke, secret scan and build pass; evidence and explicit status exist |
| Commercial Alpha | Telegram production auth, PostgreSQL, migrations, backup/restore drill, future-leak tests, deterministic scoring replay, CSP, CORS, timeouts, shared Redis-compatible rate limiting, request IDs, structured logs, alerts, rollback, audited Admin operations, spend limits, asset provenance and payment reconciliation |
