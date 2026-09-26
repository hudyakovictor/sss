# Signal Arena Development Status

Status: ACCEPTED_LOCAL
Scope: current implementation status and evidence snapshot
Owner: Signal Arena project owner
Last reviewed: 2026-09-26
Supersedes: previous status snapshot dated 2026-09-16
Required evidence: gate/evidence records for every accepted local or production claim
Canonical dependencies: `roadmap_and_release_control_plane.md`, `acceptance_matrix.md`, `system_architecture.md`

Status date: 2026-09-26

## Status vocabulary

```text
REQUIRED
PLANNED
IMPLEMENTED_LOCAL
ACCEPTED_LOCAL
PRODUCTION_READY
BLOCKED
DEPRECATED
```

`developing_status.md` and gate/evidence records are the only sources of actual implementation status. Target architecture and product specifications do not imply implementation.

## Evidence record minimum

Every accepted claim must reference:

```text
gate_id
evidence_id
commit_sha
environment
verified_at
blocker_id
notes
```

## Current status

The repository contains the product specification, curriculum, economy rules, motion system, asset provenance workflow, security/deployment/scaling/observability contracts, Vercel alpha and provider migration strategy, AI agent operations architecture, internal roadmap/release-control specification, agent contract, iteration gates, an executable SQLite foundation with ScenarioPackage import, DB-backed public projection, sealed scenario-run lifecycle, a Telegram authentication/session boundary, API security hardening for the local boundary, a `PersistencePort` consumed by the API with SQLite and PostgreSQL adapters, forward-only PostgreSQL migrations with an explicit migration command, a server-authoritative foundation scoring service, a bounded Binance provider adapter boundary, and idempotent normalized snapshot persistence.

The client surface has transitioned from the removed Phaser prototype (`apps/client-prototype`) to a React + Vite Design System Lab (`apps/design-system-lab`) that consumes `packages/ui-game`. Iteration 02 added a branded preloader intro, restored the `validate:assets` and `validate:public-client` gates, and stood up the Coins ledger foundation. Iteration 03 replaced that ledger with Economy Ledger v2 (asset × kind matrix, no completion Coins), built the correct progression runtime (XP repeat/cap, per-scenario Mastery best, lazy Energy regen, atomic server-derived start), shipped the first real API-wired playable vertical slice, and added Playwright browser evidence. Iteration 04 turned that technical slice into the first *learning* vertical slice for one Academy module: a server-authoritative Challenge-Test verification policy and progression state machine, an Arena Transfer path to provisional mastery, an append-only Decision Telemetry stream, a deterministic Personal Insight v0, the first real Academy UI, and a new `validate:learning` gate.

The project is **not yet accepted as a complete executable implementation**. Foundation claims below are `ACCEPTED_LOCAL`, not `PRODUCTION_READY`. Production controls remain planned until implemented and evidenced.

## Acceptance status

```text
Documentation-only: no longer true
Executable foundation: PASS
First real vertical slice (local, API-wired, Playwright-evidenced): ACCEPTED_LOCAL
First real learning vertical slice (Academy Level 0, local, Playwright-evidenced): ACCEPTED_LOCAL
Production vertical slice: NOT YET ACCEPTED
Overall product: BLOCKED
```

## Iteration 04 learning gates

The first *learning* loop — `Level 0 → микроурок → worked example → guided practice → «Я это знаю — проверить» (Challenge Test) → подтверждение навыка → Arena Transfer → Decision Telemetry → Personal Insight v0` — is proven on the single module `invalidation_before_direction`. These statuses are deliberately scoped to that one module; the rest of the curriculum is not implied.

```text
Academy Level 0 vertical slice      ACCEPTED_LOCAL
Challenge-out verification          ACCEPTED_LOCAL
Arena Transfer (provisional)        ACCEPTED_LOCAL
Decision Telemetry v1               ACCEPTED_LOCAL
Personal Insight v0                 ACCEPTED_LOCAL   (deterministic; NOT an AI/LLM analysis)
Delayed Rematch scheduler           PLANNED          (mastery stops at review_due, never auto-mastered)
Full Academy curriculum (14 modules) PLANNED         (1 of 14 authored; validator + pipeline proven)
AI narrative layer                  PLANNED
Production learner analytics        BLOCKED          (needs observability + live PostgreSQL)
```


