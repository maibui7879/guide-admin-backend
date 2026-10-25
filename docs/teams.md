# Team entity and CRUD

A Team is a canonical catalog record with a stable UUID, game, slug, name,
description, draft/published/archived status, concurrency version and timestamps.
It represents one Main character plus exactly two distinct Support characters.
The current schema models Stella Sora's three-character lineup explicitly rather
than accepting an arbitrary number of members. Preset codes, guide bodies and
editorial revision history are separate resources; this change does not implement
a preset decoder or attach team IDs to guide revisions yet.

Supports are normalized to lowercase UUIDs and sorted by UUID. The same game/Main/
Support pair is unique, including archived records, even when the submitted support
order is reversed. Changing Main creates a different role assignment. Alternative
strategies for the same lineup should become presets or sections of the team's
wiki page, rather than duplicate Team identities. Admins can restore archived
identities using PUT. Slugs are unique within a game; updates preserve UUID/game.

## Routes

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/v1/games/:gameSlug/teams` | Published list, name/UUID sort, pagination, optional `characterId` |
| GET | `/api/v1/games/:gameSlug/teams/:slug` | Published detail with three member summaries |
| GET | `/api/v1/admin/games/:gameId/teams` | Authorized staff list, including drafts/archives; optional `status` |
| GET | `/api/v1/admin/games/:gameId/teams/:id` | Authorized staff detail and concurrency version |
| POST | `/api/v1/admin/games/:gameId/teams` | Create; returns 201 and `{data}` |
| PUT | `/api/v1/admin/games/:gameId/teams/:id` | Full replacement; `expectedVersion` required; returns 200 |
| DELETE | `/api/v1/admin/games/:gameId/teams/:id` | Archive using JSON `{expectedVersion}`; returns 200 and updated record |

POST/PUT fields:

```json
{
  "slug": "example-team",
  "name": "Example team",
  "description": "An editorial description, not a preset code.",
  "status": "draft",
  "mainCharacterId": "<character-uuid>",
  "supportCharacterIds": ["<support-uuid>", "<other-support-uuid>"]
}
```

PUT additionally requires the latest admin response's `version` as `expectedVersion`.
Omitted description/status reset to empty string/draft. All three IDs must exist in
the same game. Publication requires all three characters to be published. Public
reads also check current character visibility, so making a member nonpublic hides
the team without leaking its identity. Unknown public collection queries return
400. Public details cannot select drafts through query parameters.

ADMIN (`catalog:write`) can manage all teams in active games, including publication,
archival and restoration. EDITOR (`catalog:draft:write`) needs a game grant, may
create/update drafts and archive existing drafts, and cannot modify published or
archived teams. Scoped REVIEWER (`content:review`) can read private teams, but has
no mutation permission. Grants are checked transactionally on every request.
All writes retain existing session, Origin and CSRF protections. Admin responses
are no-store/noindex. This is catalog CRUD, separate from guide review/publishing.

Updates/deletes lock the team row and check the version in the same transaction.
Concurrent edits with the same version yield one success and one 409. Slug/lineup
duplicates also return 409. Invalid members/payloads return 400; missing team/game
404, missing session 401 and denied permissions/CSRF 403. DELETE preserves identity
and members in archived status; it never physically deletes a team.

Migration `Teams1792800005000` creates the catalog and supporting lookup indexes.
RLS is enabled without anon/authenticated policies; published reads go through Nest,
not the Supabase Data API. Membership distinctness/canonical support ordering and
slug/lineup uniqueness are database constraints. Member/game validation and publish
visibility checks run inside the write transaction while character rows are locked.
Composite foreign keys `(character_id, game_id)` enforce same-game membership even
for direct SQL writes and prevent moving a referenced character to another game.
Their supporting unique character index is migration-managed and is marked
`synchronize: false` in ORM metadata so catalog-only migration tests remain valid.

## Verification

Unit tests cover cardinality, distinctness, UUID normalization, strict payloads,
bounded version tokens and Swagger CRUD contracts. Real PostgreSQL E2E covers
complete CRUD and restore, public visibility, role/game/CSRF checks, duplicate
canonical lineups, foreign/missing members, optimistic concurrency, query validation,
pagination, RLS, zero entity drift and migration rollback/reapply. Fixtures are
synthetic and confined to isolated schemas; no real team is seeded automatically.

Verified locally on 2026-10-24: 66 unit tests and all 33 PostgreSQL E2E tests pass,
including direct SQL cross-game rejection and compatibility with existing auth,
catalog and CMS migrations. Lint, formatting, typecheck, production build and
OpenAPI export pass. Seven Team operations are documented. GitHub Actions has not
been executed remotely.
