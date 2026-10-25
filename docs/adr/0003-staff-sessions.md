# ADR 0003: Database-backed staff sessions and explicit permissions

Date: 2026-10-24. Status: accepted.

Use NestJS-managed staff identities in PostgreSQL rather than coupling internal editors to Supabase Auth or storing bearer JWTs in browser localStorage. Session cookies contain a random opaque token; database token digests are keyed with SESSION_SECRET. Recheck session status, user activity and permissions at each request so logout and role changes take effect without JWT expiry delays.

Use explicit global default-deny policy metadata. Public annotations on catalog/health controllers apply to safe reads; public login is an explicit method exception protected by its own CSRF/origin checks. Session lifecycle endpoints require an active session. Staff/catalog writes require named permissions, plus transactional game grants and draft checks for editors.

Synchronizer CSRF tokens are HMAC-bound to the session token. Pre-login challenges use a separate signed nonce and lifetime. Tokens are returned in no-store JSON rather than exposing the HttpOnly session cookie to JavaScript. Require an allowed Origin on every mutation as an additional check. SameSite=Strict remains defense in depth rather than the only CSRF control.

Use PostgreSQL fixed-window limits shared across API instances rather than process-local counters. Check IP before account to bound account bucket growth from blocked sources. Rows need operational retention cleanup, but stale rows do not prolong a window or revive expired sessions.

Use Node 24.7+ native Argon2id to avoid another native dependency. Hash parameters are intentionally fixed and bounded; malformed/unsupported encodings fail closed. Pin/test the Node runtime because this API is experimental in Node 24.

No real admin is created automatically. The trusted local bootstrap command reads supplied environment secrets, serializes initial ADMIN creation and refuses to overwrite existing accounts. Future user lifecycle/password recovery and guide resource ownership extend this foundation rather than bypass it.
