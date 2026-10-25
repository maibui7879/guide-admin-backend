# Backend deployment and recovery

This runbook covers the backend through Phase 9. Frontend hosting, contributor UI, third-party page analytics and public frontend SEO are deferred. Local verification is not evidence of a completed production rollout; record the environment, image digest, backup location and verification results for each real deployment.

For isolated staging setup, a free hosting option and real S3/API probes, see [staging verification](staging.md).

## Runtime and configuration

Use Node 24.7+ and pnpm 10.20.0. Build API with `pnpm build:api`. Container recipe: `docker build -f apps/api/Dockerfile -t atlas-api:<release> .`. The multi-stage image deploys only the API's production dependencies and compiled `dist`, runs as the nonroot `node` user, and probes readiness. It excludes local `.env`, `.git`, caches, media files and frontend assets. Pin the resulting image digest for a release.

Production requirements:

- `NODE_ENV=production`, a verified PostgreSQL TLS connection, HTTPS `API_ORIGIN`, explicit HTTPS `CORS_ORIGINS`, and a random `SESSION_SECRET` of at least 32 characters. Placeholder secrets and the development TLS bypass are rejected. Production connection code strips URL SSL overrides and enforces certificate verification; a URL cannot request `sslmode=disable` to bypass this.
- Supply the provider CA through the runtime's trusted CA configuration (`NODE_EXTRA_CA_CERTS` when appropriate). Validate it against the actual provider. The development certificate bypass remains development-only.
- `MEDIA_STORAGE_DRIVER=s3`, HTTPS `STORAGE_ENDPOINT`, private bucket, region and scoped credentials. Block unauthenticated bucket reads; all app reads pass through API authorization. Enable provider versioning/retention where supported. Back up both metadata and object storage with matching keys.
- Worker `REDIS_URL` uses `rediss://` in production. Put Redis on a private network with authentication, persistence and `noeviction`. Queue loss is recoverable from the outbox but increases processing lag. Run API and worker as separate supervised processes with bounded restart backoff.
- `PUBLIC_RATE_LIMIT_PER_MINUTE` defaults to 300 GETs per IP per process. Health/admin routes are excluded; login has a separate DB-backed limit. Enforce fleet-wide quotas at the trusted ingress. `TRUST_PROXY_HOPS` defaults to 0; set it only when all direct client access to the API is blocked and the proxy path has the stated fixed hop count. Arbitrary forwarded headers are not trusted by default.
- Use separate migration/admin and trusted backend credentials with the grants/policies appropriate to the deployment. The development owner connection is not a least-privilege production credential. New app tables have RLS and no anon/authenticated Data API policies. Do not expose the DB connection or privileged storage keys to clients.

Swagger UI/spec routes are disabled in production. Serve the reviewed exported OpenAPI artifact separately if needed; do not enable an administrative documentation endpoint accidentally.

## Release order and rollback

1. Run CI and review migrations, exported OpenAPI and dependency changes. Build the immutable runtime artifact before touching production.
2. Take and verify a DB backup and matching object-storage inventory/snapshot. Confirm restore access in a separate environment. Stop/drain workers for incompatible changes.
3. Run `node dist/cli/migrate.js` as a one-off migration job using the migration credential. Do not run migrations independently in every API replica. The CLI reports counts without printing connection values.
4. Start the API with `node dist/main.js`. Startup rejects pending migrations. Confirm `/health/live`, `/health/ready`, allowed CORS and cookie flags. Verify anonymous writes fail and drafts/unused media return 404/401 as documented.
5. Start workers with `node dist/cli/worker.js`. Confirm heartbeat/backlog metrics and a synthetic isolated job before opening traffic. Check the failure/replay procedure without replaying completed business events.
6. Verify published catalogue/wiki/strategy/search responses and media authorization. Keep the previous image available until the release is stable.

Prefer rolling back the application image while retaining backward-compatible additive migrations. A migration revert can drop new data, so do not blindly run `migration:revert` in production. If the old image is incompatible, stop writes and use the verified recovery plan against a separate database before switching endpoints. Publication state is PostgreSQL state, not Redis job state.

## Backup and restore test

`pnpm backup:db` writes a custom-format dump and JSON manifest under `.cache/backups` by default (gitignored). Set `BACKUP_DIR` to a protected backup location. Native mode requires matching PostgreSQL client binaries; `PG_DUMP_BIN`/`PG_RESTORE_BIN` can select explicit paths. Alternatives:

