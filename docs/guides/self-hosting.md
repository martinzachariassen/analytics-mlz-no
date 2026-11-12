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
cp infra/docker/.env.example infra/docker/.env   # then edit it
docker compose -f infra/docker/docker-compose.yml up -d --build
docker compose -f infra/docker/docker-compose.yml exec analytics analytics sites add -domain example.com
```

`infra/docker/.env` (git-ignored) holds the settings; every variable is in
[configuration.md](../reference/configuration.md). `sites add` prints the site id. To run a
published release instead of building from source:

```sh
ANALYTICS_IMAGE=ghcr.io/martinzachariassen/analytics-mlz-no:0.1.0 \
  docker compose -f infra/docker/docker-compose.yml up -d --no-build
```

Verify a published image's provenance before you run it:

```sh
gh attestation verify oci://ghcr.io/martinzachariassen/analytics-mlz-no:0.1.0 --owner martinzachariassen
```

The compose file is hardened by default:

- The port binds to `127.0.0.1:8080` only. Put a reverse proxy with TLS in front (see
  [below](#4-behind-a-reverse-proxy)).
- The container runs read-only as an unprivileged user, with all capabilities dropped and
  `no-new-privileges`. `/data` is the only writable volume (plus a `/tmp` tmpfs).
- It is limited to 1 CPU and 512 MB of memory, rotates its logs (3 × 10 MB), and has a healthcheck
  on `/healthz`.

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
   GitHub usernames) in `infra/docker/.env`, or in your environment.

There are no passwords. On first sign-in a username is bound to its GitHub account id, so a
username that is renamed and registered again by someone else cannot take over access.

- `PUBLIC_URL` must be an origin (`https://analytics.example.com`, no path) and `https://` when
  sign-in is enabled. `http://localhost` is the exception.
- Sessions last 7 days without use and are extended while in use.
- Removing a username from `ALLOWED_GITHUB_USERS` signs that user out at their next request.
  `analytics sessions revoke [-user LOGIN]` does it immediately; see
  [cli.md](../reference/cli.md#sessions-revoke).

## 4. Behind a reverse proxy

The compose file only listens on localhost, so a reverse proxy is how the server is reached from
outside. Set `PROXY_HOPS=1` in `infra/docker/.env` when nginx, Caddy or Traefik sits in front of
the server. Otherwise every visitor looks like the proxy. See [configuration.md](../reference/configuration.md#proxy_hops).

## 5. Backups

- Set `LITESTREAM_REPLICA_URL` (for example `s3://bucket/analytics` or `gs://bucket/analytics`)
  for continuous replication. The image restores from the replica on start when the database
  file is missing. S3 and GCS credentials are listed in
  [configuration.md](../reference/configuration.md#environment-variables).
- Set `REQUIRE_REPLICA=1` once the replica holds data. A missing database with an empty replica
  then stops the container instead of starting it empty.
- Without Litestream, use `sqlite3 analytics.db ".backup backup.db"`. Copying the file of a
  running server can give an inconsistent copy, because the database runs in WAL mode.
- `infra/docker/test-restore.sh` checks backup and restore against the local image, and
  `infra/docker/test-backup.sh` checks the standalone backup script (`backup.sh`).

## Next steps

- [Tracking your site](tracking.md)
- [All configuration options](../reference/configuration.md)
- [Upgrading](upgrading.md) · [Runbook](../operations/runbook.md)
