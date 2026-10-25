# Staging verification

## Free starting option

For a small staging environment, Render Free can host the API and Supabase Free can provide a separate database and private Storage bucket. This is an option, not a provisioned deployment. No account, paid resource or remote repository has been created by these changes.

Checked 2026-10-25: [Render Free](https://render.com/docs/free) web services sleep after 15 minutes of inactivity, have ephemeral filesystems and share 750 free instance hours per workspace/month. Background workers are not a free service type. Keep images outside the API filesystem. [Supabase Free](https://supabase.com/pricing) includes 500 MB database and 1 GB file storage; free projects can pause after a week of inactivity. Stay within the providers' current quotas and inspect billing settings before enabling optional paid resources.

[Supabase S3](https://supabase.com/docs/guides/storage/s3/authentication) accepts the path-style client already used here. Copy endpoint/region from its dashboard; create a private staging bucket and server-only S3 keys. Generated S3 keys bypass RLS across buckets, so prefer a separate staging project. S3 versioning is [not supported](https://supabase.com/docs/guides/storage/s3/compatibility); object backups need an independent copy. Anonymous S3 denial alone does not prove Supabase REST/public URLs are private: inspect the bucket's public flag and storage policies too.

The API can run without Redis. A free API-only staging environment does **not** exercise background review/import event processing: run the separate worker locally with a suitable Redis instance during dedicated testing, or provision an always-on worker later. Events remain in PostgreSQL until processed. Do not describe this reduced setup as full background-job availability.

## Configure without replacing development secrets

1. Copy `.env.staging.example` to `.env.staging`, which is ignored by git. Fill all blank connection/secret values locally. Use a new random session secret and a separate staging DB/bucket. Do not copy the development certificate bypass.
2. Use `NODE_ENV=production` even on staging. Set verified HTTPS API and web origins. For browser authentication, use the same site (for example `api.staging.yourdomain.com` and `staging.yourdomain.com`) or a same-origin reverse proxy. This API uses Strict SameSite cookies and rejects cross-site authentication; unrelated free hosting domains are not sufficient for authenticated FE integration.
3. Configure the verified provider CA if needed. Keep `TRUST_PROXY_HOPS=0` until the actual ingress topology and direct-access restrictions are verified. Host-managed TLS must forward correctly to the API.
4. Run the build/migration/release steps in [deployment](deployment.md) using staging environment variables. Development CLI commands can load the root `.env`; on staging use the compiled CLIs with explicit environment injection, for example `node --env-file=.env.staging apps/api/dist/cli/migrate.js`. The template is incomplete by design and cannot provision anything on its own.
5. Deploy the existing Dockerfile to the chosen host and point readiness to `/health/ready`. On a free host without one-off jobs, run the migration CLI from a trusted local/operator environment before starting the API. Do not expose an HTTP migration/admin-bootstrap endpoint.

## Verify real storage

Set `STORAGE_VERIFY_ALLOW_WRITE=true` in the private staging file, then run `pnpm storage:verify`. The probe reads only that file/process environment, not the development `.env`. It creates a fresh one-pixel WebP under a random key, verifies signed upload/read/inventory and byte integrity, rejects anonymous object/list access, deletes the probe, checks for 404, and attempts cleanup again in `finally`. It never updates the application database or removes existing application keys. Only explicit test mode permits HTTP for fixture tests; real staging requires HTTPS with normal certificate validation.

If cleanup fails, the command prints only the generated probe key for manual inspection. With bucket versioning, delete markers may leave previous probe versions: account for them through the provider's staging lifecycle policy. A successful probe establishes tested object operations, not a complete policy/backup audit or API publication test.

## Verify deployed API and CI

Run `pnpm staging:verify`. It checks readiness/catalogue/search, anonymous admin rejection, request/security headers, allowed/untrusted CORS, Secure/HttpOnly/Strict challenge cookies and disabled production Swagger. It creates a short-lived login challenge, never logs in and does not need staff credentials. A sleeping free instance may need to warm up before this bounded check. Browser login, session rotation, editing/upload/publication and logout still need an authenticated staging smoke once the FE origin is available.

The manual GitHub workflow **Verify configured staging** uses environment `staging`. Set environment variables `STAGING_API_ORIGIN`, `STAGING_WEB_ORIGIN`, `STAGING_GAME_SLUG`, `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`; set secrets `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`. It builds and verifies an existing deployment; it does not deploy or migrate it. Do not run these credentialed probes from pull-request code. CI runs fixture tests without real credentials.

Current prerequisites still required from the operator: hosting account/target, repository remote, staging project/bucket credentials and HTTPS origin strategy. No real S3 or remote staging success should be claimed before these exist and the commands pass.

## Optional external keep-alive

`.github/workflows/keep-alive.yml` calls `/health/live` every ten minutes at UTC minutes 7, 17, 27, 37, 47 and 57. It does not query PostgreSQL, use credentials, install dependencies or check out source code. It allows up to three bounded attempts to accommodate a cold start, checks HTTP 200 plus `{status:"ok"}` and the request ID, and fails the workflow if all attempts fail. Redirects and insecure TLS are not accepted.

To activate after the API has been deployed:

1. Push the workflow onto the GitHub repository's default branch.
2. In **Settings > Secrets and variables > Actions > Variables**, add the **repository** variable `KEEPALIVE_API_ORIGIN`, for example `https://your-service.onrender.com`. Use the origin only, without `/health/live`, credentials or query parameters. This is separate from environment-scoped staging verification variables.
3. Open **Actions > Keep staging API awake > Run workflow** and confirm a successful liveness ping. Subsequent scheduled runs are automatic. Without the variable the job is skipped; removing it stops future pings.

[GitHub scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) can be delayed or dropped under load, only run from the default branch and are automatically disabled in public repositories after 60 days without repository activity. This is best-effort keep-alive, not an uptime guarantee. Around 4,320 runs occur in a 30-day month; check Actions usage/billing limits, particularly for a private repository. If reliable timing or Actions quota is a concern, an external HTTP scheduler can call the same public `/health/live` endpoint every ten minutes instead.

The local workflow file does not activate a remote schedule by itself. A deployed API URL, GitHub remote and the repository variable are still required.
