# Character seed

Run `pnpm seed` to import the checked-in, offline Stella Sora snapshot. Run `pnpm seed:refresh [full-commit-sha]` to regenerate it from AutumnVN/ss-data; without an argument it uses the current pinned commit. Refreshing the fixture does not update existing database records automatically.

The snapshot contains all 41 entries in released character.json at commit e60497ad182eca47538726f724feb89f72393547. It includes names, rarity, element, role, attack type, voice credits, local artwork references, level-one stats, four English skill descriptions, ordered talent boost groups and all five potential categories. Source SHA-256 digests, source IDs and the repository revision are recorded. Database UUIDs remain internal; source-ID mappings are saved in platform_metadata.

Only untouched records from the original six-character fixture are upgraded. Their UUIDs remain stable. Existing imported records and manually edited records are preserved. For published records with the exact pinned source URL, empty talent/potential collections are backfilled independently; existing nonempty collections are never replaced by seed. A manually cleared collection can therefore be filled by a later seed run. Each character write locks and checks the current record inside its transaction; interrupted imports can be rerun.

Percentage stat values use percentage points (5 means 5%). Firstlight Noya has no DEF value in the source, so no DEF row is invented. Higher-level stat rows contain repeated levels with no explicit ascension stage and are not flattened. Talent groups retain each ordered boost and its name/description/parameters. Potentials retain their upstream ID, category, name, description, parameters, hidden parameters, icon identifier, rarity and corner. Icon identifiers are not asset URLs. No graph edges or unlock requirements are inferred where the source does not provide them. Skill parameter progressions are preserved as text, without assuming a skill level. This is a complete roster for the pinned snapshot, not a claim that all game mechanics or future releases are imported.

The source is community-maintained. Asset ownership remains with the original rights holders. Artwork uses existing demo-ui assets; the refresh command checks that all referenced files exist.

Verified import result: 35 new characters, 6 untouched legacy characters upgraded with UUIDs preserved; 41 characters, 164 skills and 286 level-one stat rows. A second run preserved all 41 records and all skill UUIDs. Public catalog returned HTTP 200 with total 41; Firstlight Noya returned four skills and six available stats.

Validation before progression extension: 70 unit tests; an isolated PostgreSQL integration test covering legacy upgrades, manual-edit preservation and idempotency; TypeScript, ESLint, Prettier and API build checks.

## Talent and potential API

Migration `1792800006000-character-progression` adds `character_talents` and `character_potentials`, with cascading character foreign keys, unique position/source-ID constraints and RLS enabled. Talent boosts and parameter arrays use validated JSONB to retain ordered, mixed string/number values; the character relationship and potential categories remain relational.

`GET /api/v1/games/{gameSlug}/characters/{slug}` returns `data.talents` and `data.potentials`, always arrays ordered by zero-based `position`. Unknown data is an empty array. The character list response stays compact. Draft characters and archived games remain inaccessible through the public detail endpoint.

The protected character create/replace endpoints accept both collections. Omitting a collection preserves it on update; an explicit array replaces it, and `[]` clears it. Aliases/stats/skills retain their existing replacement behavior. Parent and child writes are atomic. Malformed categories, duplicate non-null potential source IDs and invalid nested values produce the existing validation error envelope. Swagger and `docs/openapi.json` include nested request/response schemas.

Run migrations before seed: `pnpm migration:run`, then `pnpm seed`. The pinned fixture includes 205 talent groups and 1,189 potentials across 41 characters. Raw parameter progressions remain available as arrays; readable descriptions remove game color markup and expand ordinary/hidden parameter references into labeled values without inventing a level.

Progression import verified against the live API: all 41 public character details return 205 talent groups, 2,255 boosts and 1,189 potentials in total. The backfill preserved all existing character records and skill UUIDs. A repeat seed reported zero new/backfilled records and preserved every progression UUID. Both new tables have RLS enabled; ORM/migration drift check returned zero queries.

Final validation after the progression extension: 79 unit tests passed. All 34 E2E cases passed across the initial successful seed/database suites and the rerun of the 32 catalog/auth/teams/guides cases after updating rollback targets. Typecheck, ESLint, Prettier, API build and OpenAPI export passed. The live API was restarted with the updated build.
