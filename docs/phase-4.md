# Phase 4 — Guide CMS, revisions and publishing

The CMS is implemented under `/api/v1/admin/contents`; public guide reads are under
`/api/v1/games/:gameSlug/guides`. The existing web preview now serves `/guides/` and
`/guides/:slug/` from these APIs. The preserved `demo-ui/` export is unchanged.
No real guide, staff account or third-party guide prose is seeded. An empty guide
directory is expected until staff publish content. The graphical admin editor and
media library remain Phase 5 work; Phase 4 can be operated through the documented API.

## Persistence

`contents` stores a stable UUID, game, immutable slug/type/initial author, working
state, concurrency version and current body revision. A game/slug is unique.
`content_revisions` stores immutable title, description, category, schema version,
editor JSON, sources, reading time, author/time and optional restore ancestry.
`content_relations` snapshots character/patch references for each revision. Characters
and patches must belong to the content game; publication additionally requires them
to be published. Equipment/item relations are deferred with the equipment catalog.

`publications` points to exactly one revision of the same content through a composite
foreign key. It stores publisher/time. Publication is independent of the working
state, so an older publication remains visible during draft edits or review.
Public reads use the published revision's title/category/body/relations, never the
new draft's fields. Later unpublished character/patch references are omitted from
public output. Missing patch is null; characters and sources default to empty arrays.

`audit_entries` records actor, content, action, content version, body revision,
request ID, state transition, review reason or restore source. It never stores
credentials, session tokens or duplicate body payloads. Every mutation, including
publication, commits its head changes and audit entry in one transaction. Failure
to write audit data rolls back publication. There is exactly one audit row per
content version.

All five CMS/audit tables enable RLS without anon/authenticated policies. Public
content is served by the trusted Nest backend; Supabase's Data API does not expose
drafts or history. Database triggers reject UPDATE/DELETE on revisions, revision
relations and audit rows. The trigger function is security-invoker, uses a fixed
search path, and has no PUBLIC execution grant. Revision/audit history has no
HTTP deletion endpoint.

## Workflow and permissions

Guide categories are a fixed, case-sensitive vocabulary shared by write validation,
public filters and Swagger, with a PostgreSQL CHECK constraint on revision history:

| Category | Meaning |
| --- | --- |
| `character` | Individual character analysis, skills and build advice |
| `team` | Team composition, synergy and rotations |
| `boss` | Boss mechanics and encounter strategy |
| `general` | Overall game systems and broad reference material |
| `beginner` | Getting started and introductory tutorials |
| `combat` | General combat mechanics and tactics |
| `progression` | Leveling, farming and resource progression |

Each guide has exactly one category. Unknown values, aliases and different casing
return 400, including in public category filters. `contentType` remains `guide`;
category is its editorial classification. Character links remain optional explicit
relations; team/boss categories do not create structured team/boss entities. Those
catalog features are separate work. Category changes are new editorial revisions,
so an existing publication keeps its old category until the replacement is published.
The category migration validates existing data without changing immutable history;
nonstandard legacy values must be reviewed before that migration can succeed.
Category normalization is enforced by `GuideCategories1792800004000`; verified with
58 unit tests and 13 CMS E2E tests, including invalid HTTP categories, direct SQL
constraint rejection, migration rollback/reapply and zero entity/schema drift.

| Action | Required permission | Allowed working states → result |
| --- | --- | --- |
| Create | `content:write` | New identity → draft, revision 1, version 1 |
| Edit/restore | `content:write` | draft/published → draft with a new immutable revision |
| Submit review | `content:write` | draft → in_review; nonempty text required |
| Approve | `content:review` | in_review → approved; reviewer differs from revision author |
| Return to draft | `content:review` | in_review/approved → draft; reason required |
| Publish | `content:publish` | approved → published; pointer and audit committed atomically |
| Unpublish | `content:publish` | Remove existing pointer; published → draft; newer draft/review retained |
| Archive | `content:publish` | Any nonarchived state → archived; remove pointer, retain history |

ADMIN has all three permissions and global game scope. EDITOR has write permission;
REVIEWER has review permission. Both need `user_game_access` grants for the active
game, including for previews/history/queue reads. An admin also cannot approve a
revision they authored. Archived content is terminal in this phase; private history
remains readable while its game is active. All mutations require existing session,
allowed Origin and X-CSRF-Token protections from Phase 3.

## Concurrency and rollback

Every mutation after creation requires `expectedRevision` equal to the latest
admin response's **`data.version`**. The historical request field name is retained
from the initial API contract, but this is a concurrency token: it advances on
every successful mutation, including submit/approve/unpublish. **`currentRevision`**
is a different counter: it advances only when create/edit/restore creates a body
snapshot. Public `revision` is the publication's snapshot number.

For example, create returns version 1/currentRevision 1. Submit uses expectedRevision
1 and returns version 2; approve uses 2 and returns 3; publish uses 3 and returns 4.
Editing that publication uses 4 and returns version 5/currentRevision 2 while the
public endpoint still returns revision 1. A content row lock serializes commands;
two edits with the same token yield one success and one 409 `CONFLICT` with message
`Content has changed`. Refetch the head and reconcile changes before retrying.

