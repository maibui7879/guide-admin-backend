# Stella Atlas — Backend Development Roadmap

> **Project:** Stella Atlas — Game Guide & Content Management Platform  
> **Initial game:** Stella Sora  
> **Architecture:** NestJS Modular Monolith, REST API, PostgreSQL  
> **Status:** Backend through Phase 9 implemented and locally verified; frontend expansion deferred  
> **Last updated:** 2026-10-25

## 1. Product vision

Build a maintainable, production-oriented backend for a game guide website similar in scope to Prydwen or Kaiden. The platform must support a public, SEO-friendly game guide website and a secure admin console for content and game-data management.

**Primary goals:**

1. Serve accurate structured game data (characters, skills, equipment, tier lists, teams).
2. Let editors create and publish guides without changing source code.
3. Preserve revision history and distinguish drafts from published content.
4. Support game patch/version updates without silently invalidating editorial guidance.
5. Provide reliable APIs, security, tests, monitoring and deployment.
6. Start with **Stella Sora** while leaving room for additional games later.

**Portfolio objective:** Demonstrate backend architecture and engineering trade-offs through a working production-like system, measurable tests, and architectural documentation—not just CRUD endpoints.

### In scope for MVP

- Game registry and version metadata
- Character catalog with skills, stats, asset references, filtering and pagination
- Guides CMS with revisions, draft/preview/review/publish workflow
- Admin authentication, authorization and audit logs
- Media upload and asset management
- Public REST API, OpenAPI documentation, structured error responses
- Automated tests, migrations, CI and reproducible local environment

### Scope after the backend-first decision

Equipment, builds, tier lists, search, durable workers, imports and operational tooling are implemented through Phase 9. Frontend expansion, external page analytics, localization, community contributions and multi-game rollout remain deferred. Redis response caching remains conditional on measured need.

> **Design constraint:** Prefer a modular monolith. Do not split into microservices, introduce Kafka/Kubernetes, or implement generalized plugin frameworks before a measured need emerges.

---

## 2. Architecture decisions

| Concern | Initial decision | Rationale |
|---|---|---|
| Backend | NestJS + TypeScript | Modular DI, guards, validation and OpenAPI |
| Architecture | Modular monolith | Simple deployment and transactions; clear domain boundaries |
| Database | PostgreSQL | Relational consistency, indexes, JSONB where justified |
| Data mapper / ORM | TypeORM | Fits entity/repository/data-mapper learning goals; choose one ORM |
| API | Versioned REST (`/api/v1`) | Straightforward integration, testing and documentation |
| Validation | DTO + `class-validator` / `class-transformer` | Validate request boundaries; enforce business invariants in services |
| Authentication | Secure admin session in HttpOnly cookie | Avoid browser-token storage as default; session rotation/expiry |
| Authorization | RBAC + resource checks | Restrict editorial and administrative actions |
| Asset storage | S3-compatible (Cloudflare R2 or equivalent) | Keep binaries out of PostgreSQL |
| Local development | Docker Compose | Reproducible PostgreSQL and supporting services |
| API documentation | `@nestjs/swagger` | OpenAPI contract and interactive documentation |
| Testing | Jest + Supertest + real PostgreSQL integration tests | Verify use cases and persistence behavior |
| CI | GitHub Actions | Typecheck, lint, tests, build, migration validation |
| Cache (post-MVP) | Redis | Only after baselines show a need |
| Queues (post-MVP) | BullMQ + Redis | Reindex, image processing, imports, retries |
| Analytics (post-MVP) | Umami/PostHog + admin business metrics | Avoid reinventing full web analytics |

### Principles and non-goals

- PostgreSQL is the **source of truth**. Search indexes and caches are derived.
- `GameVersion` (game patch) and `ContentRevision` (editorial history) are distinct concepts.
- Public APIs return **published content only**, regardless of query parameters supplied by users.
- Published revisions remain available while editors work on newer drafts.
- Each module owns its business rules and persistence access; use public service interfaces for cross-module operations.
- Favor relational columns for fields frequently searched, filtered or joined; reserve JSONB for game-specific attributes validated by a versioned schema.
- Public reading does not require user accounts. Initially, only internal editors/admins authenticate.
- No estimates of traffic or performance improvement should be advertised without measurement.