The foundation, database/migration/seed gate, ScenarioPackage importer/projection boundary, foundation scenario-run lifecycle, Telegram authentication boundary, local API hardening, SQLite persistence adapter, PostgreSQL pool/repository lifecycle, PostgreSQL migration runner, foundation scoring service, Binance adapter boundary, and normalized snapshot persistence are executable and locally evidenced. Design System Lab preloader is accepted locally. Coins ledger foundation is `ACCEPTED_LOCAL` at the domain and contract layer; the persistence migration and API wiring are `IMPLEMENTED_LOCAL` (see Phase D records below).

The product remains blocked until shared production rate limiting, ScenarioPackage ingestion/publication, production scoring governance, full economy runtime with store and referral flows, structured logging/alerting, browser visual/responsive/accessibility QA, visual/release asset approval, backup/restore rehearsal, and the production-complete vertical slice are implemented and evidenced. Logging, metrics, tracing, audit events, alerts, and incident response are specified in `observability_and_incident_response.md`; they are not shipped by the current foundation.

## Recent accepted

```text
2026-09-26 — Iteration 04: First real learning vertical slice (Academy Level 0, one module).
Scope: turn the technical slice into a *learning* loop for the single module
`invalidation_before_direction`, with server-authoritative verification, decision
telemetry and a deterministic Personal Insight v0. Guardrails held: reading theory is
never mastery; «Я это знаю — проверить» only OPENS a Challenge Test and never closes a
topic; the client computes no mastery/skill status/insight; Personal Insight is a
deterministic function (no AI/LLM claim); no Coins gate learning or the exam; content is
versioned fixtures, not generated.
Evidence:
  Phase 1 — Learning contracts (`packages/contracts/src/learning.ts`: AcademyModule,
    Lesson, ChallengeDefinition with passCriteria/criticalGates, LearningStatus,
    VerificationSource) + the first module content
    (`packages/content/src/academy/invalidation-before-direction.ts`) + a new
    `pnpm validate:learning` gate (module/lesson/challenge/skill coherence and canonical
    Entity-name integrity).
  Phase 2 — Verification policy + progression state machine
    (`packages/domain/src/learning.ts`: `evaluateChallengeVerification` gates
    invalidation_present / invalidation_before_action / evidence_sufficient /
    confidence_in_range / quality_threshold; `nextLearningStatus` is a conservative
    machine whose only path to `verified` is a server-verified challenge). Migration
    `0006` (module_progress + learning_attempts, both stores) with set-once
    started_at/verified_at/mastered_at semantics. Academy endpoints
    `POST /academy/modules/:id/challenge` (opens a run + attempt, progression untouched),
    `POST /academy/attempts/:id/verify` (re-scores a sealed server-owned decision; the only
    writer of `verified`), and the read-only self-scoped
    `GET /academy/modules/:id`. Client fallback removed. e2e proves opening ≠ passing,
    verify-only verifies, idempotent replay, and a failed challenge never downgrades.
  Phase 3 — Decision Telemetry v1 (`packages/contracts/src/telemetry.ts` closed event-type
    allowlist + forbidden-key rejection so no hidden/future/score data can be smuggled;
    append-only ingest `POST /telemetry/events` with per-user idempotent dedup and
    self-scoped `GET /telemetry/runs/:id/timeline`). Migration `0007` (both stores).
    Observational: ingest never touches economy or progression (asserted in e2e).
  Phase 4 — Diagnostic Engine + Personal Insight v0
    (`packages/domain/src/learning-diagnostics.ts`: `computeRunFeatures` derives
    time-to-first-action / time-to-invalidation / actionBeforeInvalidation from the ordered
    timeline; `derivePersonalInsight` returns null below two independent observations and is
    otherwise preliminary/repeated/confirmed/resolved with an explicit confidence and the
    exact evidenceRunIds — 10 unit tests prove "never conclude from one attempt" and "every
    insight is explainable by run ids + feature values").
  Phase 5/6 — First real Academy UI in `apps/design-system-lab/src/academy/` (Level 0 →
    lesson → guided practice → Challenge → verify → result, plus Arena Transfer), a fixed
    reusable `DecisionWorkspace` (run-first, single evidence step, required invalidation,
    localised), and a `HubNextBestAction` that maps the real server status to the next
    action. Arena Transfer requires `verified`, records a `transfer` attempt, and moves
    verified → transfer_pending → review_due (provisional mastery only); a single test never
    reaches `mastered`. e2e proves a Challenge → Transfer chain yields review_due, not
    mastery.
  Phase 7 — Playwright browser evidence (10 browser tests + 1 API gate): new-learner and
    experienced flows to verified + Arena Transfer, a critical-gate failure stays unverified
    with a corrective reason, the Decision Workspace gating (disabled seal until a real
    invalidation), reload restores both progression and an in-flight run, the Hub reflects
    server progression, decision-telemetry orderings (action→invalidation vs
    invalidation→action) reconstruct as distinguishable server timelines, four viewports
    with no horizontal overflow and no leftover overlay, keyboard operability, and
    `prefers-reduced-motion` with zero console errors. Screens land in `docs/qa/`. Tests are
    made deterministic by a fixture-only isolated-identity pool (`browser-e2e-NN`, honoured
    via a same-origin `sa_fixture_user` cookie) so no browser test leaks progression into
    another and a pristine in-memory API is started every run.
Known limitation (honest): the Academy Decision Workspace does not yet EMIT telemetry
events from the browser; the ingest storage, self-scoped timeline, ordering signal and
Personal Insight derivation are proven at the API e2e and domain unit layers, and the
browser suite proves the ordering is reconstructable end-to-end via the ingest endpoint.
Wiring client-side emission into the workspace is deferred so no client becomes
authoritative over diagnostics.
All local gates green: `pnpm test` 140 pass / 1 skip, `pnpm test:e2e` 24 pass,
`pnpm exec playwright test` 11 pass, `pnpm typecheck`/`pnpm lint`/`pnpm build`,
`pnpm design-system:typecheck`/`build`, and all `validate:*` (incl. `validate:learning`) PASS.
Status: ACCEPTED_LOCAL for the SQLite Academy learning loop (contract, domain, persistence,
API, first real UI, browser evidence). The live PostgreSQL learning path is
`IMPLEMENTED_LOCAL`/BLOCKED for CI evidence; the other 13 modules, the delayed-rematch
scheduler, the client telemetry emitter, and any AI/LLM narrative remain out of scope.

2026-10-04 — Iteration 03 Phase B: Economy Ledger v2 (asset × kind matrix). SUPERSEDES the Iteration 02 Phase D coin-grant.
DEPRECATED (superseded): the Iteration 02 Phase D per-run Coin grant modeled as a single
`coin_reward_xp` ledger kind with XP carried in a non-ledger `xp` field, and the
`RUN_COIN_REWARD_XP_DIVISOR` / `H-ECON-REWARD` per-run coin-rate hypothesis. Scenario
completion now mints NO Coins at all (canonical rule: `economy_monetization_referrals.md`
§2/§5.7), so `H-ECON-REWARD` is withdrawn rather than re-tuned. The `coin_reward_xp` kind,
the `RUN_COIN_REWARD_XP_DIVISOR` constant, `computeRunRewards`, and the `xp` field on the
append input are all removed.
Evidence: `packages/contracts/src/economy.ts` rewritten to Ledger v2 — an explicit
`KIND_ASSET` asset × kind matrix (`xp_awarded`/`mastery_awarded`/`energy_spent`/
`energy_regenerated`/`energy_refilled`/`coin_pack_credited`/`coin_promo_granted`/`coin_spent`),
new `asset`/`reason`/`sourceId`/`scenarioId`/`riskState` fields, `PromoReasonSchema`, and a
`superRefine` that rejects a mismatched asset/kind, wrong-sign amounts, and `promo = true` on
any non-`coin_promo_granted` kind (12 contract tests). Forward-only migration `0005_ledger_v2`
(SQLite + PostgreSQL) widens `ledger_events` and adds `reward_grants`, `scenario_completions`,
and `user_scenario_mastery`; dev economy rows are re-seeded (no production data). The reward
path is now ONE idempotent transaction `applyScenarioCompletionRewards` keyed by `runId`
(`run:{runId}:xp` + `run:{runId}:mastery` sharing a `reward_grants` anchor) that grants XP +
Mastery only. API `POST /api/v1/scenario-runs/:runId/rewards` returns
`{ granted, xpGranted, masteryDelta, balance }` and asserts no coin-asset event. 19 repository
tests in `packages/db/src/economy.test.ts` prove a completed run yields `coins == 0` and
`xp > 0`. All local gates green: `pnpm test` 85 pass / 1 skip, `pnpm test:e2e` 15 pass,
`pnpm typecheck`/`pnpm lint`/`pnpm build` and all `validate:*` PASS.
Status: ACCEPTED_LOCAL for the SQLite Ledger v2 path (contract, domain, persistence, API).
The PostgreSQL economy runtime is `IMPLEMENTED_LOCAL` (mirrored migration + adapters, exercised
only when `POSTGRES_TEST_URL` is set) and remains honestly BLOCKED for live CI evidence.

2026-09-26 — Iteration 03 Phase C: Correct progression runtime (SQLite path).
Evidence: XP repeat eligibility (first completion 100%, a valid delayed Rematch or best-score
improvement of the same scenario version within 7 days 25%, further identical repeats 0%), the UTC
daily solo cap (500) computed from persisted `xp_awarded` ledger rollups, and per-scenario Mastery
best (`user_scenario_mastery`, 0–3, positive-delta-only) all apply inside the single
`applyScenarioCompletionRewards` transaction. Lazy Energy regen advances `energyUpdatedAt` by
`consumedTicks * 30m` (preserving the interval remainder, never jumping to `now`) and is
concurrency-safe: the regen idempotency key `energy:regen:{userId}:{anchorMs}` prevents double
grants, and `projectEconomyState` is read-only so `GET /balance` never mutates.
`startEligibleScenarioRun` is one atomic transaction that applies regen, derives the Energy cost
from the SERVER scenario mode (never a client field), checks the balance, spends `energy_spent`,
then creates the run — the run is created before the spend event so the
`ledger_events.run_id → scenario_runs` FK holds (immediate off-schedule Rematch costs 1 Energy;
scheduled Rematch, Academy, and onboarding cost 0). New domain tests in
`packages/domain/src/economy.test.ts` (repeat multiplier, xpForCompletion, regen remainder,
energyCostForMode, key-condition breakdown) and repository tests in
`packages/db/src/economy.test.ts` (cap, Mastery-delta, regen double-grant, atomic spend) pass.
Status: ACCEPTED_LOCAL for the SQLite runtime; the PostgreSQL runtime mirrors it and stays
`IMPLEMENTED_LOCAL`/BLOCKED for live CI evidence.

2026-09-26 — Iteration 03 Phase D: First real client vertical slice wired to the API.
Evidence: a playable flow now exists in `apps/design-system-lab` (previously only static/Hub
screens). `src/play/api.ts` is the only place the slice talks to the server — every request goes
to `/api/v1` (same-origin, proxied) and every response is validated against the shared
`@signal-arena/contracts` schemas; the client computes no score and mutates no balance.
`src/play/PlaySlice.tsx` drives scenario → choose evidence → submit decision → seal → reveal →
score → XP/Mastery result, and a reload restores the run from the server via the new read-only
`GET /api/v1/scenario-runs/:runId` (score surfaced only when revealed/completed) plus
`GET /api/v1/auth/me`. Two self-scoped read endpoints were added to the API for this. A manual
browser run reached a sealed, scored result (Quality Score 87) granting +33 XP / +3 ★ with Coins
held at 0, entirely through the API. `pnpm validate:public-client` stays green over the new
`src/play/*` files; `pnpm design-system:typecheck` and `pnpm design-system:build` PASS.
Status: ACCEPTED_LOCAL.

2026-09-26 — Iteration 03 Phase E: Playwright browser evidence (two gates).
Evidence: `@playwright/test` added as a root devDependency with `playwright.config.ts` booting a
fresh fixture-auth API + Vite stack per gate. The `api` project runs the pure HTTP integration gate
(`auth → scenario → start → seal → reveal → reward`) asserting `xpGranted > 0`, `masteryDelta > 0`,
`balance.coins == 0`, idempotent replay, and a ledger with zero coin-asset events. The `browser`
project drives the real Phase D UI (full flow + reload persistence, four viewports 1440×900 /
900×700 / 620×900 / 390×844, keyboard operability, `prefers-reduced-motion`, and a zero-console-error
check), writing screenshots to `docs/qa/`. `pnpm test:browser` runs the two gates as separate
invocations so each sees a pristine economy (5/5 pass); a CI step installs Chromium and runs it.
Status: ACCEPTED_LOCAL. This closes the Iteration 02 `C4 BLOCKED` browser-coverage gap with real UI
evidence (the live PostgreSQL economy path remains separately BLOCKED).

2026-09-26 — Design System Lab branded preloader intro.
Environment: local, macOS, Node 22, pnpm 11.9.0.
Evidence: pnpm design-system:typecheck PASS, pnpm design-system:build PASS (Vite output index.html 0.78 kB, CSS 12.87 kB, JS 209.51 kB), reduced-motion skip path in main.tsx, malformed `{--pulse:0}` CSS block removed.
No new asset files introduced. Preloader uses CSS-drawn tokens from packages/ui-game only.
Status: ACCEPTED_LOCAL.

2026-09-26 — Iteration 02 Phase D Coins ledger foundation (roadmap step 12).
Evidence: new `packages/contracts/src/economy.ts` + 9 contract tests; new `packages/domain/src/economy.ts` + 11 domain tests (XP curve reproduces all 20 `xpToNext` and 21 cumulative snapshot values from `game_balance_spec.md §3.1`, plus quality bands, daily-cap clamp, 30-minute energy regen, 0-3 mastery ladder); migration `0004_economy_ledger` for SQLite and PostgreSQL (`ledger_events` append-only with `UNIQUE(user_id, idempotency_key)` and `user_economy_state` cached projection); `PersistencePort` extended with `getEconomyState`/`ensureEconomyState`/`appendLedgerEvent`/`listLedgerEvents` on both adapters; 11 repository tests (`packages/db/src/economy.test.ts`) covering grant idempotency, same-key/different-payload 409, per-user key scoping, spend, promo separation, energy cap clamp, mastery accumulation, keyset pagination, concurrent same-key append (single row), and pure projection; API wiring `GET /api/v1/users/:userId/balance`, `GET /api/v1/users/:userId/ledger` (both self-scoped, non-mutating) and `POST /api/v1/scenario-runs/:runId/rewards` (CSRF-gated, idempotent per `runId`); 5 e2e tests in `tests/e2e/economy.test.ts` including an explicit anti-pay-to-win assertion (Coins/XP never feed the Quality Score; balance wire shape exposes no score/rank/risk/outcome field). All local gates green: `pnpm test` 74 pass / 1 skip, `pnpm test:e2e` 15 pass, `pnpm typecheck`/`pnpm lint`/`pnpm build` PASS.
Assumptions recorded: the per-run coin rate (`RUN_COIN_REWARD_XP_DIVISOR`) is a documented hypothesis `H-ECON-REWARD` (no canonical earned-coin rate exists yet in `economy_monetization_referrals.md`); XP lives in the cached projection, not the ledger (there is no bare XP event kind); daily-XP-cap and energy-regen timers are enforced as pure domain functions tested directly, not yet driven by a scheduler. Store/checkout/referral flows and the live PostgreSQL economy path remain Iteration 03.
Status: ACCEPTED_LOCAL for the SQLite economy path, contract, domain, and API wiring; the PostgreSQL economy path is `IMPLEMENTED_LOCAL` (exercised only when `POSTGRES_TEST_URL` is set).

2026-09-26 — Iteration 02 local tree hygiene (Phase A).
Evidence: pnpm validate:assets PASS — 87 draft assets registered (fixed 40 skill-card `.jpg`→`.svg` and one stale topbar.png path); pnpm validate:public-client PASS — 4 files scanned across `apps/design-system-lab/src` and `packages/ui-game/src`, missing roots now hard-fail; removed silent `client:*` scripts and replaced CI steps with real `design-system:*` runs.
Status: ACCEPTED_LOCAL.
```

## Recent removed

```text
2026-09-26 — docs/design-system/foundation-v1/** snapshot removed from the working tree.
Canonical foundation-v1 material is now `system_architecture.md` plus this file.
The `docs/asset_provenance_and_workflow.md` doc now carries a "Pending provenance queue" for
unregistered brand files (see below).

2026-09-26 — root `client:typecheck`, `client:lint`, `client:test`, `client:build` scripts removed.
They filtered `@signal-arena/client-prototype`, which no longer exists. pnpm printed
"No projects matched the filters" and returned exit 0 — a mandatory-gate failure disguised
as a pass. CI steps replaced with `design-system:typecheck` and `design-system:build`.
```

## Known broken (before Iteration 02, resolved by Phase A)

```text
- `pnpm validate:assets` FAILED with 41 references to `.jpg` files that were actually `.svg`.
- `pnpm validate:public-client` FAILED with ENOENT on `apps/client-prototype/src`.
- `pnpm client:*` scripts silently exit 0 on a nonexistent package filter.
```

These are documented here so the record does not read as though the gates had always been green.

## Pending provenance queue

Registered in `docs/asset_provenance_and_workflow.md § 9`. Files exist on disk but are NOT in `assets/asset-manifest.json` because their origin is unconfirmed:

```text
assets/logopng.png
assets/logosamall.png
assets/ui/signal_arena_icon_96_transparent.png
```

Owner decision required before any UI may depend on them. The preloader does not reference them.

## Immediate next sequence

1. Confirm `hudyakovictor/ssarena` as the authoritative runtime repository. **PLANNED**
2. Foundation — executable scaffold, scripts, CI and baseline fixture. **ACCEPTED_LOCAL**.
3. Real contract tests. **ACCEPTED_LOCAL**.
4. Database, migrations and repeatable seed fixtures. **ACCEPTED_LOCAL** for the SQLite foundation gate; PostgreSQL is `IMPLEMENTED_LOCAL` (integration test requires `POSTGRES_TEST_URL`).
5. ScenarioPackage validator/importer and public/hidden projection boundary. **ACCEPTED_LOCAL** for the foundation gate.
6. DB-backed Scenario Run API: start, immutable seal, and post-seal reveal. **ACCEPTED_LOCAL** for the foundation gate.
7. Telegram auth boundary, session extraction, route protection, logout/revocation and local API hardening. **ACCEPTED_LOCAL**; shared production rate limiting, structured observability and deployment validation remain `BLOCKED`.
8. Foundation scoring contract, golden fixtures and score persistence. **ACCEPTED_LOCAL** for `score-v1`; production rubric calibration and review tooling remain `BLOCKED`.
9. Historical provider adapters and point-in-time snapshot pipeline. Binance adapter boundary, security fixtures and normalized snapshot persistence are **ACCEPTED_LOCAL**; scheduling and ScenarioPackage ingestion remain `BLOCKED`.
10. Client vertical slice via Design System Lab. Preloader + boundary gate **ACCEPTED_LOCAL**; the first real API-wired playable vertical slice (scenario → decision → seal → reveal → score → XP/Mastery, Coins 0, reload-restore) is **ACCEPTED_LOCAL** (Iteration 03 Phase D); Playwright browser/responsive/keyboard/reduced-motion evidence is **ACCEPTED_LOCAL** (Phase E). The full production game UI remains out of scope.
11. PostgreSQL pool/repository adapter, readiness/shutdown behavior and migration command. **ACCEPTED_LOCAL** with a real PostgreSQL integration test when `POSTGRES_TEST_URL` is provided; restore drill, staging rehearsal and shared production rate limiting remain `BLOCKED`.
12. Server-authoritative economy Ledger v2 (XP/Energy/Mastery/Coins) + progression runtime. **ACCEPTED_LOCAL** at contract + domain + SQLite persistence + API wiring (Iteration 03 Phases B/C): completion grants XP + Mastery only (never Coins), with repeat eligibility, UTC daily cap, per-scenario Mastery best, lazy (scheduler-free) Energy regen, and an atomic server-derived `startEligibleScenarioRun`. The live PostgreSQL economy path is `IMPLEMENTED_LOCAL`/BLOCKED for CI evidence; store/checkout (Iteration 04) and referral flows (Iteration 05) remain out of scope.
13. Visual lab runtime mode, motion/accessibility QA and production asset release approval. **IMPLEMENTED_LOCAL** for the shell; Playwright browser/responsive/keyboard/reduced-motion evidence for the vertical slice is **ACCEPTED_LOCAL** (Iteration 03 Phase E); production visual/release asset approval remains `BLOCKED`.
14. Vercel alpha deployment and provider/payment smoke test. **PLANNED**.
15. AI agent runtime contracts, isolated job runner, and CRM approvals. **PLANNED**.
16. Roadmap control plane: contracts, gate/evidence ingestion, blocker calculation, Admin API and CRM views. **PLANNED**.
17. Full integration audit and release evidence. **PLANNED**.
18. Academy learning vertical slice (Iteration 04): Level 0 → lesson → guided practice → server-verified Challenge Test → Arena Transfer (provisional) → Decision Telemetry v1 → deterministic Personal Insight v0 for the single module `invalidation_before_direction`. **ACCEPTED_LOCAL** on the SQLite path (contract, domain, persistence via migrations 0006/0007, API, first real Academy UI, Playwright evidence). The live PostgreSQL learning path is **IMPLEMENTED_LOCAL**/BLOCKED for CI evidence; the delayed-rematch scheduler, client-side telemetry emitter, the other 13 modules and any AI/LLM narrative remain out of scope.

