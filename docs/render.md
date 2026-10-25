# Deploy the backend on Render

This repository publishes the backend under `apps/api`. The frontend, local secrets, media and database backups are not required for deployment and are not included in the backend commit.

## Create the service

1. Connect `maibui7879/guide-admin-backend` to a Render **Web Service** and select branch `main`.
2. Select **Docker** runtime and **Free** instance for staging. Leave **Root Directory** empty (repository root).
3. Set **Dockerfile Path** to `apps/api/Dockerfile` and Docker build context to the repository root. The workspace lockfile and root package configuration must be available during the build.
4. Keep the Docker start command from the image: `node dist/main.js`. Set the health-check path to `/health/ready`.

The container runs as a nonroot user and defaults to production. The API uses Render's `PORT` environment variable. No local `.env` is copied into the image.

## Configure environment variables

Use `.env.staging.example` as a list of settings; enter actual values in Render's environment/secret settings, never in a committed file.

- `NODE_ENV=production`, a verified `DATABASE_URL` for the existing Supabase database, and `DATABASE_SSL_INSECURE=false`.
- A new random `SESSION_SECRET` of at least 32 characters.
- `API_ORIGIN=https://<service>.onrender.com` and explicit HTTPS `CORS_ORIGINS`. For authenticated browser integration, plan same-site domains or a same-origin proxy; see [staging](staging.md).
- `MEDIA_STORAGE_DRIVER=s3` plus real `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY` and `STORAGE_SECRET_KEY`. A private Supabase Storage bucket can be used; placeholder/local storage values are insufficient in production.
- Optional `REDIS_URL` is for a separately run worker; do not point it to localhost on Render. The API can start without Redis.
- Keep `TRUST_PROXY_HOPS=0` until the actual proxy topology is verified. Supply the trusted provider CA when needed; never disable production certificate validation.

Before deploying, confirm migrations are applied to the target database. The API deliberately refuses startup if migrations are pending. Free Render has no one-off shell/jobs: use a trusted operator machine, build the API, and run `node --env-file=.env.staging apps/api/dist/cli/migrate.js` with explicit target configuration. Do not run migrations through a public HTTP route or reset the existing database. See [release and recovery](deployment.md).

## Verify and enable optional pings

Check `/health/live` and `/health/ready` after deployment. Run the real storage and staging verification commands described in [staging](staging.md). Never store uploaded images or backups on Render's ephemeral filesystem.

In the GitHub repository, add the **repository Actions variable** `KEEPALIVE_API_ORIGIN=https://<service>.onrender.com`. Run **Actions > Keep staging API awake > Run workflow** once. Its best-effort schedule then pings `/health/live` every ten minutes. It needs no database or storage credentials. This does not guarantee uptime or run the background worker.

Pushing this repository does not create a Render service or provision a Storage bucket. Configure those resources and verify their current free-plan quotas in the provider dashboards before enabling them.