### High-level flow

```text
Next.js Public Website         React Admin Console
          |                             |
          +------------ HTTPS ----------+
                         |
                    NestJS API
       +-----------------+-------------------+
       |                 |                   |
   Game Catalog      Content CMS        Identity / RBAC
       |                 |                   |
       +---------- Publishing / Audit --------+
                         |
                     TypeORM
                         |
                    PostgreSQL
                         |
             S3-compatible Media Store

Later: outbox -> BullMQ worker -> search/cache/revalidation
```

---

## 3. Repository layout

Recommended monorepo (keep existing frontend files where feasible; do not discard the Work-generated UI without auditing it):

```text
stella-atlas/
├── apps/
│   ├── web/                        # Public website (existing UI / future Next.js)
│   ├── admin/                      # Admin console
│   ├── api/                        # NestJS application
│   │   ├── src/
│   │   │   ├── common/             # Filters, pipes, interceptors, decorators
│   │   │   ├── config/             # Typed validated environment config
│   │   │   ├── database/           # DataSource, migrations, seed scripts
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── users/
│   │   │   │   ├── games/
│   │   │   │   ├── characters/
│   │   │   │   ├── guides/
│   │   │   │   ├── publishing/
│   │   │   │   ├── media/
│   │   │   │   └── audit/
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   └── test/
│   └── worker/                     # Future independent worker process
├── packages/
│   ├── contracts/                  # Client-consumable API schemas/types only
│   └── config/                     # Shared TS/lint presets
├── infrastructure/
│   └── docker/
├── docs/
│   ├── architecture.md
│   ├── erd.md
│   ├── api-conventions.md
│   ├── deployment.md
│   └── adr/
├── .github/workflows/
├── .env.example
├── docker-compose.yml
├── pnpm-workspace.yaml
└── roadmap.md
```

For complex modules (e.g. `publishing`), use `domain/`, `application/`, `infrastructure/`, `presentation/` internally. For simple CRUD modules, standard NestJS module/controller/service/repository organization is enough.

---

## Backend-first execution scope

User decision: complete backend work through Phase 9 before additional frontend work. Existing FE is retained. Frontend integration, admin screens, SEO rendering and browser UI expansion are deferred; they do not block backend milestones. Backend completion requires API contracts, permissions, migrations, tests and operational runbooks. Production infrastructure checks are tracked separately and must not be marked passed without evidence.

Execution order: Phase 5 media library/lifecycle -> Phase 6 equipment/builds/tier lists -> Phase 7 search and measured performance -> Phase 8 durable jobs/import/patch review -> Phase 9 observability, recovery and deployment. Redis/cache remain conditional on measured need; no fabricated performance claims or editorial game data.

## 4. Delivery roadmap

### Phase 0 — Audit existing website & define contracts (foundation)

**Goal:** Identify what exists from the ChatGPT Work export, freeze initial API expectations, and avoid a costly frontend rewrite.

- [ ] Obtain and verify actual frontend source files, assets, fonts and licenses. (Files recovered; font identity and redistribution rights remain unverified.)
- [x] Identify framework, routing, dependencies and existing hardcoded JSON data.
- [x] Inventory public pages: home, characters, details, guides, tier list.
- [x] Define data needed by each page, including optional/missing fields.
- [x] Write initial OpenAPI resource map and API naming conventions.
- [x] Document user roles, edit/publish responsibilities and MVP boundaries.
- [x] Define legal/attribution policy for artwork, game fonts and third-party guide content.
- [x] Record decisions in `docs/architecture.md` and initial ADRs.

**Exit gate:** Page-to-API mapping, MVP feature scope and repo migration plan are documented; no unverified assumption about the existing frontend.

### Phase 1 — Backend foundation

**Goal:** Bootable NestJS application with repeatable development/verification workflows.

