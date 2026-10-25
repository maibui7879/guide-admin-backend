# Phase 2 — Game registry and character catalog

## Implementation

- Catalog module with six TypeORM entities: Game, GameVersion, Character, CharacterAlias, CharacterStat and Skill.
- Migration `1792800001000-catalog`: UUID identities, game-scoped unique slugs, foreign keys with cascade deletion, ordered child records, status/element/rarity/mechanics checks and catalog indexes.
- RLS enabled for catalog tables, platform metadata and TypeORM migration history. There are no anonymous Supabase Data API policies. Public REST reads explicitly filter active games and published records.
- Internal writer supports game/version creation and atomic character create/update with child replacement; no HTTP mutation endpoint is registered.
- Mechanics schema v1 supports optional attack type; adding another version requires an explicit schema change. Character aliases are searchable. Stats record a level and numeric value. Skills record kind, text and position.
- APIs: `GET /api/v1/games`, `GET /api/v1/games/:gameSlug/versions`, `GET /api/v1/games/:gameSlug/characters`, `GET /api/v1/games/:gameSlug/characters/:slug`.
- Collections use page/limit (default 1/20, maximum limit 100 and page 1,000,000). Character filters: literal name/alias substring `q`, element, rarity and role; name then UUID ordering. Versions order by release date descending (null last), then UUID. Unknown query parameters are rejected.
- `apps/web/server.py` renders character directory/detail pages directly from the API, retaining recovered visual assets and favorites. The original demo files are unchanged. Home/guides/tier-board pages remain the original static demo in this preview.

## Reviewed seed

Fixture: `apps/api/src/database/fixtures/stella-sora.json`. Name, rarity, element, class and attack type were cross-checked on 2026-10-24 against these profile pages:

- [Allie](https://www.kaiden.gg/stella-sora/characters/allie/)
- [Chitose](https://www.kaiden.gg/stella-sora/characters/chitose/)
- [Eleanor](https://www.kaiden.gg/stella-sora/characters/eleanor/)
- [Firstlight Noya](https://www.kaiden.gg/stella-sora/characters/firstlight-noya/)
- [Fuyuka](https://www.kaiden.gg/stella-sora/characters/fuyuka/)
- [Shia](https://www.kaiden.gg/stella-sora/characters/shia/)

The verification timestamp is date-granular (UTC midnight denotes the review date, not an exact review time). Voice credits, artwork permissions and combat data have not been newly verified. No third-party skill/build prose was copied. No patch version was fabricated. Only these six entries are seeded; the full 41-character demo is not claimed as verified.

## Run

From the root: `pnpm migration:run`, `pnpm seed`, `pnpm dev`. In another terminal: `pnpm dev:web` (Python 3 required). Open `http://localhost:3001/characters/` or `/characters/allie/`. `API_URL` defaults to `http://127.0.0.1:3000`; `WEB_PORT` defaults to 3001.

For integration tests set `TEST_DATABASE_URL` explicitly and run `pnpm test:e2e`. Local `.env` loads before Jest so the development-only TLS override remains development-scoped. Tests create/assert an isolated random schema, never reset public data, and drop only their own schema. Remote Supabase tests additionally check that `anon` and `authenticated` cannot read catalog rows even when temporarily granted SELECT. Local PostgreSQL CI checks schema RLS flags when those Supabase roles do not exist.

## Verification record — 2026-10-24

- Typecheck, ESLint and production TypeScript build passed.
- Unit/HTTP suites: 18 tests passed.
- Real Supabase PostgreSQL E2E: 7 tests passed, including duplicate/FK validation, combined filters, stable pagination, hidden drafts, atomic failed updates, migration rollback/reapply and zero ORM schema drift.
- Supabase `anon` and `authenticated` read attempts returned zero catalog rows under RLS, even with temporary SELECT grants in isolated test schemas. Those grants were rolled back.
- Applied foundation and catalog migrations to the configured development database; seed rerun without duplicates (1 game, 6 characters). No real patch identifiers or combat data were seeded.
- Live HTTP smoke checks passed: liveness/readiness, filters, Swagger resource paths, six-character directory, Allie detail, missing-character 404, CSS/artwork and preservation of existing favorite names. Browser rendering/interaction has not been visually tested.
- `tsx` encountered a Windows `uv_os_get_passwd` error; database seed/check scripts now use the already working `ts-node` runtime.
- GitHub CI has been configured but not executed remotely. Local Docker daemon remains unavailable; PostgreSQL verification used the configured Supabase development database.

## Limits

The preview is a standard-library development HTTP server bound to localhost, not a production host. API catalog reads are published-only; editorial revision publishing still belongs to Phase 4. The six-record fixture is not a complete roster. Internal writer access currently depends on trusted process/database access until Phase 3 adds authenticated admin routes. Temporary development certificate bypass remains enabled locally per the user's request; production rejects it.
