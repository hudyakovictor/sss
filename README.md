# SIGNAL ARENA

> Telegram Mini App: decision trainer для анализа исторических криптовалютных сценариев.

Signal Arena учит принимать решения до раскрытия будущего рынка. Игрок работает с evidence, строит гипотезу, задаёт инвалидацию, выбирает действие, получает process score и исправляет повторяющиеся ошибки.

Проект запускается без собственного токена, wallet, marketplace и blockchain-зависимости в core gameplay. Первая монетизация — Telegram Stars и Founder Support Packs после получения gameplay value; rewarded ads и другие платформы не входят в первый core slice.

## Быстрый старт для AI-агента

Перед любой задачей прочитай документы в таком порядке:

```text
1. AGENTS.md
2. docs/README.md
3. game-development-skill/SKILL.md и релевантный sub-skill
4. relevant Signal Arena documents
5. focused task prompt
```

Затем определи:

```text
роль агента
текущую фазу
scope задачи
затрагиваемые contracts
нужные migrations
acceptance criteria
```

## Текущий статус

```text
Phase: Executable foundation / first technical vertical slice accepted locally
Documentation and executable foundation: tracked in docs/developing_status.md
Executable foundation: PASS
First real vertical slice (technical, API-wired): ACCEPTED_LOCAL (Iteration 03)
Production vertical slice: NOT YET ACCEPTED
Overall product: BLOCKED
Primary platform: Telegram Mini App
Primary payment: Telegram Stars/XTR
Primary chain target: none in MVP
Current priority:
Academy Level 0
→ challenge verification
→ learning progression
→ decision telemetry
→ Personal Insight
→ delayed transfer
```

Технический scenario loop (auth → scenario → decision → seal → reveal → score → XP/Mastery) закрыт на уровне `ACCEPTED_LOCAL` вместе с Playwright-доказательствами. Следующий незакрытый разрыв — продуктовый: обучающий цикл ещё не существует. Приоритет Iteration 04:

```text
Level 0
→ микроурок
→ worked example
→ guided practice
→ «Я это знаю — проверить» (Challenge Test)
→ подтверждение навыка (server-authoritative)
→ Arena Transfer
→ Decision Telemetry
→ Personal Insight v0
→ delayed rematch
```


## Главные документы

### Управление разработкой

- [AGENTS.md](AGENTS.md) — роли AI-агентов, границы директорий, contract-first workflow и запрещённые зависимости.
- [CONTRIBUTING.md](docs/CONTRIBUTING.md) — ветки, commits, PR, labels, review comments и merge policy.
- [developing_status.md](docs/developing_status.md) — последовательность фаз, параллельные потоки и чеклисты приёмки.

### Продукт

- [Full Game Specification](docs/full_game_spec.md) — каноничное ТЗ игры, client stack, режимы, scoring, Shop, profiles и tournaments.
- [Academy Plan](docs/academy_plan.md) — структура обучения и curriculum.
- [Brand](docs/brand.md) — визуальное направление Signal Arena.
- [Style and Tone](docs/style-tone.txt) — панк-таблоидная криптосатира и правила текстов.
- [Competitors](docs/competitors.md) — конкурентный анализ и позиционирование.

### Монетизация и экономика

- [Monetization](docs/monetization.txt) — Stars, Founder Packs, subscriptions, rewarded ads, anti-pay-to-win и token readiness gates.
- [Architecture and Operations](docs/system_architecture.md) — topology, environments, security, scaling, and deployment.
- [Security Architecture](docs/security_architecture.md) — browser, identity, API, admin, provider, and data controls.
- [Observability](docs/observability_and_incident_response.md) — structured logs, metrics, alerts, and incident workflow.

### Архитектура