- [x] Initialize pnpm workspace and `apps/api` NestJS project (strict TypeScript).
- [x] Add configuration validation (`PORT`, `DATABASE_URL`, `SESSION_SECRET`, storage settings, CORS origins).
- [x] Configure PostgreSQL via Docker Compose with persistent local volume. (Runtime verification pending Docker availability.)
- [x] Configure TypeORM migrations; `synchronize: false` outside throwaway tests.
- [x] Implement common API response/error conventions and exception filter. (Error boundary implemented; data resources follow Phase 2.)
- [x] Add global input validation, whitelist and request body limits.
- [x] Enable OpenAPI documentation for non-production or protected environments.
- [x] Add structured logging and request/correlation IDs.
- [x] Add `GET /health/live` and `GET /health/ready` (DB readiness).
- [x] Set up unit/integration test harness with disposable real PostgreSQL. (Verified against isolated real PostgreSQL schemas.)
- [x] Set up CI: install, lint, typecheck, test, build, migration check. (Workflow configured; remote run not yet verified.)
- [x] Add `.env.example`, local setup instructions, seed/reset commands.

**Exit gate:** Fresh clone can run migrations, start API and pass all CI checks; readiness fails correctly when PostgreSQL is unavailable.

### Phase 2 — Game registry & character catalog

**Goal:** Public users can browse a real structured Stella Sora character catalog.

- [x] Define `Game` entity (`id`, `slug`, `name`, `status`, metadata).
- [x] Define `GameVersion` entity (`gameId`, `version`, `releaseDate`, `status`).
- [x] Define `Character` entity (`gameId`, `slug`, `name`, `rarity`, `element`, `role`, media references).
- [x] Define `CharacterAlias`, `CharacterStat`, `Skill` with explicit ordering and types.
- [x] Choose data model for game-specific `mechanics` JSONB and schema version.
- [x] Add unique constraints (`gameId`, `slug`), FKs and query-driven indexes.
- [x] Implement catalog read APIs with deterministic pagination and filters.
- [x] Implement internal create/update actions (trusted service interface only; HTTP mutations unavailable until Phase 3).
- [x] Implement seed/import fixture for a small set of *verified* characters. (Six reviewed profiles; no fabricated skills/stats/patches.)
- [x] Preserve provenance (`sourceUrl`, `verifiedAt`) where feasible.
- [x] Write integration tests: duplicate slugs, invalid relations, filter/sort/pagination.

**Initial API examples:**

```http
GET /api/v1/games
GET /api/v1/games/:gameSlug/versions
GET /api/v1/games/:gameSlug/characters?role=&element=&page=&limit=
GET /api/v1/games/:gameSlug/characters/:slug
```

**Exit gate:** API returns valid catalog data consumed by at least character list and detail pages; no raw hardcoded mock is required for those pages.

### Phase 3 — Admin identity & authorization

**Goal:** Protect all editorial and mutating operations by default.

- [x] Define `User`, `Role`, `Permission`, `UserRole`, `Session` (DB-backed).
- [x] Implement admin login/logout/session expiry and rotation.
- [x] Hash passwords with Argon2id (native Node 24.7+, fixed bounded parameters).
- [x] Apply HttpOnly, Secure, SameSite cookie settings appropriately.
- [x] Implement CSRF protection for cookie-authenticated state-changing requests.
- [x] Implement per-route permission guards and resource-level checks.
- [x] Support initial `ADMIN`, `EDITOR`, `REVIEWER` roles.
- [x] Implement login rate limiting and safe error messages.
- [x] Create admin account bootstrap procedure without storing credentials in repository.
- [x] Write auth tests for unauthorized access, revoked/expired session and privilege escalation.

**Exit gate:** Anonymous public GET works; anonymous/admin-ineligible mutations are denied; session protections and access checks pass automated tests.

### Phase 4 — Guide CMS, revisions & publishing (**MVP centerpiece**)

**Goal:** Editors manage real guides without deploying new source code.

