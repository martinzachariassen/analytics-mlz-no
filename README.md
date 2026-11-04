# analytics-mlz-no

**Lightweight, privacy-friendly, self-hostable web analytics.** One Go binary, one SQLite file,
a 1 KB tracking script and a React dashboard. No cookies, no IP addresses, nothing shared with
anyone.

[![CI](https://github.com/martinzachariassen/analytics-mlz-no/actions/workflows/ci.yml/badge.svg)](https://github.com/martinzachariassen/analytics-mlz-no/actions/workflows/ci.yml)
[![CodeQL](https://github.com/martinzachariassen/analytics-mlz-no/actions/workflows/codeql.yml/badge.svg)](https://github.com/martinzachariassen/analytics-mlz-no/actions/workflows/codeql.yml)
[![Latest release](https://img.shields.io/github/v/release/martinzachariassen/analytics-mlz-no)](https://github.com/martinzachariassen/analytics-mlz-no/releases/latest)
[![License: MIT](https://img.shields.io/github/license/martinzachariassen/analytics-mlz-no)](LICENSE)

> **Status: pre-1.0.** It works and runs the author's own sites, but configuration and the
> database schema can still change between minor versions. Read the [changelog](CHANGELOG.md)
> before upgrading. Design decisions and what is left for 1.0: [docs/PLAN.md](docs/PLAN.md).

## What's in it

| | |
| --- | --- |
| **Cookie-free counting** | Visitors are a daily-rotating hash of IP, user agent and site; the IP is never stored and the salt is deleted every day. See [PRIVACY.md](docs/PRIVACY.md). |
| **Everything a small site needs** | Page views, SPA navigation, outbound links, custom events with properties, referrers and UTM, countries, browsers, devices, realtime, comparisons and filters. |
| **A tiny script** | 1 KB gzipped, no dependencies, sets no cookies, cannot throw into your page. CI fails if it grows. See [TRACKER.md](docs/TRACKER.md). |
| **One binary, one file** | Pure Go, SQLite with WAL, embedded migrations and GeoIP. Litestream replicates the file to a bucket and restores it on start. |
| **Hardened by default** | Rate limits per client, upstream and visitor, bounded queues, a database size cap, parsed-address limiter keys, OAuth with PKCE, sliding sessions, CSRF checks, security headers from the server itself. See [SECURITY.md](SECURITY.md) and [BOTS.md](docs/BOTS.md). |
| **Infrastructure as code** | Terraform for a scale-to-zero Cloud Run service, Firebase Hosting, backups, alerts and an operations dashboard. Pinned, signed and scanned builds. See [DEPLOY.md](docs/DEPLOY.md). |

## Install

**Docker image** (linux/amd64, linux/arm64) from the GitHub Container Registry:

```sh
docker pull ghcr.io/martinzachariassen/analytics-mlz-no:latest   # pin a version from the releases page in production
```

**Static binary** (Linux and macOS, amd64 and arm64) from the
[releases page](https://github.com/martinzachariassen/analytics-mlz-no/releases). Verify it with
`checksums.txt` or `gh attestation verify <file> --owner martinzachariassen`. The binary has no
GeoIP database; set `GEOIP_DB_PATH` to a DB-IP Lite country `.mmdb` file to record countries.

**From source:** see [Development](#development).

> [!NOTE]
> The server image serves the API and the tracking script. The dashboard in `apps/web/` is a
> static single-page app that must be served from the same origin as `/api` (production uses
> Firebase Hosting with a rewrite, see [DEPLOY.md](docs/DEPLOY.md)). Embedding it in the binary
> for self-hosters is an open item for 1.0.

## Quick start (Docker)

```sh
cp infra/docker/.env.example infra/docker/.env   # then edit it
docker compose -f infra/docker/docker-compose.yml up -d --build
docker compose -f infra/docker/docker-compose.yml exec analytics analytics sites add -domain example.com
```

The container listens on `127.0.0.1:8080` only, runs read-only as an unprivileged user with no
capabilities, and has a health check. Put a reverse proxy with TLS in front and set `PROXY_HOPS=1`.
Image tags carry a signed build provenance attestation
(`gh attestation verify oci://ghcr.io/martinzachariassen/analytics-mlz-no:<tag> --owner martinzachariassen`).

Send a test event:

```sh
curl -A "Mozilla/5.0" -H "Origin: https://example.com" \
  --data '{"site":"<site-id>","url":"https://example.com/"}' http://localhost:8080/api/event
```

### Dashboard sign-in (GitHub)

1. Create an OAuth App at <https://github.com/settings/developers>.
   - Homepage URL: your `PUBLIC_URL`
   - Authorization callback URL: `<PUBLIC_URL>/api/auth/github/callback`
2. Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `ALLOWED_GITHUB_USERS` (comma-separated GitHub usernames).

There are no passwords. On first sign-in a username is bound to its GitHub account id, so a
renamed-and-reregistered username cannot take over access. Sessions last 7 days without use and
are extended while in use. Removing a username from `ALLOWED_GITHUB_USERS` signs that user out at
their next request; `analytics sessions revoke [-user LOGIN]` does it immediately. `PUBLIC_URL`
must be `https://` when sign-in is enabled (localhost excepted).

## Tracking your site

Add the script to every page (replace the host and site id):

```html
<script defer src="https://analytics.example.com/api/script.js" data-site="SITE_ID"></script>
```

That's it: page views (including SPA navigation via `history.pushState` and `replaceState`) and
clicks on outbound links are tracked automatically. The script is ~1 KB gzipped and sets no cookies.

**Custom events**

```html
<button data-mlz-event="signup" data-mlz-event-plan="pro">Sign up</button>
```

The attributes carry the `mlz` prefix so they never collide with attributes of your own or of
another tool on the page. The `data-mlz-event-*` attributes become properties of the event
(`data-mlz-event-billing-cycle="yearly"` is sent as `billingCycle`).

```js
window.mlz?.track("signup", { plan: "pro", seats: 3 }); // optional chaining: the script loads with defer
```

**Script options**

| Attribute | Description |
|---|---|
| `data-site` | Site id (required) |
| `data-api` | Collection endpoint, if not on the same host as the script |
| `data-auto="false"` | Disable automatic page views; call `mlz.pageview()` yourself |
| `data-hash="true"` | Include `#hash` in paths (hash-based routers) |
| `data-allow-localhost="true"` | Also track on `localhost` |
| `data-respect-dnt="true"` | Don't track visitors with Do Not Track enabled |

To exclude your own visits, run `localStorage.setItem("mlz_ignore", "true")` in the browser console on your site.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` / `ADDR` | `8080` / `:$PORT` | Listen address |
| `DATABASE_PATH` | `data/analytics.db` | SQLite file |
| `GEOIP_DB_PATH` | bundled in Docker image | MaxMind-format country DB (DB-IP Lite) |
| `PROXY_HOPS` | `0` | Trusted reverse proxies in front (1 = Cloud Run / nginx, 2 = Firebase → Cloud Run) |
| `RETENTION_DAYS` | `0` | Delete events older than N days (0 = forever) |
| `INGEST_RATE_LIMIT` | `200` | Max accepted events per second across all clients; excess gets `503` (0 = no global limit) |
| `MAX_DATABASE_MB` | `0` | Pause ingestion (`503`) while the database is larger than this; the dashboard keeps working (0 = no limit) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. `debug` also logs every event dropped by rate limits or bot filtering |
| `PUBLIC_URL` | `http://localhost:8080` | Dashboard origin (no path); used for the OAuth callback and CSRF checks. Must be `https://` when sign-in is enabled, except on localhost |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | – | GitHub OAuth App credentials (enables sign-in) |
| `ALLOWED_GITHUB_USERS` | – | Comma-separated GitHub usernames allowed to sign in; checked on every request |
| `LITESTREAM_REPLICA_URL` | – | Continuous backup, e.g. `gs://bucket/analytics` or `s3://bucket/analytics` (S3 needs `LITESTREAM_ACCESS_KEY_ID`/`LITESTREAM_SECRET_ACCESS_KEY`, GCS `GOOGLE_APPLICATION_CREDENTIALS` outside Google Cloud) |
| `REQUIRE_REPLICA` | – | `1` refuses to start when the database is missing and the replica is empty, instead of starting fresh. Set it once the replica holds data |
| `DEV_LOGIN` | – | `1` signs everyone in as `dev`, for local development only (requires a `localhost` `PUBLIC_URL`, and only answers loopback connections) |

The CLI: `analytics serve` (default), `sites add|list`, `events purge`, `sessions revoke`,
`seed` (demo data, local only) and `version`. See [docs/API.md](docs/API.md) for the HTTP API.

## Documentation

- [How it fits together](docs/ARCHITECTURE.md)
- [Privacy: what is stored and what is not](docs/PRIVACY.md)
- [Tracking script, CSP and caching](docs/TRACKER.md)
- [Bots, scanners and robots: what is filtered, what is not, what to check](docs/BOTS.md)
- [API reference](docs/API.md)
- [Deploying to Google Cloud](docs/DEPLOY.md), including the restore runbook
- [Upgrading and rolling back](docs/UPGRADING.md)
- [Releasing](docs/RELEASING.md) · [Plan and open items](docs/PLAN.md)
- [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) · [Changelog](CHANGELOG.md)

## Development

```
apps/
  server/     Go API and ingest (go.mod lives here)
  web/        Dashboard (React, Vite, shadcn/ui)
  tracker/    Tracking script (TypeScript), built into apps/server/internal/script
  demo/       Demo site used by `make dev`
infra/
  docker/     Dockerfile, docker-compose, Litestream, backup and restore tests
  terraform/  GCP: bootstrap and main
docs/         Guides and reference
scripts/      verify.sh, the quality gate
```

Tools are pinned in [`mise.toml`](mise.toml) and JavaScript packages are one Bun workspace:

```sh
mise install
bun install     # also wires up the pre-commit hook
make dev
```

`make dev` starts the API (:8080), the dashboard (http://localhost:5173) and a small demo site
(http://localhost:8081), and prints the links. It uses a separate database, `data/dev.db`,
with two demo sites ("Demo blog" and "Demo docs") filled with two years of synthetic traffic:
growth, weekends, seasonal dips, a couple of traffic spikes, returning visitors and custom
events. The public home page (`/`) has a one-click "Open demo dashboard" button, with no account
or password. Clicking around the demo site sends real events through the tracking script, and
they show up in the realtime counter and charts.

- `make dev-reset` deletes `data/dev.db`, so the next `make dev` starts with fresh data.
- `go run ./apps/server/cmd/analytics seed -h` shows options (`-days`, `-scale`, `-reset`).
- One-click sign-in is `DEV_LOGIN=1`. The server refuses it unless `PUBLIC_URL` is on
  `localhost` and GitHub sign-in is off, and only answers connections from the machine itself.

### With GitHub sign-in

To test the real sign-in flow, run the API and the dashboard in two terminals. Create a
GitHub OAuth App for local development with the callback
`http://localhost:5173/api/auth/github/callback`.

```sh
# terminal 1 — API on :8080
PUBLIC_URL=http://localhost:5173 GITHUB_CLIENT_ID=… GITHUB_CLIENT_SECRET=… \
  ALLOWED_GITHUB_USERS=your-github-username make run

# terminal 2 — dashboard on http://localhost:5173 (proxies /api to :8080)
make dev-web
```

### Commands

| Command | Does |
| --- | --- |
| `make verify` | The full quality gate ([`scripts/verify.sh`](scripts/verify.sh)); CI runs the same file |
| `make test` | Go (race detector), tracker and dashboard tests and builds |
| `make lint` | Biome and gofmt, then golangci-lint |
| `make format` | Fix formatting |
| `make tracker` | Rebuild `apps/server/internal/script/script.js` after editing `apps/tracker/src` |
| `make run` | Local server on :8080 |
| `make docker` | Build the image; then `infra/docker/test-restore.sh` and `test-backup.sh` prove backups work |
| `make deploy` | Server to Cloud Run, dashboard to Firebase Hosting (refuses unpushed work) |

> [!TIP]
> Changed anything under `infra/`? `make verify` also runs Terraform `fmt` and `validate`,
> shellcheck, hadolint and actionlint, the same as CI's `infra` job.

IP geolocation by [DB-IP](https://db-ip.com) (CC BY 4.0).

## License

[MIT](LICENSE)
