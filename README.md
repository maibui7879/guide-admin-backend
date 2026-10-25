# Stella Atlas

NestJS modular-monolith catalog alongside the preserved `demo-ui/` export. Requires Node.js 24, pnpm 10.20.0 and PostgreSQL (local Docker or a configured hosted database). Python 3 is required for the catalog web preview.

## Backend deployment on Render

This backend repository uses `apps/api/Dockerfile` with the repository root as Docker build context. See [Render setup](docs/render.md), [staging and private S3 checks](docs/staging.md) and [production/recovery](docs/deployment.md). Configure secrets in the hosting dashboard; `.env`, backups and uploaded media are excluded from Git.

## Local setup

1. Install pnpm (`npm install --global pnpm@10.20.0`). On PowerShell with blocked scripts use `npm.cmd` / `pnpm.cmd`.
2. Copy `.env.example` to `.env`; replace the session secret with at least 32 random characters.
3. Run `pnpm install --frozen-lockfile`.
4. Run `docker compose up -d --wait`.
5. Run `pnpm migration:run` and `pnpm seed` (foundation metadata and the pinned 41-character roster; existing edits are preserved — see [character seed](docs/character-seed.md)).
6. Run `pnpm dev`; visit `http://localhost:3000/health/live`, `/health/ready`, `/docs` or `/docs-json`. Swagger is disabled in production.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm migration:check`. For PostgreSQL integration tests set `TEST_DATABASE_URL` to a disposable database then run `pnpm test:e2e`. Tests create an isolated randomly named schema and drop that schema afterwards; they fail explicitly if no database URL is supplied.

For a local reset, run `pnpm migration:revert`, `pnpm migration:run`, `pnpm seed`. Reverting the foundation migration deletes platform metadata; use only on disposable local data. Never reset the persistent Docker volume to apply routine migrations. No automatic migrations or TypeORM synchronization run on startup. Production runs `node apps/api/dist/main.js` after building; inject environment through the deployment runtime, run migrations as a separate release step.

The API exposes health endpoints and published game/version/character catalog reads under `/api/v1/games`. Staff authentication and protected catalog writes are available under `/api/v1/admin`; Guide CMS is implemented in Phase 4; backend media and phases 5-9 are documented below. Readiness issues a bounded database query; database failure after startup returns 503 while liveness remains 200. Startup requires an initial database connection. Requests have structured completion logs, request IDs, bounded JSON bodies, strict DTO validation, security headers and explicit CORS origins.

See [audit](docs/frontend-audit.md), [architecture](docs/architecture.md), [API contract](docs/api-conventions.md) and [roadmap](docs/roadmap%20(1).md). Framework references: [NestJS](https://docs.nestjs.com/first-steps), [TypeORM migrations](https://typeorm.io/docs/advanced-topics/migrations/).

Development TLS override: set `DATABASE_SSL_INSECURE=true` in your local `.env` to temporarily skip database certificate verification while retaining encrypted TLS. This flag is rejected outside `NODE_ENV=development`. Remove it or set it to `false` to restore verification. It applies to API, migrations and seed connections.

Catalog preview: run `pnpm dev:web` with the API running, then open `http://localhost:3001/characters/`. Character list/detail and guide list/detail pages read PostgreSQL-backed API data; other demo pages remain static. See [Phase 2](docs/phase-2.md) for schema, provenance and test details.

Swagger documents success/error schemas, nullable fields, pagination, examples and request tracing for every implemented endpoint. UI: `/docs`; JSON: `/docs-json`; YAML: `/docs-yaml` (non-production only). Run `pnpm openapi:export` to regenerate `docs/openapi.json` without database access. See [Swagger reference](docs/swagger.md).

Staff authentication and protected catalog writes are implemented in Phase 3. After migrations, supply `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` locally and run `pnpm admin:bootstrap`, then remove those variables. No real account is seeded. See [Phase 3](docs/phase-3.md) for login/CSRF flow, roles, game grants, cookie behavior and production settings. Node 24.7+ is required for native Argon2id.

Code style: `pnpm format` formats API source/tests/config using Prettier; `pnpm format:check` checks formatting in CI. Generated OpenAPI, demo files and local secrets are excluded.

Commits automatically run Prettier/ESLint on staged files, lint the API, then run all Jest unit tests through Husky. Run `pnpm precommit` manually for the same checks. See [code structure and commit checks](docs/code-structure.md) for folder responsibilities and hook setup.

Guide CMS and publishing are implemented in [Phase 4](docs/phase-4.md): authenticated drafts, immutable revisions, independent review, optimistic concurrency, restore, atomic publication/audit and public guide pages. Run migrations and restart the API, then open `/guides/` on the web preview. The directory starts empty until staff publish a guide. An experimental editor exists; further frontend work is deferred.

Canonical Team catalog CRUD is available: one Main and two Supports, stable UUID, duplicate-lineup prevention, scoped permissions, version checks and archive-based deletion. See [Team API](docs/teams.md). Team-linked guide revisions and shareable game presets are separate follow-up work.


Wiki page identity and duplicate prevention: [wiki-identity](docs/wiki-identity.md).

Rich guide editor, uploads and image storage: [guide-editor](docs/guide-editor.md).


Backend-first scope through Phase 9: [backend API](docs/backend-api.md), [jobs/imports](docs/jobs-and-imports.md), [deployment/recovery](docs/deployment.md). Equipment, immutable builds/tier lists, published-only search, scoped media/character art, durable outbox/BullMQ and private metrics are implemented. Run migrations before starting the updated API.

The worker is a separate process requiring REDIS_URL: `pnpm worker:dev`. Backend build: `pnpm build:api`. Measurements: `pnpm benchmark:api`, `pnpm search:explain`. Maintenance: `pnpm ops:prune` defaults to dry-run. Read the recovery runbook before restoring a database.
