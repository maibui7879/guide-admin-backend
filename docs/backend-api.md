# Backend API through Phase 9

Frontend work is deferred by user decision. Existing preview/editor files are retained. The API is a NestJS modular monolith with PostgreSQL as source of truth; no community registration or contributor proposal workflow is added. Existing staff sessions, CSRF, permissions and game grants apply to new admin endpoints. Public routes reveal published records only. Swagger `/docs` and exported `openapi.json` describe inputs, response envelopes, errors and pagination.

## Media library

- `GET /api/v1/admin/games/{gameId}/media?usage=all|unused|referenced|deletion_pending&page=1&limit=20`
- `GET /api/v1/admin/media/{id}/usages`
- `DELETE /api/v1/admin/media/{id}`: publisher permission, CSRF and game scope; empty 204 on completion. Referenced media returns 409, including historical guide/cover references and current character assignments. A completed deletion returns 404 on subsequent DELETE.

Uploads remain server-side, decoded and re-encoded as WebP. SHA-256 covers stored bytes; legacy assets have null checksum rather than a fabricated backfill. Library responses omit storage keys, credentials and bucket URLs. Image alt/caption belong to editorial revision/character usage rather than to the shared asset.

Deletion acquires the asset lock and commits a tombstone before removing the object outside the transaction. Validation and database triggers prevent new references to a tombstone. Storage failure returns 503 with metadata retained; retry the same DELETE ID. Missing local objects are safe to delete again. An interruption after object removal is also retryable. There is no automatic bulk purge. Operators should inspect unused assets and allow at least 24 hours for interrupted editor sessions before selecting deletion candidates. Object-only orphans from a failed upload compensation require private bucket/local inventory reconciliation; never infer deletion solely from public visibility.

Character art is a separate subresource so existing catalogue contracts and source-image URLs stay compatible:

- `GET /api/v1/games/{gameSlug}/characters/{slug}/media`: uploaded portrait/illustration descriptors, with existing catalogue URLs as fallback. Published character and active game required.
- `GET /api/v1/admin/games/{gameId}/characters/{id}/media`: includes the current association `version` (0 before first assignment).
- `PATCH` the same admin route: `{expectedVersion, portraitMediaId, imageMediaId, portraitAlt, imageAlt}`. Full replacement; omitted IDs clear uploaded assignments. Same-game available assets and alt text are required. Editors can only change draft characters; published/archived characters require `catalog:write`.

Public image-file access checks either a current guide publication or a published character assignment. Assignments to draft/archived characters do not make an image public. Removing an association does not remove its object. Historical guide references still prevent deletion. Catalogue import does not overwrite character-art associations.

## Equipment

Public resources: `GET /api/v1/games/{gameSlug}/equipment` and `/{slug}`. Filter the collection by `category=disc|weapon|armor|accessory` with standard page/limit. Unknown fields, including public status requests, are rejected.

Admin resources under `/api/v1/admin/games/{gameId}/equipment`:

- GET collection or `/{id}` includes drafts and supports `status` filtering.
- POST creates a draft; slug is immutable and unique within the game.
- PATCH `/{id}` replaces fields with `expectedVersion`, increments the token and returns the record to draft.
- POST `/{id}/publish` or `/{id}/archive` uses `{expectedVersion}`. Publication/archive requires `content:publish`; archive is terminal.

Fields include name, category, rarity 1–6, description, image/source HTTPS URLs and nullable verification timestamp. No fabricated equipment seed or recommendations are supplied. Editing/archiving equipment makes dependent public builds unavailable until their references are published again.

## Character builds and tier lists

Public collections/details:

- `/api/v1/games/{gameSlug}/builds[/{slug}]`
- `/api/v1/games/{gameSlug}/tier-lists[/{slug}]`

Admin equivalents use `/api/v1/admin/games/{gameId}/...`. GET reads the latest working snapshot. POST creates a draft; PATCH `/{id}/draft` creates a new immutable revision. GET `/{id}/revisions` lists immutable snapshots. POST `/{id}/publish|unpublish|archive|restore` changes the working/publication state. Every mutation after create requires `expectedVersion`; restore additionally requires `sourceRevision`.

Build creation includes an immutable character UUID and slug. Payload contains title, description, nullable `gameVersionId`, and ordered recommendations `{equipmentId, slot: main|support|alternative, rank, notes}`. Rank and equipment cannot repeat within a slot. Tier-list payload contains title, description, nullable patch UUID, explicit scope and ordered categories `{key,title,entries:[{characterId,explanation}]}`. Category keys and character placements must be unique, with 1–500 total entries.

Head version, editorial revision and game patch UUID are different values. Composite foreign keys enforce same-game references. Public reads follow the publication pointer and require published equipment/characters/patch. Editing/restoring a later draft leaves the prior public snapshot visible. Unpublish removes that pointer; archive is terminal. Public responses omit working-copy version/revision metadata. Structured strategy publication uses the catalogue publisher policy; independent guide review remains unchanged.

Strategy revisions, relationship snapshots and audit entries are append-only. This module deliberately uses SQL repositories/migrations for the normalized strategy tables; TypeORM does not auto-synchronize them. Migration tests, foreign keys and API tests cover their shape. ORM drift checks additionally cover mapped catalogue/CMS entities and migration-managed search indexes.

## Published search

`GET /api/v1/games/{gameSlug}/search?q=...&kind=all|character|guide|equipment|build|tier_list&page=1&limit=20`

Queries are 2–100 trimmed characters and use PostgreSQL `websearch_to_tsquery('simple', ...)`, including phrase syntax. Character aliases participate. Results contain kind, ID, slug, title, description, rank and a public API path. Order is rank descending, kind, slug, UUID. Counts/results use one repeatable-read snapshot.

GIN expression indexes match query expressions on names, aliases, guide text, equipment text and strategy payload. Publication joins remain authoritative: draft, archived, unpublished and unavailable dependencies cannot appear through a status parameter, older snapshot request or stale external index. Search is no-store. No Redis search cache was introduced without a measured hot path. Fuzzy/trigram matching and language-specific stemming remain extensions requiring quality/performance evidence.

Read-only measurement tools: `pnpm benchmark:api` and `pnpm search:explain`. Benchmark output records p50/p95/p99, concurrency, request counts, status distribution and date; it does not assert production capacity. Small datasets can legitimately select sequential scans despite GIN indexes.

`pnpm media:inventory` compares storage objects against database metadata without deleting anything. Its private report defaults to `.cache/media-inventory.json`; override `MEDIA_INVENTORY_REPORT` to choose another protected path. It inspects at most 10,000 objects and explicitly marks truncated scans; missing-object results are withheld for truncated scans. Object-only files older than 24 hours are inspection candidates, not authorization to delete. Recheck references and retain a backup before any manual cleanup. The S3 identity needs list permission in addition to normal object access.

See [jobs and imports](jobs-and-imports.md) and [deployment/recovery](deployment.md) for Phase 8–9 workflows and remaining release checks.
