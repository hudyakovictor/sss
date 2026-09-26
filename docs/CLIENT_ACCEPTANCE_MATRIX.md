# Client Acceptance Matrix — Current Status Model

Status: REQUIRED
Scope: client acceptance status and evidence crosswalk
Owner: Signal Arena project owner
Last reviewed: 2026-09-26
Supersedes: numeric Iteration 1 prototype assessment; the pre-Iteration-04 baseline (technical slice only, no Academy learning loop)
Required evidence: browser E2E, visual/responsive QA, accessibility QA, reduced-motion QA, contract and API evidence
Canonical dependencies: `developing_status.md`, `acceptance_matrix.md`, `INTERFACE_SHELL.md`, `motion_interaction_system_spec.md`

> Current client note: the client is the React + Vite **Design System Lab**
> (`apps/design-system-lab`) consuming `packages/ui-game`. The Phaser prototype
> (`apps/client-prototype`) was removed in Iteration 02; any "Phaser scene map"
> row below now refers to the React client runtime.

## 1. Acceptance rule

Client acceptance is not an aggregate score. A strong UI result cannot compensate for a future leak, broken authentication, client-authoritative score, missing accessibility evidence or an unresolved P0/P1 blocker.

Allowed statuses:

```text
PASS
PARTIAL
OPEN
BLOCKED
NOT_APPLICABLE
```

Every factor must be backed by:

```text
status
gate
evidence
environment
last_verified
owner
blocker
```

The authoritative values belong in gate/evidence records. This document defines the required matrix shape and the current known baseline; empty evidence is not acceptance.

## 2. Current factor baseline

| # | Factor | Status | Gate | Evidence | Environment | Last verified | Owner | Blocker |
|---:|---|---|---|---|---|---|---|---|
| 1 | Preload state | PASS | client preload | preloader + reduced-motion skip in `main.tsx`; Playwright asserts no leftover overlay across viewports | local | 2026-09-26 | client | — |
| 2 | Main menu routing | PASS | view-mode map | Design System Lab preview/runtime/play/academy modes wired in `App.tsx` | local | 2026-09-26 | client | — |
| 3 | Academy route | PASS | route map + server progression | AcademySlice Level 0 → lesson → practice → Challenge → verify → Arena Transfer, all server-driven; Playwright | local | 2026-09-26 | client | remaining 13 modules (Iter 05+) |
| 4 | Scenario brief | PARTIAL | client flow | PlaySlice renders server public projection | local | 2026-09-26 | client | richer brief UI |
| 5 | Scenario identity | PASS | public projection | `GET /scenarios/:id` validated in client | local | 2026-09-26 | client/API | — |
| 6 | Public data separation | PASS | future-leak | `validate:public-client` green over `src/play/*` | local | 2026-09-26 | API/client | production evidence |
| 7 | Hidden future separation | PASS | future-leak | reveal gated server-side; score hidden pre-reveal | local | 2026-09-26 | API/client | — |
| 8 | Historical reveal | PASS | reveal flow | Playwright reveal + reload restore | local | 2026-09-26 | client/API | — |
| 9 | Source Groups | PASS | ScenarioPackage | — | local | 2026-09-15 | content/API | publication pipeline |
| 10 | Skill Cards | PASS | learning linkage | `validate:learning` coherence gate; Academy lesson renders server content blocks (comparison/recall) | local | 2026-09-26 | content/client | remaining modules |
| 11 | Evidence selection | PASS | Decision Workspace | reusable `DecisionWorkspace` de-dupes the pre/post-Start step; Playwright run-first gating | local | 2026-09-26 | client | — |
| 12 | Decision actions | PASS | decision contract | seal via API; `DecisionTraceSchema` | local | 2026-09-26 | client/API | — |
| 13 | Invalidation field | PASS | scoring contract | required in the workspace; `invalidation_before_action` critical gate verified server-side | local | 2026-09-26 | scoring/client | — |
| 14 | Confidence field | PARTIAL | scoring contract | field present; range validated | local | 2026-09-26 | scoring | rubric governance |
| 15 | Process scoring | PARTIAL | deterministic replay | server `evaluateFoundationDecision` | local | 2026-09-26 | scoring | production calibration |
| 16 | Outcome separation | PASS | public/hidden projection | balance wire exposes no score/rank/risk | local | 2026-09-26 | API | — |
| 17 | Debrief structure | PARTIAL | learning ladder | reveal shows historical outcome summary | local | 2026-09-26 | content/client | corrective ladder (Iter 04) |
| 18 | Rematch route | OPEN | delayed rematch | — | local | — | client/content | rematch fixtures |
| 19 | Entity reveal | OPEN | hidden Entity | — | local | — | content/client | browser QA |
| 20 | Account progression | PARTIAL | balance contract | XP/Mastery/Energy/Coins projection (Ledger v2) | local | 2026-09-26 | economy | PostgreSQL economy CI |
| 21 | Mobile layout model | PASS | responsive QA | Playwright 4 viewports (1440/900/620/390) assert no horizontal overflow and no leftover overlay | local | 2026-09-26 | client | — |
| 22 | Accessibility model | PASS | accessibility QA | Playwright keyboard + reduced-motion + aria-live result over the full Academy flow; fieldset/legend workspace | local | 2026-09-26 | client | — |
| 23 | Keyboard navigation | PASS | keyboard/focus QA | Playwright keyboard-only Academy core path with visible focus | local | 2026-09-26 | client | — |
| 24 | Reduced motion | PASS | reduced-motion QA | Playwright `prefers-reduced-motion`, no console errors | local | 2026-09-26 | client | — |
| 25 | Error states | PARTIAL | error-state QA | Academy loading/empty states + typed errors incl. `insufficient_energy`, corrective reason | local | 2026-09-26 | client/API | production retry/backoff |
| 26 | Typed state | PASS | client typecheck | `design-system:typecheck` PASS | local | 2026-09-26 | client | — |
| 27 | Deterministic fixture | PASS | deterministic replay | — | local | 2026-09-15 | scoring | production governance |
| 28 | Client runtime (Design System Lab) | PASS | client build | `design-system:build` PASS; Phaser prototype removed | local | 2026-09-26 | client | visual QA |
| 29 | API adapter boundary | PASS | API contract | Playwright API integration gate | local | 2026-09-26 | client/API | — |
| 30 | Persistence boundary | PASS | persistence contract | — | local | 2026-09-15 | API/DB | staging rehearsal |
| 31 | Test coverage | PASS | test suite | 140 unit + 24 e2e + 11 Playwright (1 PG skip) | local | 2026-09-26 | QA | PostgreSQL economy/learning CI |
| 32 | E2E flow | PASS | E2E | Playwright API + Academy browser gates green (new/experienced/failure/persistence/telemetry/viewports/a11y) | local | 2026-09-26 | QA | — |
| 33 | Visual QA | PARTIAL | visual QA | 4-viewport screenshots in `docs/qa/` | local | 2026-09-26 | client | production asset approval |
| 34 | Economy boundary | PASS | Coins ledger | Ledger v2: completion grants no Coins; anti-pay-to-win asserted | local | 2026-09-26 | economy | PostgreSQL economy CI |
| 35 | Production readiness | BLOCKED | release readiness | — | local | 2026-09-26 | release | unresolved production gates |
| 36 | Academy verification UX | PASS | server-authoritative progression | «Я это знаю» only opens a Challenge; status/badge read from `GET /academy/modules/:id`; Playwright verified + failure paths | local | 2026-09-26 | client/API | remaining modules |
| 37 | Arena Transfer UX | PASS | provisional mastery | Transfer gated on `verified`; result shows provisional (never `mastered`); Playwright + e2e | local | 2026-09-26 | client/API | delayed-rematch scheduler |
| 38 | Hub next-best-action | PASS | server progression mapping | `HubNextBestAction` maps the real server status; no hard-coded metric; Playwright | local | 2026-09-26 | client | — |
| 39 | Decision telemetry emitter | OPEN | client telemetry | workspace does not yet emit events; ingest/timeline/diagnostics proven server-side + unit | local | 2026-09-26 | client | client emitter wiring (must stay non-authoritative) |
| 40 | Personal Insight rendering | PARTIAL | explainable insight | v0 is a deterministic server/domain function; no client-side conclusion, no AI/LLM claim | local | 2026-09-26 | client/domain | insight surfaced in UI (Iter 05) |

