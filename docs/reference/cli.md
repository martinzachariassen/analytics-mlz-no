# CLI reference

> **TL;DR** — One binary, `analytics`. With no arguments it runs the server. The other
> subcommands work on the database file in `DATABASE_PATH`: `sites add -domain example.com`
> creates a site and prints its id, `sites list` shows all sites, `events purge` deletes spam,
> `sessions revoke` signs dashboard users out, `seed` fills demo data, and `version` prints the
> build.

**Read this if:** you run the server yourself, or need to add a site or clean up data from a shell.

| Command | What it does |
|---|---|
| `analytics` or `analytics serve` | Runs the HTTP server |
| `analytics sites add -domain D [-name N]` | Creates a site and prints its id |
| `analytics sites list` | Lists all sites |
| `analytics events purge -site ID -from T -to T [-path P]` | Deletes events in a time window |
| `analytics sessions revoke [-user LOGIN]` | Signs one dashboard user, or everyone, out everywhere |
| `analytics seed [-days N] [-scale X] [-reset]` | Creates the two demo sites with synthetic traffic |
| `analytics version` | Prints the version, without reading any configuration |

Every command except `version` reads the same environment variables as the server (see
[configuration.md](configuration.md)). The one that matters for admin commands is
`DATABASE_PATH`, which defaults to `data/analytics.db` relative to the working directory.

## How to run it

| Where | How |
|---|---|
| From the repo | `go run ./apps/server/cmd/analytics <command>` |
| Release binary | `./analytics <command>` |
| Docker Compose | `docker compose -f infra/docker/docker-compose.yml exec analytics analytics <command>` |
| Docker image | `docker run --rm -v <volume>:/data ghcr.io/martinzachariassen/analytics-mlz-no <command>` |

In the Docker image, `entrypoint.sh` starts Litestream and the server only for `serve` (or no
arguments). Any other subcommand runs directly against `/data/analytics.db`.

> [!NOTE]
> Admin commands open the SQLite file directly, so they must run where the file is. That is safe
> while the server is running (SQLite in WAL mode handles both). On Cloud Run there is no shell
> next to the file, so use the API instead: the dashboard's **Settings** page to add sites, and
> `POST /api/sites/{id}/purge` to delete spam (see [api.md](api.md)).

## `serve`

```sh
analytics serve
```

Opens (and migrates) the database, starts the retention cleanup if `RETENTION_DAYS` is set (once
an hour), and listens on `ADDR` or `PORT`. On `SIGINT` or `SIGTERM` it stops accepting requests
and waits up to 5 seconds for running ones, which leaves Litestream time for a final sync on
Cloud Run.

The startup log tells you what is enabled. Look for these lines:

| Log line | Means |
|---|---|
| `listening` | Started. Includes `version`, `addr`, `db` and `log_level` |
| `github sign-in enabled` | OAuth configured. Shows the allowed users and the callback URL to register with GitHub |
| `GITHUB_CLIENT_ID not set; dashboard sign-in is disabled` | Tracking works, but nobody can sign in |
| `GEOIP_DB_PATH not set; country will not be recorded` | No country data. The Docker image ships a database, so this is normal only for `go run` |
| `DEV_LOGIN=1: …` | Local development mode. Never in production |

## `sites add`

```sh
analytics sites add -domain example.com -name "My blog"
```
```
Created site "My blog" (example.com)
Site ID: k3f9c1a2bq7x
```

| Flag | Required | Meaning |
|---|---|---|
| `-domain` | yes | The domain you track. Scheme, path, port and a leading `www.` are stripped, internationalised names are stored in punycode, and subdomains are accepted automatically. It must contain a dot (`localhost` and `*.localhost` excepted), so `no` cannot match every `.no` site. Each domain can only be added once |
| `-name` | no | Display name. Defaults to the domain. Trimmed to 100 characters |

The id is 12 random characters. Put it in the script tag (see [tracking.md](../guides/tracking.md)).

## `sites list`

```sh
analytics sites list
```
```
ID          NAME       DOMAIN        CREATED
k3f9c1a2bq7x  My blog     example.com   2026-11-04
```

Deleting or renaming a site is done in the dashboard (**Settings**) or through the API.

## `events purge`

Deletes events for one site in a time window, for example after a spam burst.

```sh
# Everything on 3 November (UTC)
analytics events purge -site k3f9c1a2bq7x -from 2026-11-03 -to 2026-11-04

# Only one path, in a one-hour window
analytics events purge -site k3f9c1a2bq7x -from 2026-11-03T14:00:00Z -to 2026-11-03T15:00:00Z -path /wp-login.php
```
```
Deleted 1234 events.
```

| Flag | Required | Meaning |
|---|---|---|
| `-site` | yes | Site id |
| `-from` | yes | Start, **inclusive**. `YYYY-MM-DD` (midnight UTC) or RFC 3339 |
| `-to` | yes | End, **exclusive**. Same formats. Must be after `-from` |
| `-path` | no | Only delete events with exactly this path |

> [!WARNING]
> There is no undo except restoring a backup. Check the window in the dashboard first (filter by
> the path and set the same dates). The full procedure is in the
> [runbook](../operations/runbook.md).

## `sessions revoke`

Signs dashboard users out everywhere by deleting their sessions.

```sh
analytics sessions revoke -user octocat   # one user
analytics sessions revoke                 # everyone
```
```
Revoked 3 sessions.
```

| Flag | Required | Meaning |
|---|---|---|
| `-user` | no | GitHub login whose sessions to delete. Without it, every session is deleted |

You rarely need it: removing a username from `ALLOWED_GITHUB_USERS` already signs that user out
at their next request. Use it when a laptop is lost or a session cookie may have leaked. Like the
other admin commands it needs the database file, so on Cloud Run remove the user from the
allowlist instead.

## `seed`

```sh
analytics seed            # used by make dev
DEV_LOGIN=1 analytics seed -reset     # regenerate the demo data
analytics seed -days 90 -scale 0.2
```

Creates "Demo blog" (`localhost`) and "Demo docs" (`docs.localhost`) and fills them with
synthetic traffic from `internal/devdata`. A demo site that already exists is left alone unless
you pass `-reset`, which deletes it and its events first.

| Flag | Default | Meaning |
|---|---|---|
| `-days` | `730` | Days of history |
| `-scale` | `1` | Multiplies the amount of traffic |
| `-reset` | off | Delete and recreate the demo sites. Refused unless `DEV_LOGIN=1`, so it cannot wipe a production database by accident |

Only use it on a development database. `make dev` runs it with `DATABASE_PATH=data/dev.db`.

## `version`

```sh
analytics version   # also -version and --version
```

Prints `analytics <version>`. It works without any environment, so it is safe in health scripts.

## Exit codes

`0` on success. On an error the command prints `error: …` to stderr and exits with `1`.
Unknown flags print the usage of that subcommand and exit with `2`.

## Next steps

- [Configuration](configuration.md): every environment variable
- [API reference](api.md): the same operations over HTTP
- [Runbook](../operations/runbook.md): when to use `events purge`
