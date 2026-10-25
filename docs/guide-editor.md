# Guide editor and media

Open `http://localhost:3002/admin/editor/` after starting the API and web preview. Use `pnpm dev:web` with `WEB_PORT=3002`, or the default port 3001. The editor is bundled locally from the pinned official Tiptap packages; it does not load editor code from a CDN. Run `pnpm --filter @atlas/web build` after frontend changes. The API CORS configuration must include the web origin. `EDITOR_API_ORIGIN` defaults to `http://localhost:3000`; use the same hostname as the web page so session cookies work correctly.

An existing staff account (ADMIN, EDITOR or REVIEWER) and game access are required. EDITOR can write; REVIEWER can review; ADMIN can publish. The revision author cannot approve their own revision, even with ADMIN permissions. Login uses the existing HttpOnly session/CSRF flow; passwords and session tokens are never stored in localStorage. The editor supports a separate title and description, H2/H3, bold/italic/strike, HTTPS links, lists, quotes, code, dividers, image blocks, cover images, alt text and captions. The sidebar builds a heading list. Save creates a draft revision; Preview renders the saved server snapshot. Unsaved changes are marked, and a stale save reports 409 without retrying over another editor's work. Submit uses the saved content version. Review/publish authorization remains the existing CMS workflow.

Create requires game, slug and wiki identity. Those identity fields become fixed after saving. Existing pages load their latest draft and preserve contextual character/game-version links and sources when edited. A review/approved/archived page is read-only in the editor; review, return-to-draft, publish, unpublish and archive commands are available in the CMS sidebar according to permissions and state. The editor has no concurrent live collaboration or community edit proposal workflow.

## Media contract

- `POST /api/v1/admin/games/{gameId}/media`: multipart `file`, with session, allowed Origin and `X-CSRF-Token`. PNG, JPEG and WebP up to 5 MiB; at most 16 megapixels and dimensions up to 8192. Sharp decodes, auto-orients and re-encodes the image as static WebP, without source metadata. SVG and invalid input are rejected. The response includes an ID, dimensions, output size/type and authenticated preview URL.
- `GET /api/v1/admin/media/{id}/file`: authenticated, game-scoped draft image read.
- `GET /api/v1/media/{id}/file`: available only while referenced by a currently published revision in an active game with an available wiki subject. Unused images and draft images return 404. Responses are no-store; unpublish/archive removes access on the next request. Downloads already made cannot be recalled.

Editor JSON uses an image block between paragraphs:

```json
{"type":"image","attrs":{"mediaId":"03d6b90a-69ca-43bb-80a4-5dbff11b8e78","alt":"Description of the illustration","caption":"Optional caption"}}
```

`mediaId` must identify an uploaded asset in the guide's game. Raw image URLs, image event attributes, inline images and raw HTML are not accepted. Alt text is required (max 300), caption max 500. A revision can reference at most 50 distinct assets. Existing document v1 nodes and bounds remain supported. Image nodes are an additive v1 extension. The renderer escapes alt/captions and emits only controlled media routes. Image alt/captions are stored in the revision, so one image can have different editorial descriptions in different revisions.

Revision input also accepts `coverImageId` (nullable), `coverAlt`, `coverCaption`. Cover alt is required when an image is set. Omitted cover fields reset to no cover on a full draft replacement. Public detail and admin preview include a `cover` descriptor; previews use authenticated URLs. The Python public preview proxies only the controlled public media file route and displays covers and inline figures.

## Database and storage

Migration `1792800008000-guide-media` adds `media_assets`, immutable `content_revision_media`, and cover fields on `content_revisions`. RLS is enabled on both new tables without anonymous policies. References are inserted atomically with the body revision; composite foreign keys keep the asset and content in the same game. Restore validates/recreates references to the historical images. Publication pointers determine which images are public while later drafts change.

Development defaults to private local files in `.data/media` (gitignored). `MEDIA_LOCAL_DIR` can override the directory. Production requires `MEDIA_STORAGE_DRIVER=s3` and the existing `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`. The bucket must remain private: all reads pass through API authorization. S3 is loaded only when selected. Do not place local media inside a static web root. Back up both DB metadata and object storage. Changing drivers requires moving existing objects with their keys; it does not migrate them automatically.

Media library, reference inspection and retryable deletion APIs are implemented; historical guide references and character assignments protect assets from deletion. `pnpm media:inventory` produces a private read-only reconciliation report for interrupted uploads. See [backend API](backend-api.md). Local browser/integration verification does not verify a real S3 endpoint or credentials.

Validation completed: 83 unit cases passed, then the expanded Swagger suite passed all 10 cases (84 distinct unit cases overall). The 17 existing guide integration cases passed, and the new media lifecycle case passed after correcting its expected trigger error text. A real Chrome headless run verified login, rejection of a spoofed SVG labeled PNG, paragraph/image editing, image and cover upload, draft save and authenticated image preview. Typecheck, ESLint, API build, editor bundle and OpenAPI export passed. Migration was applied with zero ORM drift and RLS enabled. Live API health, editor HTML/bundle and CORS preflight were verified.

The development API is on port 3000 and the editor preview on port 3002. Real accounts are created locally by the operator; browser tests never create accounts in the application schema. Set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` locally and run `pnpm admin:bootstrap` to create the first admin, then remove those bootstrap variables. The browser test used an isolated, disposable schema and synthetic credentials, not a production account.


## Wiki CMS workflow

The existing `/admin/editor/` entry point now includes page management, not just the text editor:

1. Select the game. The page table loads 20 heads per request, with a server-side working-state filter and a Load more action. Search matches slug, wiki kind and topic within the loaded rows, explicitly labelled as such.
2. Open an existing page from the table. To create a missing wiki page, choose New, its subject and topic, then use the Find page button. This scans the authorized game catalogue of content heads across all pages and all states, including archived. Existing identity opens the canonical page; a race is still protected by the API/database 409 constraint.
3. Write and save a draft; preview the saved server revision. Subject/topic/game/slug stay fixed after creation. Public subject selectors now load all result pages, rather than silently truncating to 100. An existing unpublished subject is retained as a disabled identity value when opening its page.
4. Submit review. A different account with review permission opens the page and either approves or returns it with a required reason. History and feedback display the audit trail. No self-approval bypass was added.
5. A publisher publishes the approved revision. The sidebar distinguishes the current revision from the publication pointer, with a public-page link for Stella Sora (other games link to the public API because the preview website is single-game).
6. History lists revisions and audit events, each paginated by 20 with Load more. Historical snapshots can be previewed. Restore copies a revision into a new draft, requires another review before publication, and retains the existing publication.
7. Unpublish removes public access. Archive is a confirmed terminal action: it reserves the wiki identity and cannot be reopened under the current backend workflow.

Workflow writes always send the loaded `head.version` as `expectedRevision`. Unsaved content blocks workflow writes; a conflict is surfaced without an automatic retry. UI permission checks only control affordances; the API remains authoritative. Logout handles the API's empty 204 response.

The Phase 5 backend is implemented. Further media-library and character-management screens are deferred by the backend-first scope decision. Production S3 verification and the public deployment release gate remain separate checks. Community signup and edit proposals are outside this scope.

CMS verification: the expanded real-Chrome smoke passed with two synthetic staff accounts in an isolated schema: self-review disabled, return feedback visible in audit, approve/publish rendered on the public website with media, restore retained the publication, unpublish returned public API 404, canonical subject/topic lookup reopened the same page, and state filtering changed the queue. API/test TypeScript checking, focused ESLint, Prettier and the editor bundle passed. Live editor and API readiness returned 200. No schema migration was needed for this CMS UI change.