Vertical-slice loop retained for reference:

```text
bootstrap
→ scenario
→ evidence
→ decision
→ seal
→ historical reveal
→ score
→ debrief
→ progression
→ rematch
```

## Current evidence

Local run on 2026-09-26 (macOS, Node 22, pnpm 11.9.0, no `POSTGRES_TEST_URL` set):

```text
pnpm install --frozen-lockfile                  PASS
pnpm typecheck                                  PASS
pnpm lint                                       PASS
pnpm test                                       PASS — 140 pass / 1 skip / 0 fail (141 total; skip is the PostgreSQL integration test)
pnpm test:e2e                                   PASS — 24 tests (API + economy + learning verification/transfer + decision telemetry)
pnpm validate:contracts                         PASS
pnpm validate:content                           PASS
pnpm validate:learning                          PASS — 1 module, 1 skill, 1 lesson across 4 scenarios; 40 canonical Entity names recognised
pnpm validate:locales                           PASS
pnpm validate:assets                            PASS — 87 draft assets registered
pnpm validate:public-client                     PASS — 14 files scanned, 2 roots (incl. src/play and src/academy)
pnpm build                                      PASS
pnpm design-system:typecheck                    PASS
pnpm design-system:build                        PASS — Vite output, no client-side boundary violations
pnpm exec playwright test                       PASS — 11 Playwright tests (1 API integration + 10 browser E2E: Academy flow, Decision Workspace, persistence, telemetry orderings, 4 viewports, keyboard, reduced-motion)
DB_PATH=var/db-validation.sqlite pnpm db:migrate PASS — repeatable, includes historical snapshots and learning migrations 0006/0007
DB_PATH=var/db-validation.sqlite pnpm db:seed    PASS — repeatable
```


