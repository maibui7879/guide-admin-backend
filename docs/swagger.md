# OpenAPI reference

Local Swagger UI: `http://localhost:3000/docs`. Machine-readable documents: `/docs-json` and `/docs-yaml`. All documentation routes are disabled in production.

The current spec covers public health/catalog/guide reads, staff login/session lifecycle, staff administration, protected catalog writes and the complete Phase 4 CMS workflow. Each operation has a stable operation ID, summary/description, request schemas, typed success schemas and error schemas. CMS includes concurrency tokens, review/approval, publish/unpublish/archive, restore, private previews, revision history and audit.

Catalog collection responses contain `data` and `meta` (page, limit, total, totalPages). Detail responses contain `data`. Health endpoints return `{status:"ok"}` directly. Collection examples cover populated results, zero matches and pages beyond the last result. Nullable fields, dates, source records, ordered arrays and mechanics v1 are explicitly modeled. Patch/combat examples are illustrative and do not claim verified game data.

Every operation documents `X-Request-Id` request/response behavior and the common 400/413/500 envelopes from the HTTP boundary. Game-scoped operations also document 404; readiness documents 503. Public read endpoints do not advertise authentication errors. Admin routes describe session-cookie auth, Origin/CSRF requirements, 401/403, applicable 409 conflicts and login 429 with Retry-After. Login/challenge set HttpOnly cookies; logout returns 204. All admin responses document Cache-Control: no-store and X-Robots-Tag: noindex, nofollow. The error schema lists shared machine codes for future reuse, but only status codes reachable by each current operation are attached to that operation. Validation details are strings; other errors return an empty array. Database failures on catalog reads currently return the generic 500 envelope; readiness converts database query failure to 503.

Collection query validation rejects unknown fields. The character detail endpoint does not inspect query parameters. Input constraints in Swagger match DTO validation: page 1–1,000,000, limit 1–100, name/alias query up to 100 characters, role up to 50 characters, exact element and rarity enums. Query filters combine with AND.

Run `pnpm openapi:export` to regenerate [openapi.json](openapi.json) from controller/DTO metadata without connecting to PostgreSQL or reading database credentials. CI regenerates the file and fails if it differs from the committed artifact. Do not hand-edit that generated file.

Contract tests verify response/error references for every operation, required/null fields, request bounds, stable operation IDs, example payload shape, runtime tracing/error messages and production documentation exclusion. Response DTOs also type controller return values so TypeScript catches accidental drift from service output.

Staff login flow and permission matrix are documented in [Phase 3](phase-3.md). Swagger keeps browser cookies automatically; use the real challenge and session response CSRF tokens for Try It Out rather than copying illustrative examples.

Guide CMS payloads, transition rules and expectedRevision/version semantics are documented in [Phase 4](phase-4.md). Public guide reads always follow the publication pointer; draft or historical selection is never exposed through public query parameters.
