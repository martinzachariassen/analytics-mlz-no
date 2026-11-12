# Self-hosting

> **TL;DR** — Start the server with
> `docker compose -f infra/docker/docker-compose.yml up -d --build`, add a site with
> `analytics sites add -domain example.com`, and put the script tag on your pages. Data lives in
> a single SQLite file.

**Read this if:** you want to run the server on your own machine or VM. To deploy to Google
Cloud, see [deploy-gcp.md](deploy-gcp.md).

> [!IMPORTANT]
> **The dashboard is not in the server image yet.** The image serves the API, the tracking script
> and event collection. The dashboard in `apps/web/` is a static single-page app, and it must be
> served from the **same origin** as `/api` (production uses Firebase Hosting with a rewrite).
> This will be settled before 1.0 (see [decisions.md](../decisions.md#open-items)).

## 1. Install

| Option | How |
|---|---|
| **Docker image** (linux/amd64, linux/arm64) | `docker pull ghcr.io/martinzachariassen/analytics-mlz-no:latest`, or pin a version such as `:0.1.0` |
| **Static binary** (Linux and macOS, amd64 and arm64) | From the [releases page](https://github.com/martinzachariassen/analytics-mlz-no/releases). Verify it with `checksums.txt`. The binary has no GeoIP database: set `GEOIP_DB_PATH` to a DB-IP Lite country `.mmdb` file to record countries |
| **From source** | `make run` (see [CONTRIBUTING.md](../../CONTRIBUTING.md)) |

## 2. Start it and add a site

```sh
docker compose -f infra/docker/docker-compose.yml up -d --build
docker compose -f infra/docker/docker-compose.yml exec analytics analytics sites add -domain example.com
```

`sites add` prints the site id. To run a published release instead of building from source:

```sh
ANALYTICS_IMAGE=ghcr.io/martinzachariassen/analytics-mlz-no:0.1.0 \
  docker compose -f infra/docker/docker-compose.yml up -d --no-build
```

Send a test event:

```sh
curl -A "Mozilla/5.0" -H "Origin: https://example.com" \
  --data '{"site":"<site-id>","url":"https://example.com/"}' http://localhost:8080/api/event
```

A `202` means the event was accepted. Then add the script to your site; see
[tracking.md](tracking.md).

## 3. Dashboard sign-in (GitHub)

1. Create an OAuth App at <https://github.com/settings/developers>.
   - Homepage URL: your `PUBLIC_URL`
   - Authorization callback URL: `<PUBLIC_URL>/api/auth/github/callback`
2. Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `ALLOWED_GITHUB_USERS` (comma-separated
   GitHub usernames) in `infra/docker/docker-compose.yml`, or in your environment.

There are no passwords. On first sign-in a username is bound to its GitHub account id, so a
username that is renamed and registered again by someone else cannot take over access.

## 4. Behind a reverse proxy

Set `PROXY_HOPS=1` when nginx, Caddy or Traefik sits in front of the server. Otherwise every
visitor looks like the proxy. See [configuration.md](../reference/configuration.md#proxy_hops).

## 5. Backups

- Set `LITESTREAM_REPLICA_URL` (for example `s3://bucket/analytics` or `gs://bucket/analytics`)
  for continuous replication. The image restores from the replica on start when the database
  file is missing.
- Without Litestream, use `sqlite3 analytics.db ".backup backup.db"`. Copying the file of a
  running server can give an inconsistent copy, because the database runs in WAL mode.
- `infra/docker/test-restore.sh` checks backup and restore against the local image.

## Next steps

- [Tracking your site](tracking.md)
- [All configuration options](../reference/configuration.md)
- [Upgrading](upgrading.md) · [Runbook](../operations/runbook.md)