- [x] Define `Content` (stable identity, game, slug, content type, author).
- [x] Define `ContentRevision` (version, structured editor JSON, author, timestamp).
- [x] Define `Publication` as the pointer to the currently published revision.
- [x] Define `ContentRelation` to link guides to characters/items/patches.
- [x] Choose Tiptap/ProseMirror-compatible rich content schema and sanitize rendered output.
- [x] Implement draft creation, revision editing, preview and validation.
- [x] Implement allowed state transitions: draft -> in_review -> approved -> published.
- [x] Implement rejection/return-to-draft and unpublish/archive.
- [x] Ensure published version remains visible while a newer draft is edited.
- [x] Enforce optimistic concurrency (`expectedRevision`/version) on writes.
- [x] Implement safe rollback by creating a new revision derived from an older one.
- [x] Persist publication transaction + audit entry atomically.
- [x] Keep admin previews authenticated and unindexable; never expose drafts in public APIs.
- [x] Build integration/E2E tests for transitions, conflicts, rollback and permission checks.

**Admin API examples:**

```http
POST  /api/v1/admin/contents
PATCH /api/v1/admin/contents/:id/draft
POST  /api/v1/admin/contents/:id/submit-review
POST  /api/v1/admin/contents/:id/approve
POST  /api/v1/admin/contents/:id/publish
GET   /api/v1/admin/contents/:id/revisions
POST  /api/v1/admin/contents/:id/restore
GET   /api/v1/games/:gameSlug/guides/:slug
```

**Exit gate:** Editor creates draft -> reviewer approves -> authorized actor publishes -> public page reflects correct revision; rollback works without losing history; concurrent edits cannot silently overwrite changes.

Implemented and verified through API/PostgreSQL and real web-server smoke tests. See `docs/phase-4.md`. Graphical admin UI and media remain Phase 5; no real staff or guides are seeded.

### Phase 5 - Media backend (implemented; frontend deferred)

- [x] Media metadata, SHA-256 for new uploads, validated image decoding/re-encoding and scoped upload permissions.
- [x] Private local/S3 adapters; published guide and character media access checks.
- [x] Media library pagination, usage inspection and character portrait/image associations with optimistic concurrency.
- [x] Retryable deletion with tombstones, database reference guards and historical revision protection.
- [x] Read-only storage inventory, 24-hour orphan inspection policy and bounded scans; no automatic object purge.
- [x] API/PostgreSQL integration and local/fake-S3 protocol tests.
- [ ] Deferred FE: media browser, character console, remaining public pages and SEO integration.
- [ ] Release environment: real private S3 bucket, production credentials/CA and public deployment verification.

The backend milestone is complete. The original full frontend MVP release gate is deferred, not claimed as passed.

### Phase 6 - Equipment, builds, tier lists and teams (backend implemented)

- [x] Equipment catalogue, category filtering, version checks, publication and archive.
- [x] Character builds with ranked equipment recommendations and slot validation.
- [x] Tier lists with scope, categories, ordered entries and editorial explanations.
- [x] Canonical teams and ordered members/roles; see `docs/teams.md`.
- [x] Separate immutable editorial revisions and game patch identifiers; restore preserves publication.
- [x] Scoped admin mutations, same-game database constraints and public dependency visibility checks.
- [x] Integration tests for publish, concurrency, invalid references and draft isolation.

### Phase 7 - Search and measured performance (backend implemented)

- [x] PostgreSQL full-text search across published characters, guides, equipment, builds and tier lists.
- [x] Character aliases, deterministic relevance ordering, kind filters and bounded pagination.
- [x] GIN indexes, reproducible EXPLAIN CLI and latency benchmark script.
- [x] Integration tests exclude draft/archived records and unpublished dependencies.
- [x] Baseline measured against 41 characters: 100 requests per endpoint, concurrency 5. Character list p50/p95/p99: 309.54/457.63/743.31 ms; search: 626.36/1018.89/1326.11 ms. Regression tests shared the DB server during this run, so this is not an isolated capacity benchmark.
- [x] Character FTS EXPLAIN baseline: planning 0.220 ms, execution 0.193 ms on this small dataset. Private artifacts: `.cache/backend-benchmark.json`, `.cache/search-plan.json`.

Redis response caching, TTLs and cache invalidation are conditional and not introduced without a demonstrated hot path. Search reads the transactional PostgreSQL index; no separate external reindex job is required. There is no before/after cache improvement claim.

