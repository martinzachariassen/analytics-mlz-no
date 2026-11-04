# analytics-mlz-no

Lightweight, privacy-friendly, self-hostable web analytics written in Go.

- Cookie-free, anonymous visitor counting (no IP addresses stored)
- Page views, SPA navigation, outbound links and custom events
- SQLite storage (with optional Litestream replication)
- React + Vite + shadcn/ui dashboard, GitHub sign-in

[![CI](https://github.com/martinzachariassen/analytics-mlz-no/actions/workflows/ci.yml/badge.svg)](https://github.com/martinzachariassen/analytics-mlz-no/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Status: pre-1.0.** It works and is used on the author's own sites, but configuration and
> the database schema can still change between minor versions. Read the
> [changelog](CHANGELOG.md) before upgrading. Design decisions: [docs/PLAN.md](docs/PLAN.md).

## Install

**Docker image** (linux/amd64, linux/arm64) from the GitHub Container Registry:

```sh
docker pull ghcr.io/martinzachariassen/analytics-mlz-no:latest   # or pin a version, e.g. :0.1.0
```

**Static binary** (Linux and macOS, amd64 and arm64) from the
[releases page](https://github.com/martinzachariassen/analytics-mlz-no/releases). Verify it with
`checksums.txt`. The binary has no GeoIP database; set `GEOIP_DB_PATH` to a DB-IP Lite country
`.mmdb` file to record countries.

**From source:** see [Development](#development).

> **Dashboard hosting:** the server image serves the API and the tracking script. The dashboard
> in `apps/web/` is a static single-page app that must be served from the same origin as `/api`
> (production uses Firebase Hosting with a rewrite; see [docs/DEPLOY.md](docs/DEPLOY.md)).

## Documentation

- [Privacy: what is stored and what is not](docs/PRIVACY.md)
- [Tracking script, CSP and caching](docs/TRACKER.md)
- [API reference](docs/API.md)
- [Deploying to Google Cloud](docs/DEPLOY.md)
- [Upgrading and rolling back](docs/UPGRADING.md)
- [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) · [Changelog](CHANGELOG.md)

## Quick start (Docker)

```sh
docker compose -f infra/docker/docker-compose.yml up -d --build
docker compose -f infra/docker/docker-compose.yml exec analytics analytics sites add -domain example.com
```

### Dashboard sign-in (GitHub)

1. Create an OAuth App at <https://github.com/settings/developers>.
   - Homepage URL: your `PUBLIC_URL`
   - Authorization callback URL: `<PUBLIC_URL>/api/auth/github/callback`
2. Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `ALLOWED_GITHUB_USERS` (comma-separated GitHub usernames).

There are no passwords. On first sign-in a username is bound to its GitHub account id,
so a renamed-and-reregistered username cannot take over access.

Send a test event:

```sh
curl -A "Mozilla/5.0" --data '{"site":"<site-id>","url":"https://example.com/"}' http://localhost:8080/api/event
```

## Tracking your site

Add the script to every page (replace the host and site id):

```html
<script defer src="https://analytics.example.com/api/script.js" data-site="SITE_ID"></script>
```

That's it — page views (including SPA navigation via `history.pushState`) and clicks on
outbound links are tracked automatically. The script is ~0.9 KB gzipped and sets no cookies.

**Custom events**

```html
<button data-track="signup" data-track-plan="pro">Sign up</button>
```

```js
window.mlz.track("signup", { plan: "pro", seats: 3 });
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

## API

See [docs/API.md](docs/API.md).

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
| `PUBLIC_URL` | `http://localhost:8080` | Dashboard URL; used for the OAuth callback. `https://` enables Secure cookies |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | – | GitHub OAuth App credentials (enables sign-in) |
| `ALLOWED_GITHUB_USERS` | – | Comma-separated GitHub usernames allowed to sign in |
| `LITESTREAM_REPLICA_URL` | – | Continuous backup, e.g. `gs://bucket/analytics` or `s3://bucket/analytics` |
| `DEV_LOGIN` | – | `1` signs everyone in as `dev`, for local development only (requires a `localhost` `PUBLIC_URL`) |

## Development

### Repository layout

```
apps/
  server/     Go API and ingest (go.mod lives here)
  web/        Dashboard (React, Vite, shadcn/ui)
  tracker/    Tracking script (TypeScript), built into apps/server/internal/script
  demo/       Demo site used by `make dev`
infra/
  docker/     Dockerfile, docker-compose, Litestream, restore test
  terraform/  GCP: bootstrap and main
docs/         Guides and reference
```

The quickest way to try everything locally is one command, with no sign-in or setup:

```sh
make dev
```

It starts the API (:8080), the dashboard (http://localhost:5173) and a small demo site
(http://localhost:8081), and prints the links. It uses a separate database, `data/dev.db`,
with two demo sites ("Demo blog" and "Demo docs") filled with two years of synthetic
traffic: growth, weekends, seasonal dips, a couple of traffic spikes, returning visitors
and custom events. The public home page (`/`) explains the product and has a one-click
"Open demo dashboard" button, with no account or password. Clicking around the demo site sends real events through the tracking
script, and they show up in the realtime counter and charts.

- `make dev-reset` deletes `data/dev.db`, so the next `make dev` starts with fresh data.
- `go run ./apps/server/cmd/analytics seed -h` shows options (`-days`, `-scale`, `-reset`).
- One-click sign-in is `DEV_LOGIN=1`. The server refuses it unless `PUBLIC_URL` is on
  `localhost` and GitHub sign-in is off.

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

```sh
make test     # Go + tracker + dashboard tests
make tracker  # rebuild apps/server/internal/script/script.js after editing apps/tracker/src
make lint   # golangci-lint
make run    # local server on :8080
```

IP geolocation by [DB-IP](https://db-ip.com) (CC BY 4.0).

## License

[MIT](LICENSE)