Browser E2E, responsive (4 viewports), keyboard and reduced-motion evidence for the vertical slice is now `ACCEPTED_LOCAL` via Playwright (`test:browser`, screenshots in `docs/qa/`). PostgreSQL-backed tests are skipped in this local run because `POSTGRES_TEST_URL` is not set. CI must supply a PostgreSQL service and run them; do not read the local `PASS` as a PostgreSQL PASS.

The DB foundation stores full server-side ScenarioPackages, preserves `(scenario_id, version)` records, enforces scenario/user foreign keys, and makes scenario-run creation idempotent by `idempotency_key`. The importer rejects invalid JSON, post-t0/unavailable sources, invalid future ranges, and mismatched future hashes. The API reads versioned packages from SQLite or PostgreSQL through the same `PersistencePort`, returns only public projection before seal, rejects reveal before seal, and exposes reveal data plus the persisted process score only after an immutable sealed decision. Telegram auth, async shared replay protection, session revocation, local CSRF/CORS/header/rate-limit controls, foundation scoring, PostgreSQL lifecycle integration, Binance adapter validation and the design-system-lab boundary check are locally evidenced. Vertical-slice browser E2E/responsive/keyboard/reduced-motion evidence is `ACCEPTED_LOCAL` via Playwright, and the first Academy learning-loop evidence (one module, SQLite path) is `ACCEPTED_LOCAL`. Shared production rate limiting, structured observability, provider ingestion, rubric governance, the live PostgreSQL economy and learning paths, client-side telemetry emission and production learner analytics, backup/restore rehearsal and production scoring calibration remain open.

## Decision policy

Audit and simulation results are internal inputs. They are not canonical product documents. Final decisions are recorded in the active specifications and this status file, without publishing raw audit output in the main documentation path.

## Acceptance rule

No implementation phase is accepted from documentation alone. Acceptance requires executable code, automated tests, manual QA, evidence, and explicit status.