### Phase 8 - Durable jobs, imports and patch review (backend implemented)

- [x] Transactional outbox and database triggers for publication, character, patch, strategy and media changes.
- [x] Separate BullMQ worker, bounded retries/backoff, expiring leases and Redis-loss reconciliation.
- [x] Database inbox makes effects idempotent; API writes do not depend on Redis availability.
- [x] Validated staging imports, idempotency keys, baseline conflict detection and atomic apply.
- [x] Immutable before/after patch diffs and review flags for affected guides/builds/tier lists.
- [x] Failed-event inspection/replay, review resolution, heartbeat metrics and graceful shutdown.
- [x] Real Redis integration and transactional PostgreSQL failure/concurrency coverage.

Search remains immediately consistent through PostgreSQL; review flags never rewrite editorial judgments. See `docs/jobs-and-imports.md` for commands and recovery behavior.

### Phase 9 - Observability and operational readiness (backend implemented)

- [x] Private ADMIN metrics for HTTP status/latency, editorial state, review backlog, outbox lag and workers.
- [x] Aggregate search/zero-result counters without raw queries, IP labels or analytics identifiers.
- [x] Structured request logs and request IDs; retention/pruning tooling with dry-run default.
- [x] Public read rate limiting, security headers, bounded proxy trust, CORS/CSRF and production TLS checks.
- [x] Snapshot-consistent backup and actual isolated restore, row-count/checksum verification and restored API smoke.
- [x] Deployment, migration, rollback, monitoring and recovery runbooks; API-only nonroot image and CI configuration.
- [x] 141/141 tests passed, including real Redis; typecheck, lint, formatter and migration drift checks passed.
- [x] Production dependency audit: zero known vulnerabilities after security updates.
- [ ] Deployment-specific verification: actual S3, production ingress/CA/least-privilege credentials, remote alerts and remote CI/container rollout. Docker daemon is unavailable locally, so no local image-build success is claimed.
- [ ] Deferred FE analytics integration and public page analytics provider provisioning.

Operational decisions: keep PostgreSQL publication state authoritative; keep Redis outside API write transactions; use at-least-once delivery with an inbox; retain additive migrations on application rollback. See `docs/backend-api.md`, `docs/jobs-and-imports.md` and `docs/deployment.md` for contracts and runbooks.

### Phase 10 — Optional long-term features

- [ ] Localization and translation review lifecycle.
- [ ] Community contributor submissions with moderation.
- [ ] Patch comparison UI and impact reports.
- [ ] Interactive team builder / verified damage calculator.
- [ ] Public third-party API access policy, quotas and versioning.
- [ ] Add a second game only after identifying where actual game-specific schema adapters are needed.

---

## 6. Initial ERD / entity checklist

**Identity:** `users`, `roles`, `permissions`, `user_roles`, `sessions`  
**Game catalog:** `games`, `game_versions`, `characters`, `character_aliases`, `character_stats`, `skills`, `teams`  
**Editorial:** `contents`, `content_revisions`, `publications`, `content_relations`  
**Media:** `media_assets`, `media_usages`  
**Operations:** `audit_logs`  
**Later:** `equipment`, `character_builds`, `tier_lists`, `tier_entries`, `outbox_events`, `import_batches`

### Schema rules

- [ ] Use stable IDs (UUID or equivalent) and human-readable slugs.
- [ ] Apply unique `(game_id, slug)` constraints for game-scoped resources.
- [ ] Add foreign keys, nullability rules and `ON DELETE` behavior explicitly.
- [ ] Model array ordering via `position` where the order matters.
- [ ] Store timestamps in UTC; format in client locale.
- [ ] Use migrations for every schema change and tested seed fixtures.
- [ ] Define `created_by`, `updated_by` and audit behavior for sensitive actions.
- [ ] Avoid storing HTML as untrusted executable markup; sanitize output.
- [ ] Determine patch applicability separately from editorial revision numbers.

---

## 7. API quality standards

