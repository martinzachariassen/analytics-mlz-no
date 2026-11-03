# analytics-mlz-no

Lightweight, privacy-friendly, self-hostable web analytics written in Go.

- Cookie-free, anonymous visitor counting (no IP addresses stored)
- Page views, SPA navigation, outbound links and custom events
- SQLite storage (with optional Litestream replication)
- React + shadcn/ui dashboard

> 🚧 Early development — not ready for production yet. See [docs/PLAN.md](docs/PLAN.md).

## Quick start (Docker)

```sh
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml exec analytics analytics sites add -domain example.com
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
outbound links are tracked automatically. The script is ~1.2 KB gzipped and sets no cookies.

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
| `PUBLIC_URL` | `http://localhost:8080` | Dashboard URL; used for the OAuth callback. `https://` enables Secure cookies |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | – | GitHub OAuth App credentials (enables sign-in) |
| `ALLOWED_GITHUB_USERS` | – | Comma-separated GitHub usernames allowed to sign in |
| `LITESTREAM_REPLICA_URL` | – | Continuous backup, e.g. `gs://bucket/analytics` or `s3://bucket/analytics` |

## Development

```sh
make test     # Go + tracker tests
make tracker  # rebuild server/internal/tracker/script.js after editing tracker/src
make lint   # golangci-lint
make run    # local server on :8080
```

IP geolocation by [DB-IP](https://db-ip.com) (CC BY 4.0).

## License

[MIT](LICENSE)