- [System Architecture](docs/system_architecture.md) — monorepo, topology, applications, packages, APIs, security boundaries and deployment.
- [Security Architecture](docs/security_architecture.md) — XSS, identity, API, admin, provider, and data controls.
- [Deployment and Environments](docs/deployment_and_environments.md) — local, staging, production and two-surface topology.
- [Performance and Scaling](docs/performance_and_scaling.md) — stateless services, backpressure, queues, caching and load gates.
- [Observability](docs/observability_and_incident_response.md) — logs, traces, metrics, alerts and incident workflow.
- [Roadmap Control Plane](docs/roadmap_and_release_control_plane.md) — stages, dependencies, gates, blockers, evidence and release readiness.
- [CRM Stack](docs/crm_stack_spec.md) — отдельный стек CRM и Admin API.
- [Multichain Readiness](docs/multichain_readiness_assessment.md) — Base, MiniPay, Solana Mobile, adapters и общий backend.
- [Interactive Motion](docs/interactive_motion_spec.md) — интерактив, анимации, haptics, sound и reduced motion.

## Архитектурная схема

```text
apps/
  game-client/       Phaser 4 + TypeScript + Vite + hybrid DOM UI
  api-server/        Fastify + TypeScript + Zod + Drizzle
  admin-crm/         Next.js + React + TypeScript + Tailwind + shadcn/ui
  landing/           Next.js + TypeScript + Tailwind

packages/
  contracts/         общие Zod schemas и DTO
  domain/            чистые бизнес-правила
  db/                Drizzle schema, migrations, repositories
  content/           scenarios, cards, entities, rubrics, fixtures
  adapters/          Telegram, Stars, Ads, AI, future platforms/chains
  analytics/         event taxonomy
  config/            env и feature flags
  ui-game/           игровые UI helpers
  ui-crm/            CRM components
  agent-runtime/     AI tools, jobs and policies

workers/
  payments/
  content/
  localization/
  analytics/
  ai/
```

## Стек клиента

```text
Phaser 4
TypeScript
Vite
Hybrid DOM UI for accessibility-heavy screens
Custom CandleChart or validated chart adapter
```

Phaser отвечает за Arena-сцены, chart interaction, reveal, game loop, tweens, camera, particles и sound. Длинный текст, формы, Shop, Profile, Notifications и Settings могут использовать DOM UI. rexUI является опциональным и требует отдельной проверки совместимости с закреплённой версией Phaser.

Клиент не является источником истины для score, hidden future, payments, inventory, entitlements и tournament results.

## Стек API

```text
Fastify
TypeScript
Zod
Drizzle ORM
SQLite → PostgreSQL-ready repositories
WebSockets
Pino
Redis-ready queues/rate limits
```

API является источником истины для:

- auth и sessions;
- scenarios и scenario runs;
- decisions и scoring;
- progression;
- catalog/orders/payments;
- inventory/entitlements;
- public profiles;
- tournaments;
- localization;
- AI jobs;
- audit.

## Стек CRM

CRM не использует Phaser или rexUI:

```text
Next.js 15+ App Router
React
TypeScript
Tailwind CSS
shadcn/ui или Radix UI
TanStack Query
TanStack Table
React Hook Form + Zod
Recharts/ECharts
Playwright
Vitest
```

CRM работает только через Admin API. Прямой доступ браузера к базе запрещён.

## Граница продуктовых документов

`docs/full_game_spec.md` описывает 100% законченную игру. Отдельное MVP-ТЗ выбирает первый срез, roadmap задаёт порядок, а `docs/developing_status.md` хранит подтверждённый текущий статус. Полная спецификация не должна сокращаться ради MVP.

## Основная навигация игры

```text
Арена | Академия | Магазин | Турниры
```

Профиль открывается через Avatar в Top Bar.

Арена является hub для:

- Continue;
- Daily Fix Mission;
- Rematch;
- Blind Scenario;
- Conflict Scenario;
- Post-Loss Protocol;
- Challenge Friend;
- Personal Insight.

## Монетизация

```text
Free Academy/Arena
→ gameplay value
→ optional Stars digital goods
→ Founder Support Packs
→ optional rewarded ads
→ future platform research outside MVP
```

Покупки не могут изменять:

```text
score
historical outcome
mastery
risk rules
tournament ranking
future visibility
```

