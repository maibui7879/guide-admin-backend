# Phase 3 — Staff identity and authorization

## Implemented

- Migration `1792800002000-identity` and TypeORM mappings for users, roles, permissions, role_permissions, user_roles, user_game_access, sessions and login_buckets.
- Argon2id passwords (64 MiB, 3 passes, parallelism 1, 16-byte random salt, 32-byte output) using the Node 24.7+ native asynchronous crypto API. Standard unpadded Base64 PHC representation. The native API is still experimental in Node 24; runtime compatibility is tested in CI and should be checked on Node upgrades.
- Opaque 256-bit session tokens in host-only `atlas_session` cookies: HttpOnly, SameSite=Strict, Path=/api/v1/admin, Secure in production. Only HMAC-SHA256 token digests are stored in PostgreSQL. Changing SESSION_SECRET invalidates existing sessions and CSRF challenges.
- Idle expiry (default 30 minutes) and absolute expiry (default 8 hours), explicit rotation and logout/revocation. Idle extension cannot exceed the absolute expiry. Roles and permissions are loaded from the database on each protected request; inactive users and users without staff roles cannot use sessions.
- Login CSRF challenge (10 minutes), session-bound synchronizer tokens and an explicit Origin allowlist (`API_ORIGIN` plus `CORS_ORIGINS`). Login requires JSON. State-changing requests without Origin or with missing/invalid CSRF tokens fail. All admin responses, including errors, are no-store.
- PostgreSQL-backed fixed-window login limits: 5 attempts per account and 50 per source IP per 15 minutes by default. IP is checked first to avoid creating new account buckets after an IP is blocked. Both successful and failed attempts count. Unknown accounts and wrong passwords use the same generic response and Argon2 work factor. Bucket keys contain HMACs, not raw IPs/emails.
- A global default-deny guard. Public catalog/health annotations allow reads; adding a mutation to a public-read controller does not automatically make it public. Explicit policy is required for every protected handler.
- ADMIN can manage catalog and staff. EDITOR may create/replace drafts only in assigned active games. REVIEWER has reserved content-review permission and cannot mutate catalog/users. Editor scope and draft checks occur inside the character write transaction, with row locks. No future guide-review/publish endpoints are implied.
- Role replacement revokes all of the changed user's sessions. Removal of the last active ADMIN is prevented under a transaction-level advisory lock. Scoped game access changes apply on subsequent requests.

## Endpoints

| Method | Route | Policy |
| --- | --- | --- |
| GET | `/api/v1/admin/auth/csrf` | Public pre-login challenge |
| POST | `/api/v1/admin/auth/login` | Challenge cookie + CSRF + allowed Origin + rate limit |
| GET | `/api/v1/admin/auth/session` | Valid active staff session |
| POST | `/api/v1/admin/auth/rotate` | Session + CSRF + Origin |
| POST | `/api/v1/admin/auth/logout` | Session + CSRF + Origin; 204 |
| POST | `/api/v1/admin/users` | users:manage |
| PUT | `/api/v1/admin/users/:userId/roles` | users:manage; 204 |
| PUT | `/api/v1/admin/users/:userId/games` | users:manage; 204 |
| POST | `/api/v1/admin/games` | catalog:write |
| POST | `/api/v1/admin/games/:gameId/versions` | catalog:write |
| POST | `/api/v1/admin/games/:gameId/characters` | catalog:write or scoped catalog:draft:write |
| PUT | `/api/v1/admin/games/:gameId/characters/:id` | Same, with resource/draft checks |

Catalog updates are full replacements. Optional fields/arrays omitted from the request reset to their schema defaults. Permission checks happen before application writes. Editor requests cannot modify published records or set status to published/archived. Guide workflow/concurrent editorial revisions belong to Phase 4.

## Bootstrap the first admin

Run migrations first. Set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` locally in the shell environment or ignored root `.env`; password length must be 12–128 characters. Run `pnpm admin:bootstrap`, then remove those two variables. Do not paste credentials into chat or put them into command-line arguments/source control. The command prints no password and refuses to run when an active admin already exists. It does not reset or overwrite accounts. A bootstrap was exercised in an isolated integration-test schema; no real admin account is seeded automatically.

Use an existing ADMIN session and `POST /api/v1/admin/users` for additional staff, then assign editor game access with the games endpoint. Roles are ADMIN, EDITOR or REVIEWER; arbitrary submitted permissions and unknown fields are rejected.

## Client and deployment behavior

In Swagger at `/docs`, first call GET `/admin/auth/csrf`, copy its response token into the login request's X-CSRF-Token header, then log in with credentials. The browser stores HttpOnly cookies automatically (`withCredentials` enabled); do not manually persist session tokens. Subsequent writes use the token from login or GET session. Rotation changes this token; serialize rotations to avoid concurrent requests using an old cookie. CLI clients must keep a cookie jar and explicitly supply an allowed Origin.

Production origins must be HTTPS. The current strict cookie policy expects the admin client and API to be same-site. Trust-proxy is not enabled, so the IP throttle uses the socket peer rather than trusting X-Forwarded-For; a deployment behind a reverse proxy needs a deliberate trusted-proxy configuration before considering per-client IP limits. No Redis, public signup, password-recovery/email flow or React admin console is included in this phase.

RLS is enabled with no public policies on every identity table. Supabase anon/authenticated roles must not read password hashes or sessions. The trusted backend connection remains the configured database account. Retention/cleanup of expired sessions and old throttle rows is an operational follow-up; expiration and revocation are enforced at read time regardless of cleanup.

## Verification

Security integration tests use isolated random PostgreSQL schemas and synthetic accounts. They cover missing authentication, login CSRF and origin failures, token storage, rotation invalidation, logout, idle/absolute expiry, disabled users, forged cookies, editor/reviewer restrictions, game scope, published-record protection, mass assignment, role-change revocation, last-admin protection, rate limiting, RLS, schema drift and migration rollback/reapply. Unit tests cover Argon2 verification, default-deny guards and Swagger contracts.

Verified locally on 2026-10-24: 29 unit tests and 13 real PostgreSQL E2E tests passed, including zero ORM schema drift and identity migration rollback/reapply. Typecheck, lint and production build passed. Applied the identity migration to the configured development database: 3 roles, 6 permissions, 0 real staff users; the six-character catalog is preserved. No bootstrap credentials were provided, so no real admin was created. OpenAPI was regenerated; GitHub Actions has not been executed remotely.