The `PASS` and `PARTIAL` values above are a human-readable baseline and do not replace evidence records. A gate is accepted only when the evidence record is valid for the relevant commit, environment, fixture version and contract version.

## 3. Historical Prototype Assessment

The former numeric Iteration 1 table is retained as historical, non-canonical, superseded context only. Its values must not be averaged or presented as current acceptance.

| # | Factor | Historical target | Iteration 1 score |
|---:|---|---:|---:|
| 1 | Preload state | 100 | 90 |
| 2 | Main menu routing | 100 | 80 |
| 3 | Academy route | 100 | 75 |
| 4 | Scenario brief | 100 | 80 |
| 5 | Scenario identity | 100 | 85 |
| 6 | Public data separation | 100 | 80 |
| 7 | Hidden future separation | 100 | 80 |
| 8 | Historical reveal | 100 | 75 |
| 9 | Source groups | 100 | 80 |
| 10 | Skill cards | 100 | 75 |
| 11 | Evidence selection | 100 | 75 |
| 12 | Decision actions | 100 | 85 |
| 13 | Invalidation field | 100 | 70 |
| 14 | Confidence field | 100 | 70 |
| 15 | Process scoring | 100 | 65 |
| 16 | Outcome separation | 100 | 80 |
| 17 | Debrief structure | 100 | 75 |
| 18 | Rematch route | 100 | 70 |
| 19 | Entity reveal | 100 | 65 |
| 20 | Player progression | 100 | 40 |
| 21 | Mobile layout model | 100 | 40 |
| 22 | Accessibility model | 100 | 45 |
| 23 | Keyboard navigation | 100 | 45 |
| 24 | Reduced motion | 100 | 30 |
| 25 | Error states | 100 | 30 |
| 26 | Typed state | 100 | 85 |
| 27 | Deterministic fixture | 100 | 85 |
| 28 | Phaser scene map | 100 | 85 |
| 29 | API adapter boundary | 100 | 25 |
| 30 | Persistence boundary | 100 | 20 |
| 31 | Test coverage | 100 | 20 |
| 32 | E2E flow | 100 | 15 |
| 33 | Visual QA | 100 | 20 |
| 34 | Economy boundary | 100 | 15 |
| 35 | Production readiness | 100 | 10 |
