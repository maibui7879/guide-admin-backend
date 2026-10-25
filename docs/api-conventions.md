# Initial API contract — Phase 0

Status: public catalog reads implemented in Phase 2; staff identity and protected catalog/user administration implemented in Phase 3. Guide CMS, immutable revisions, publishing and public guide reads are implemented in Phase 4. Base path `/api/v1`. JSON property names use camelCase; route names use kebab-case. UUIDs identify persisted records; slugs identify public resources within a game.

## Public resources

| Method | Route | Query / result |
| --- | --- | --- |
| GET | `/games` | Paginated active games |
| GET | `/games/{gameSlug}/versions` | Paginated public patch metadata |
| GET | `/games/{gameSlug}/characters` | `q`, `element`, `rarity`, `page`, `limit`; sort by name then ID |
| GET | `/games/{gameSlug}/characters/{slug}` | Published character detail; unknown/unpublished returns 404 |
| GET | `/games/{gameSlug}/guides` | `category`, `page`, `limit`; sort by publishedAt descending then ID |
| GET | `/games/{gameSlug}/guides/{slug}` | Current published revision only; unknown/unpublished returns 404 |

Collection responses: `{ "data": [], "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 } }`. Detail responses: `{ "data": {} }`. Page defaults to 1, limit to 20 (maximum 100). Reject invalid/unknown parameters with 400. `q` is trimmed, at most 100 characters. Elements: Ignis/Aqua/Ventus/Terra/Lux/Umbra; rarity: 4 or 5 for the initial game. Missing optional fields return null or empty arrays consistently.

Character summary fields: `id`, `slug`, `name`, `element`, `rarity`, `portraitUrl`. Detail adds `imageUrl`, nullable `voice`, nullable `role`, `skills: []`, `stats: []`, and `sources: [{url, verifiedAt}]`; verification time may be null. Missing skills/stats mean unavailable, not zero values.

Guide summary fields: `id`, `slug`, `title`, `description`, `category`, `readingMinutes`, `publishedAt`. Category is exactly one of `character`, `team`, `boss`, `general`, `beginner`, `combat`, `progression`; other values and casing are rejected on writes and category filters. Detail adds `revision`, `schemaVersion`, safe server-rendered `html`, `body` (versioned, validated structured editor document), nullable `gameVersion` and `sources`. Renderer uses the bounded Tiptap-compatible schema described in Phase 4; arbitrary HTML is not accepted.

## Identity and editorial resources

| Method | Route | Permission / behavior |
| --- | --- | --- |
| POST | `/admin/auth/login` | Rate-limited credentials; create session cookie |
| POST | `/admin/auth/logout` | Invalidate session; CSRF protected |
| GET | `/admin/auth/session` | Current identity and permissions |
| POST | `/admin/contents` | Editor; create stable identity and initial draft |
| PATCH | `/admin/contents/{id}/draft` | Editor + resource check; expectedRevision required |
| GET | `/admin/contents/{id}/preview` | Authenticated authorized preview; no-store, noindex |
| POST | `/admin/contents/{id}/submit-review` | Editor; expectedRevision required |
| POST | `/admin/contents/{id}/approve` | Reviewer; exact submitted revision |
| POST | `/admin/contents/{id}/return-to-draft` | Reviewer; reason and expectedRevision |
| POST | `/admin/contents/{id}/publish` | Admin; approved revision and expectedRevision |
| POST | `/admin/contents/{id}/unpublish` | Admin; expectedRevision |
| GET | `/admin/contents/{id}/revisions` | Authorized staff; paginated |
| POST | `/admin/contents/{id}/restore` | Editor; sourceRevision + expectedRevision; new draft |

Character mutations, user management and upload DTOs will be added with their phases; no anonymous write route is allowed as a temporary shortcut. All successful creation requests return 201; other successful operations return 200, except logout returns 204. Authentication/session responses are never cached.

Errors: `{ "error": { "code": "CONFLICT", "message": "Content has changed", "requestId": "...", "details": [] } }`. Use 400 validation, 401 unauthenticated, 403 denied, 404 unavailable, 409 duplicate/conflict, 413 oversized request, 429 rate limited. Do not expose SQL, stack traces, credentials or drafts in errors. UTC timestamps use ISO 8601. All responses carry `X-Request-Id`.

Health paths are outside versioned resources: `GET /health/live` and `GET /health/ready`; readiness returns 503 when the database is unavailable. Generate executable OpenAPI from validated NestJS DTOs in Phase 1/2 and check it against this resource map.

Phase 3 implemented identity paths also include GET `/admin/auth/csrf`, POST `/admin/auth/rotate`, POST `/admin/users`, PUT `/admin/users/:userId/roles`, PUT `/admin/users/:userId/games`, POST `/admin/games`, POST `/admin/games/:gameId/versions`, POST `/admin/games/:gameId/characters`, and PUT `/admin/games/:gameId/characters/:id`. All non-public mutations require the session cookie, current CSRF header and allowed Origin. See [Phase 3](phase-3.md) and generated [OpenAPI](openapi.json) for exact DTOs/statuses.

Phase 4 adds GET `/admin/contents?gameId=<uuid>&state=in_review`, POST `/:id/archive`, GET `/:id/revisions/:revision` and GET `/:id/audit` under the content resource. Every content mutation after creation requires `expectedRevision` equal to the latest content **version**, separate from `currentRevision` (body snapshot). Admin responses are no-store/noindex. See [Phase 4](phase-4.md) for states, review separation and restore semantics.

Team catalog adds public GET `/games/:gameSlug/teams` (pagination and `characterId`)
and `/games/:gameSlug/teams/:slug`. Staff CRUD lives at `/admin/games/:gameId/teams`
(GET/POST) and `/:id` (GET/PUT/DELETE). PUT/DELETE require `expectedVersion`; DELETE
archives and returns the updated record with status 200. See [Team contract](teams.md).
