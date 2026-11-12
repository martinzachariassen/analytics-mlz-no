# Configuration

> **TL;DR** — The server reads all its configuration from environment variables. Nothing is
> required: with no variables set it listens on `:8080` and stores data in `data/analytics.db`.
> To sign in to the dashboard, set `PUBLIC_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and
> `ALLOWED_GITHUB_USERS`.

**Read this if:** you are deploying or running the server and want to know what a setting does.

## Environment variables

Read by `apps/server/internal/config/config.go`, except `LITESTREAM_REPLICA_URL`, which
`infra/docker/entrypoint.sh` reads.

| Variable | Default | Description |
|---|---|---|
| `PORT` / `ADDR` | `8080` / `:$PORT` | Listen address |
| `DATABASE_PATH` | `data/analytics.db` (Docker: `/data/analytics.db`) | SQLite file |
| `GEOIP_DB_PATH` | – (Docker: bundled DB-IP Lite) | MaxMind-format country database (DB-IP Lite). Without it, no country is recorded |
| `PROXY_HOPS` | `0` | Number of trusted reverse proxies in front of the server: 1 for Cloud Run or nginx, 2 for Firebase → Cloud Run. See [below](#proxy_hops) |
| `RETENTION_DAYS` | `0` | Delete events older than N days, checked hourly (0 = keep forever) |
| `INGEST_RATE_LIMIT` | `200` | Max accepted events per second across all clients. Extra events get `503` (0 = no global limit) |
| `MAX_DATABASE_MB` | `0` | Pause ingestion (`503`) while the database is larger than this. The dashboard keeps working (0 = no limit) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. `debug` also logs every event dropped by rate limits or bot filtering |
| `PUBLIC_URL` | `http://localhost:8080` | Dashboard URL. Used for the OAuth callback and as the only origin allowed to log out or delete sites. Must be an origin with no path. Must be `https://` when GitHub sign-in is on (localhost excepted); https also turns on Secure cookies and HSTS |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | – | GitHub OAuth App credentials. Setting the id turns on sign-in |
| `ALLOWED_GITHUB_USERS` | – | Comma-separated GitHub usernames allowed to sign in. Checked on every request: removing a name signs that user out |
| `LITESTREAM_REPLICA_URL` | – | Docker image only: continuous backup, e.g. `gs://bucket/analytics` or `s3://bucket/analytics` |
| `DEV_LOGIN` | – | `1` signs everyone in as `dev`. Local development only: refused unless `PUBLIC_URL` is on `localhost` and GitHub sign-in is off, and the dev sign-in only answers connections from the loopback interface. Also required for `analytics seed -reset` |

> [!WARNING]
> A wrong `PROXY_HOPS` breaks visitor counting, countries and rate limiting without any error.
> Check it after every deploy and every change to your proxies.

## Terraform variables (Google Cloud)

`infra/terraform/main` passes these to Cloud Run (`infra/terraform/main/run.tf`). Set them in
`terraform.tfvars`. Defaults are in `infra/terraform/main/variables.tf`.

| Terraform variable | Environment variable | Terraform default |
|---|---|---|
| `domain` | `PUBLIC_URL` (`https://<domain>`) | – |
| `proxy_hops` | `PROXY_HOPS` | `2` |
| `retention_days` | `RETENTION_DAYS` | `0` |
| `ingest_rate_limit` | `INGEST_RATE_LIMIT` | `50` |
| `max_database_mb` | `MAX_DATABASE_MB` | `200` |
| `log_level` | `LOG_LEVEL` | `info` |
| `github_client_id` | `GITHUB_CLIENT_ID` | – |
| `allowed_github_users` | `ALLOWED_GITHUB_USERS` | `[]` |
| (Secret Manager `github-client-secret`) | `GITHUB_CLIENT_SECRET` | placeholder; see [deploy guide](../guides/deploy-gcp.md#3-github-client-secret) |
| (bucket `<project_id>-db`) | `LITESTREAM_REPLICA_URL` | set automatically |

Other variables only affect infrastructure: `region`, `scheduler_region`, `service_name`,
`extra_domains`, `alert_email`, `backup_hourly_retention_days` and `backup_daily_retention_days`.

## `PROXY_HOPS`

The server takes the client IP from `X-Forwarded-For` and skips `PROXY_HOPS` trusted proxies,
counting from the right. The IP is used only in memory, for the daily visitor hash, the country
lookup and rate limiting. It is never stored.

| Setup | Value |
|---|---|
| Server reachable directly (e.g. `docker compose` on a VM, no proxy) | `0` |
| One reverse proxy (nginx, Caddy, Traefik, Cloud Run alone) | `1` |
| Firebase Hosting → Cloud Run | `2` |

If every visitor looks like the same person, or countries are wrong, the value is too low or too
high. See the [runbook](../operations/runbook.md#wrong-countries-or-every-visitor-looks-the-same).

## Next steps

- [Self-hosting](../guides/self-hosting.md) or [deploying to Google Cloud](../guides/deploy-gcp.md)
- [Runbook](../operations/runbook.md)
