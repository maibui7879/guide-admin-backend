# Durable events, imports and patch review

## Running workers

The API does not require Redis to accept transactional edits. The separate worker requires `REDIS_URL`. Local Compose: `docker compose --profile jobs up -d`; set `REDIS_URL=redis://localhost:6379/0`, then `pnpm worker:dev`. Compiled runtime: `node dist/cli/worker.js`. Production requires `rediss://`, private network access and Redis persistence/noeviction. BullMQ 5.61.2 and ioredis 5.8.2 are pinned; queue semantics follow the [official connection guidance](https://docs.bullmq.io/guide/connections).

PostgreSQL triggers capture guide publication/unpublication, character/child changes, patch releases and strategy publication changes in the source transaction. Character child events are deduplicated per character/type/database transaction. A rollback cannot leave a dispatchable event. Redis holds IDs, not the full import/editorial payload.

Dispatchers claim bounded batches with `FOR UPDATE SKIP LOCKED`, a UUID lease and 60-second expiry. They release DB locks before contacting Redis. Queue failures retry with bounded exponential delay; 20 exhausted dispatch attempts become a durable failure. A crash after enqueue but before marking dispatched can enqueue again, so handlers use a PostgreSQL inbox and commit side effects, inbox and completion atomically. Dispatcher state updates cannot overwrite a worker completion.

BullMQ retries handlers five times with exponential backoff. Final handler failures are persisted with a sanitized error code. Completed Redis jobs can be removed because PostgreSQL stores completion/idempotency evidence. Failed Redis jobs are bounded to 1000; failed DB events remain inspectable/replayable. Dispatched events not completed within five minutes are reconciled, allowing Redis data loss to be recovered from PostgreSQL. A replay retains the same event ID. Database inbox deduplication is authoritative, not Redis job retention.

Workers write a heartbeat and handle SIGINT/SIGTERM. Graceful shutdown drains active jobs; a forced termination leaves leases to expire. API startup and worker startup reject pending migrations. Stop workers before incompatible deployment/migration changes.

## Operations and review endpoints

- `GET /api/v1/admin/games/{gameId}/jobs?state=failed&page=1&limit=20`: ADMIN operational view, without raw stack traces/credentials.
- `POST .../jobs/{id}/replay`: ADMIN + CSRF; only failed events can be reset to pending.
- `GET .../review-flags?status=open|resolved`: authorized game staff.
- `POST .../review-flags/{id}/resolve` with `{note}`: review permission, game access, CSRF. Records actor/time/note; duplicate resolution returns 409.

Character changes flag related wiki pages, contextual guide links, teams and strategy references. Published patch releases flag the game's nonarchived editorial pages. Events older than a page's creation do not flag that new page. Processing never changes an author's body, tier judgments or publication pointer. A reviewer resolves flags explicitly. `game_content_versions` tracks idempotently processed domain-event generations for future derived consumers, not a cache TTL or an alternative source of publication truth.

Full-text indexes are transactionally maintained by PostgreSQL; there is no external search engine to reindex or active Redis response cache to invalidate. The event processor does not pretend to perform nonexistent external reindexing. Add handlers when an actual derived consumer is introduced.

## Import staging

All import mutations require `catalog:write` (ADMIN under current roles), game access and CSRF:

1. POST `/api/v1/admin/games/{gameId}/imports` with `{idempotencyKey,sourceUrl,gameVersionId?,records:[{id?,input}]}`. Maximum 10 records and the existing global 256 KiB body limit. Input reuses the strict character writer schema. Existing targets require explicit IDs; new targets must not already have the slug. No HTTP fetching of operator-supplied source URLs occurs.
2. GET the collection/detail to inspect the staged data and baseline, without altering the catalogue. Same normalized request/key returns the same batch; reusing a key for different input returns 409.
3. POST `.../imports/{id}/apply` with `{expectedVersion}`. Locks targets in UUID order and checks complete metadata/alias/stat/skill/progression baselines. All writes share the batch transaction. Conflict in any record rolls back every record, diffs and outbox events.
4. Applied batches are immutable. Retry with the original expected version returns the stored result without applying a second time. POST `.../cancel` terminates an unprocessed batch.

GET `/api/v1/admin/games/{gameId}/patch-diffs` exposes immutable before/after snapshots from applied imports. `gameVersionId` is patch applicability, not the editorial head/revision token. A new character has null `before`. Current uploaded-art assignments are separate editorial data and remain untouched by catalogue imports.

The existing pinned roster seed remains available and does not fabricate equipment, builds, tiers or patch releases. The importer applies explicitly supplied data; it is not an automatic third-party crawler or provenance verifier.

Real Redis integration is enabled when `TEST_REDIS_URL` is present; it uses a random private test queue and removes only that queue. CI provides a Redis service and runs retry tests. Local status and measured results are recorded in the backend verification section of the roadmap.