- [ ] OpenAPI docs align with runtime validation and actual responses.
- [ ] All collection endpoints enforce sane pagination limits.
- [ ] Stable error shape with machine-readable code and request ID.
- [ ] DTO validation plus domain invariants; database constraints as final defense.
- [ ] Public endpoints reveal only published content and allowed metadata.
- [ ] Mutation endpoints require explicit permissions.
- [ ] Use transaction boundaries for publication and multi-entity consistency.
- [ ] Adopt optimistic concurrency on editor writes.
- [ ] Ensure media upload policies handle oversized/invalid/untrusted files.
- [ ] Add idempotency for retry-prone workflows when they are introduced.

---

## 8. Test & verification plan

| Layer | Test targets | Minimum evidence |
|---|---|---|
| Unit | Entity invariants, role checks, publishing transitions | Automated tests in CI |
| Integration | TypeORM mappings, migrations, unique/FK constraints | Tests using disposable PostgreSQL |
| API E2E | Auth, RBAC, catalog reads, draft/publish, rollback | Supertest scenarios |
| Security | Anonymous mutation, privilege escalation, draft leak, unsafe uploads | Negative test cases |
| Resilience (later) | Queue retries, idempotency, partial failures, Redis outages | Controlled failure injection |
| Performance (later) | Search, high-traffic GET endpoints, DB and cache | Recorded dataset, load profile, p95 |
| Operations | Clean install, migrate, seed, backup/restore, release rollback | Repeatable runbook |

**Definition of Done for every feature:**

1. API/DTO/schema and authorization rules are specified.
2. Implementation includes input validation, error handling and relevant indexes.
3. Unit or integration tests cover success and failure paths.
4. Swagger/README and migration/seed are updated where relevant.
5. Lint, typecheck, tests, build and `git diff --check` pass.
6. No secrets, unlicensed scraped articles or fabricated game data are committed.