- `BACKUP_TOOL_MODE=docker`: official `postgres:17-alpine` client image by default; override `BACKUP_POSTGRES_IMAGE` to match the source major version. Requires a working Docker daemon. Only the backup directory and named PG environment variables are passed to the tool container.
- Windows `BACKUP_TOOL_MODE=wsl`, `BACKUP_WSL_DISTRO=Ubuntu`: use official client binaries installed in that distro. Paths must be on a local Windows drive. `WSLENV` passes PG settings without putting the database password in command arguments.

The dump uses an exported PostgreSQL snapshot held by a read-only transaction, so manifest counts and dumped rows have the same point in time. It covers `public` app schema only, not managed Supabase auth/storage schemas, cluster roles or the object binaries. Files are private by OS permissions where supported; encrypt and access-control backup storage before sending it off-machine. Failed dumps may leave a `.partial` artifact; never treat it as a completed backup.

For TLS with a custom provider CA, configure the appropriate native/WSL/container CA path and Node trust roots. Never reuse the development insecure override in production. The tool captures child stderr rather than printing connection details; inspect failures through an authorized operator.

Restore test:

1. Provision a separate empty database named `atlas_restore_*` and set `RESTORE_TEST_DATABASE_URL`. The tool refuses the source database, a different naming pattern, or a target containing user tables/views/sequences.
2. Run `pnpm backup:restore-test -- <dump-path>` (or `node scripts/backup-db.mjs restore-test <dump-path>`). It verifies SHA-256 before restoring in one transaction, then compares every public-table row count to the exported snapshot and runs ANALYZE.
3. Verify application migrations/readiness, RLS/permissions, publication/media relationships and sample public reads against the restored environment. Restore object storage separately and verify referenced object checksums.
4. Keep recovery artifacts, measured elapsed time and operator notes. A successful small local restore does not establish a production RTO for a larger dataset. Define and periodically rehearse the actual RPO/RTO and retention policy with the deployment owner.

Restores execute trusted SQL from a dump; use only reviewed artifacts and keep the target isolated. The automated restore test does not silently switch application endpoints or delete a source database.

## Monitoring and retention

`GET /api/v1/admin/operations/metrics` requires ADMIN (`users:manage`). It returns per-process HTTP status/latency buckets, editorial state counts, open review flags, outbox states, oldest pending age and fresh worker count. No query strings, client IP labels, DB URLs, storage keys or raw job errors are returned. Request logs include request ID, route template, status, duration and authenticated actor UUID, without credentials/body/cookies. Configure log access and retention at the collector; use these IDs to correlate application and worker observations.

Suggested alerts to tune against real workload: readiness failures; rising 5xx rate or p95; failed outbox events; pending age above five minutes; no fresh worker heartbeat while backlog exists; storage 503s; unexpected 401/403/429 spikes; import/review backlog. Do not invent a baseline or treat a single-process counter as fleet-wide telemetry. Forward logs/metrics to the deployment's monitoring system; no external analytics account is provisioned by this code.

`pnpm ops:prune` reports dry-run candidates. Explicit `--apply` removes at most 1000 records per table per invocation: sessions expired over 30 days, login-limit buckets older than a day, and worker heartbeats older than seven days. It does not delete users, editorial/audit history, import snapshots or outbox/inbox evidence. Schedule only after reviewing retention needs; keep an independent backup retention policy. Media cleanup uses the scoped library/delete API and protects all historical guide references.

## Verification boundaries

Local verification on 2026-10-25: 141/141 tests passed, including real Redis worker integration; typecheck and migration drift checks passed. The configured development database was backed up with a consistent snapshot and restored into an isolated PostgreSQL 18 database. Restored readiness, catalogue/search reads and anonymous admin rejection passed; 41 characters were retained and all restored application tables had RLS enabled. The production dependency audit reported zero known vulnerabilities after updating Sharp, the S3 SDK and vulnerable transitive packages. These results do not establish production capacity or a production recovery-time objective.

HTTP telemetry includes aggregate successful searches and zero-result counts without storing search terms or user identifiers. Counters reset on process restart. Use `pnpm media:inventory` for read-only object reconciliation; the report can contain private object keys and must stay outside source control.

CI runs typecheck, lint, format, unit/API tests, real PostgreSQL and Redis integration, build, OpenAPI consistency, migrations/seed/drift, a backup/restore rehearsal and runtime-image smoke. CI configuration alone is not a passing remote run. Local verification and infrastructure limitations are recorded in the roadmap. A real private S3 bucket, production CA, ingress, scoped credentials, remote monitoring/alerts and public rollout still require the actual deployment environment.