## ScenarioPackage и контентный поток

ScenarioPackage включает `scenarioId`, `version`, `scenarioLevel`, `mode`, `assetId`, `decisionPoint.t0`, Source Groups, available sources/cards/protocols, hidden Entities, allowed actions, future segment, evaluation rules, versions, hashes, debrief и rematch logic. До Seal клиент получает только public projection.

```text
Draft
→ Research
→ Point-in-time validation
→ Review
→ Validated
→ Published
```

## Контентный поток

```text
CRM draft
→ API validation
→ schema/fairness validation
→ review
→ localization
→ publish version
→ public API
→ game client
```

Клиент может использовать mock fixtures, но fixtures проходят те же schemas, что и данные из БД.

## Contract-first правило

Любая cross-app feature начинается с `packages/contracts`:

```text
Zod schema
→ request/response examples
→ API route
→ mock fixture
→ client integration
→ CRM integration
→ analytics
→ tests
→ docs
```

Запрещено создавать отдельные несовместимые типы для client, API и CRM.

## Текущая очередность

### P0

- monorepo boundaries;
- AGENTS/CONTRIBUTING/developing status;
- packages/contracts;
- database schema и migrations;
- API skeleton;
- content schemas и fixtures;
- Telegram/dev auth;
- vertical slice;
- minimal CRM;
- structured logs;
- hidden future tests.

### P1

- Phaser production UI;
- Stars payment flow;
- Founder Packs;
- entitlements/inventory;
- public profiles;
- cosmetics;
- basic tournament;
- ru/en localization;
- personal insights.

### P2

- rewarded ads;
- tournament seasons;
- squads;
- creator marketplace;
- Base/MiniPay adapters;
- TON Connect;
- on-chain credentials;
- token readiness review.

## Запуск и проверки

Команды должны быть добавлены по мере создания workspace:

```bash
pnpm install
pnpm dev:client
pnpm dev:api
pnpm dev:crm
pnpm dev:landing
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm validate:contracts
pnpm validate:content
pnpm validate:locales
pnpm build
```

Агент не должен утверждать, что проверка пройдена, если команда не запускалась.

## Состав репозитория

Репозиторий содержит полные исходники. Умышленно не коммитятся (см. `.gitignore`):

```text
node_modules/ + .pnpm-store/  зависимости — восстанавливаются: pnpm install
dist/                         сборка — восстанавливается: pnpm build
var/                          локальные SQLite-базы и эксперименты — восстанавливаются: pnpm db:migrate + pnpm db:seed
*.zip                         архивы поставок — не хранятся в git
.DS_Store / .env              локальный мусор и секреты — .env собирается из .env.example
```

Лимит GitHub 100 МБ действует на отдельный файл, а не на репозиторий; исходников, вырезанных из-за лимитов, в проекте нет. Всё, что нужно для работы, восстанавливается командами выше с нуля.

## Definition of Done

```text
[ ] Contract updated and consumed by API/client/CRM.
[ ] Database migration added if data changed.
[ ] API input/output validated.
[ ] Loading/error/empty states exist.
[ ] Analytics events added.
[ ] Feature flag added for risky functionality.
[ ] Payment/refund behavior defined where relevant.
[ ] Audit event added for admin mutation.
[ ] Unit/integration/e2e tests updated.
[ ] Localization keys added.
[ ] Documentation updated.
[ ] No secrets committed.
[ ] Rollback path documented.
```

## Правила для AI-агента

Перед задачей:

```text
Read AGENTS.md
Read docs/developing_status.md
Read docs/CONTRIBUTING.md
Identify role and phase
Inspect existing contracts
Define scope
```

После задачи:

```text
Scope:
Files changed:
Contracts changed:
Database/migrations:
API routes:
Feature flags:
Analytics events:
Tests run:
Risks:
Not implemented:
Rollback plan:
```

## Главный инвариант

```text
Одна игра.
Один backend domain.
Один contracts package.
Разные platform/payment/chain adapters.
Единая CRM.
Единая аналитика.
Игра работает без токена.
```