# Wiki page identity

Guides remain in `contents`; immutable bodies, contextual relations, review and publication continue to use their existing tables. `contents.id` is the stable UUID of the wiki page. Previously, only `(game_id, slug)` was unique, so changing a slug allowed duplicate pages about the same subject.

New pages require `wiki` at creation:

```json
{
  "wiki": {
    "kind": "character",
    "characterId": "03d6b90a-69ca-43bb-80a4-5dbff11b8e78",
    "topic": "build"
  }
}
```

Use `kind: "team"` with `teamId`, or `kind: "game"` without a target ID. `topic` defaults to `overview`; accepted values are `overview`, `build`, `strategy`, `beginner`, `combat`, `progression`, `boss`. These are controlled page purposes, not arbitrary slugs. There is no Boss entity yet: `game` + `boss` represents the game's general boss guide, not a fabricated boss UUID. Individual boss pages need a future Boss model.

The unique identity is **game + subject kind/UUID + topic**, independent of author, slug, category, game patch and revision. Category remains editable editorial metadata; changing it does not create another wiki identity. Different recognized topics represent distinct pages. Contextual `characterIds` in a revision are separate from the immutable primary wiki subject.

Migration `1792800007000-wiki-identity` adds `wiki_kind`, `wiki_topic`, `wiki_character_id`, `wiki_team_id` to `contents`. Shape/topic CHECK constraints reject missing or contradictory targets. Composite foreign keys enforce that characters and teams belong to the page's game. Partial unique indexes reserve each identity in every state, including draft and archived. Concurrent duplicate creation is rejected by PostgreSQL and becomes HTTP 409. The existing game/slug uniqueness remains.

A DB trigger prevents changes to the subject, topic or game after creation. Draft/revision commands reject `wiki` as an unknown field. To improve a page, append a revision to its existing content UUID. Archiving does not free its identity. This change does not add community edit proposals or a page merge/reassignment workflow.

Admin create/list/preview/command responses and public guide list/detail responses include a `wiki` descriptor with `kind`, `topic`, nullable `characterId`/`teamId`, and a canonical `key` scoped to the response's game. A character key looks like `character:<uuid>:build`; a game key looks like `game:game:overview`. Keys remain stable across editorial changes. Swagger and `docs/openapi.json` describe all fields and conflict behavior.

Creating drafts permits existing draft subjects. Publication requires the primary character, or the team and all three members, to be published. Public queries recheck subject availability so an unpublished character/team or team member cannot leave a public wiki page visible. Existing role/game authorization, immutable revision history and publication pointers remain in force.

For pre-wiki data, the migration maps an unambiguous character guide with exactly one character relation to that character's overview page. Game-level categories map to their matching controlled topic (general maps to overview). Existing team guides, ambiguous character targets and duplicate inferred identities stop the migration transaction for explicit reconciliation. It never chooses an author, deletes a duplicate or rewrites revision history. The development DB contained no guides when this migration was applied. Downgrading this migration removes the new identity columns and indexes; preserve identity mappings before any planned downgrade of a populated wiki database.

Validation: 82 unit tests and all 17 PostgreSQL guide E2E cases passed, including concurrent duplicate requests, archived reservations, cross-game FK checks, immutable identity, team publication visibility, legacy backfill and duplicate-legacy rollback. Typecheck, ESLint, Prettier, API build and OpenAPI export passed. The migration is applied in development with zero ORM drift; the live Swagger requires wiki on creation, guide listing responds successfully and the 41-character catalog remains intact.