Restore accepts an existing `sourceRevision` from the same content and copies its
body, sources and references into a new draft with `derivedFrom` recorded. It does
not rewind counters, delete newer snapshots or skip review. Slug, game and initial
author are stable; revision fields are a full replacement, even on PATCH. Omitted
optional sources/relations reset to their defaults.

## Editor document and HTML

Schema version 1 uses the Tiptap/ProseMirror JSON format with a deliberately bounded
schema: doc, paragraph, heading (levels 1–3), text, hardBreak, horizontalRule,
bulletList, orderedList (start 1–1000), listItem, blockquote and codeBlock. Text marks:
bold, italic, strike, code and HTTPS links. List items start with a paragraph.
Configure a future Tiptap client to match this subset; this phase does not install
an editor UI or accept arbitrary Tiptap extensions.

Unknown properties/nodes/marks/attributes, HTML, images, unsafe URLs, embedded event
handlers and invalid nesting are rejected. Limits: nesting depth 12, 2000 nodes,
100000 text characters, 256 KiB HTTP body. Source links are also HTTPS only.
The renderer constructs tags from the allowlist and escapes all text/attributes;
it never passes raw editor HTML through. API detail/preview returns validated JSON
and generated `html`. Guide pages escape metadata and use only this generated HTML.

See [Tiptap persistence](https://tiptap.dev/docs/editor/core-concepts/persistence)
and [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## API walkthrough

Authenticate using the Phase 3 CSRF/login flow. As an editor with a game grant,
POST `/api/v1/admin/contents`:

```json
{
  "gameId": "<active-game-uuid>",
  "slug": "getting-started",
  "title": "Getting started",
  "description": "An editorial introduction.",
  "category": "beginner",
  "body": {
    "type": "doc",
    "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Write reviewed guide content here." }] }]
  },
  "sources": [],
  "characterIds": [],
  "gameVersionId": null
}
```

Use the returned ID with POST `/:id/submit-review`, then switch to an independently
authorized reviewer for `/:id/approve`, then an admin for `/:id/publish`. Each command
body is `{ "expectedRevision": <latest version> }`. Creation returns 201, subsequent
commands return 200 and `{data}`; stale/invalid transitions or duplicate slug return
409. Invalid payload/relations return 400, unauthenticated 401, denied 403 and missing
content/revision/publication 404. Shared body limits and tracing apply.

GET `/:id/preview` returns the latest draft JSON/HTML, head/version and publication.
GET `/:id/revisions` lists paginated metadata; `/:id/revisions/:revision` previews
a historical snapshot. GET `/:id/audit` returns the paginated audit trail.
All admin responses, including errors, carry no-store and X-Robots-Tag:
`noindex, nofollow`. No anonymous preview token is implemented.

GET `/admin/contents?gameId=<uuid>&state=in_review` lists the review queue.
GET `/games/stella-sora/guides?category=beginner&page=1&limit=20` lists published
summaries, sorted publishedAt descending then ID ascending. Unknown collection
query fields return 400. The public detail route always follows the publication;
query parameters cannot select drafts, previews or historical revisions.
Swagger `/docs`, `/docs-json` and `/docs-yaml` document all implemented commands,
request/response schemas, errors, security and pagination. `pnpm openapi:export`
regenerates the checked-in contract without a database connection.

## Local operation and verification

Run `pnpm migration:run`, `pnpm dev` and `pnpm dev:web`; open
`http://localhost:3001/guides/`. Bootstrap a real admin separately using the existing
credential procedure, create staff and assign game grants, then publish through
Swagger/API. No service restart/deployment is required for later guide edits.

Unit tests cover safe document rendering and rejection boundaries plus the OpenAPI
contract. PostgreSQL E2E tests cover game/role/CSRF checks, independent review,
concurrent writes, frozen publication metadata/relations, rejection feedback,
restore, unpublish/archive, atomic audit failure, RLS, immutable history, schema
drift and migration revert/reapply. A smoke test starts the real Python web server,
publishes through the API, verifies the public page stays on its old snapshot during
draft editing, and checks 404 after unpublish. Test accounts/content live only in
random isolated schemas which are removed afterward. Python 3 is needed for this
web smoke test; CI installs Python 3.11 explicitly.

Verified locally on 2026-10-24: 45 unit tests and 25 PostgreSQL E2E tests passed;
the final 12-test CMS suite also passed with out-of-range revision validation.
Lint, formatting, typecheck, production build and OpenAPI export passed. Applied
`Publishing1792800003000` to the configured development database: five RLS-enabled
CMS/audit tables, no entity/schema drift, and the existing one game/six characters/
zero staff users preserved. No real content was seeded. Live readiness/public
guide reads return 200, anonymous CMS access returns 401 with no-store/noindex,
and the served OpenAPI matches the generated artifact. GitHub Actions has not been
executed remotely. The current additional web preview runs at
`http://localhost:3002/guides/`; the normal `pnpm dev:web` default remains port 3001.