**Useful verification commands (to implement/adjust to actual workspace scripts):**

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
git diff --check
```

---

## 9. Security and data governance checklist

- [ ] Never commit secrets; `.env.example` contains placeholders only.
- [ ] Least-privilege DB/storage credentials and separate production environment.
- [ ] TLS everywhere in production; secure cookie and CSRF settings.
- [ ] Password hashing, session invalidation, rate limiting and brute-force controls.
- [ ] RBAC enforced on server, not only through hidden admin buttons.
- [ ] No draft exposure through public search, caches, embeds or preview endpoints.
- [ ] Verify uploaded files and sanitize rich content.
- [ ] Store original content provenance and comply with game art/font rights.
- [ ] Establish analytics privacy disclosure and retention rules.
- [ ] Set sensible audit-log access and retention policies.

---

## 10. Release milestones

| Milestone | Phases | User-visible outcome | Portfolio evidence |
|---|---|---|---|
| M0: Technical foundation | 0–1 | Reproducible backend environment | Docker, CI, architecture ADR |
| M1: Playable catalog | 2–3 | Browse real character data; secure admin access | Relational schema, REST, RBAC tests |
| **M2: MVP launch** | **4–5** | **Create, review, publish and display game guides** | **Publishing transactions, revision history, E2E tests** |
| M3: Game guide depth | 6 | Equipment, tier lists, teams | Data integrity, filtered APIs |
| M4: Scale/read performance | 7–8 | Search, caching, patch-aware updates | Benchmarks, outbox, retries |
| M5: Production maturity | 9 | Analytics/monitoring and recovery | Real deployment and observability |

### Suggested next task

**Start with Phase 0:** audit the existing `stella-atlas` frontend export, inventory its pages and data shape, then lock an MVP OpenAPI contract. If the Work ZIP is not downloadable yet, source recovery/export is the first blocking item—do not assume the underlying files are available.

---

## 11. Progress tracking

> Checkboxes reflect verified work only. Backend phases remain unimplemented.

### Phase 0 audit — 2026-10-24

- Documents: `frontend-audit.md`, `architecture.md`, `api-conventions.md`, `adr/0001-preserve-static-export.md`.
- Verified from local JSON/filesystem: 41 characters, 8 guides, 54 HTML pages, 82 character image references with no missing files. Local font and license files are present.
- No modules or migrations implemented. No runtime/browser tests claimed.
- Remaining: independently verify font identity and artwork redistribution permissions; executable OpenAPI follows API DTO implementation.
- Next: Phase 1 backend foundation; `pnpm` is not yet installed/on PATH.

### Phase 1 foundation — 2026-10-24

- Implementation and verification details: `phase-1.md`; local commands: root `README.md`.
- Added `apps/api`, pnpm lockfile/workspace, Compose PostgreSQL, foundation migration/seed, common HTTP/configuration handling and CI.
- Typecheck, lint, production build, 11 unit/HTTP tests and Compose configuration validation passed locally.
- Exit gate remains open: Docker daemon unavailable; real PostgreSQL migration/E2E and GitHub CI execution unverified.

### Phase 2 catalog — 2026-10-24

- Implemented catalog module, six TypeORM entity mappings, migration `1792800001000-catalog`, reviewed seed fixture and API-backed directory/detail preview.
- Applied foundation/catalog migrations to the configured Supabase development database; idempotent seed produces 1 game and 6 characters.
- Verification: typecheck, lint, production build, 18 unit tests, 7 real PostgreSQL E2E tests, no schema drift, and live HTTP API/web smoke passed.
- Exit gate passed for character list/detail using database-backed API responses. Full roster import and production frontend migration remain outside this phase.
- Details and limitations: `docs/phase-2.md`; design decision: `docs/adr/0002-catalog-schema-and-preview.md`.
- Follow-up on Phase 1: real migration/E2E and startup/readiness are now verified on Supabase; local Docker startup and remote GitHub CI remain unexecuted.
- Next: Phase 3 admin identity and authorization.

### Phase 3 identity — 2026-10-24

- Added staff identity, database-backed sessions, Argon2id, CSRF/origin protection, shared login limits, RBAC, editor game/draft scope checks and protected catalog/staff administration.
- Migration: `1792800002000-identity`; applied to the configured development DB with no ORM schema drift. Initial policies: 3 roles and 6 permissions. No real admin was seeded because credentials were not supplied; `pnpm admin:bootstrap` is ready for local use.
- Verification: 29 unit tests and 13 real PostgreSQL E2E tests passed; typecheck, lint and production build passed. RLS tests deny Supabase anon/authenticated reads of identity/session data.
- Code style: Prettier configured for API source/tests/config; `pnpm format` and `pnpm format:check`, with CI enforcement.
- Full implementation details and deployment limits: `docs/phase-3.md`; decision: `docs/adr/0003-staff-sessions.md`.
- Next: Phase 4 guide CMS, revisions and publishing.

Update this file only after confirming code, tests and actual runtime results. For each completed phase, record:

```text
Phase:
Completed at:
Implemented modules:
Migration(s):
Verification commands + results:
Known risks / limitations:
Next phase:
```


### Phase 5 progress - wiki CMS and media

- `/admin/editor/` now includes a state-filtered, paginated content queue; canonical wiki subject/topic lookup; draft editing; review feedback; approval/publication/unpublication/archive actions; historical preview and restore; and the audit trail.
- Existing server permissions, different-author review and optimistic concurrency remain authoritative. Current publication and working revision are shown separately.
- Safe image upload, private/public reads and immutable revision references were implemented earlier; see `docs/guide-editor.md` for contracts and storage configuration.
- Browser verification uses two synthetic accounts and a disposable PostgreSQL schema, checks author self-review is disabled, return feedback, approval/publication to the real public preview page, historical restore preserving publication, and unpublish returning public 404.
- Historical checkpoint: media library/orphan handling were still pending at this stage. They are now implemented on the backend; character console/frontend expansion remain deferred, while real S3 and production release verification remain deployment checks.

### Backend-first completion - 2026-10-25

Migrations through `1792800015000-character-media` are applied to the configured development database with no ORM drift. No fabricated equipment/build/tier-list game advice was seeded. A private backup restored successfully into an isolated PostgreSQL 18 target; restored API checks retained 41 characters and found no application tables without RLS. Temporary test infrastructure is separate from the application database. Historical phase notes below/above remain a record of earlier checkpoints, not the current completion status.
