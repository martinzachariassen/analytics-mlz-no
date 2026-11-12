# Backend development

> **TL;DR** — The server is a standard-library Go program in `apps/server`. Routes are wired in
> `internal/server/server.go`, handlers live in `internal/ingest` (tracking) and `internal/api`
> (dashboard), and all SQL lives in `internal/store`. Tests use a real SQLite file in a temp
> directory, so there are no mocks. Run `go test -race ./apps/server/...` and
> `cd apps/server && golangci-lint run`.

**Read this if:** you are going to change Go code. Read [ARCHITECTURE.md](../../ARCHITECTURE.md)
first for the map and the invariants.

## The basics

```sh
make run                                   # server on :8080, data in ./data
make dev                                   # server + dashboard + demo site, sign-in is one click
go test -race ./apps/server/...            # all Go tests (also part of make test)
cd apps/server && golangci-lint run        # lint (config in apps/server/.golangci.yml)
```

There is no hot reload. Stop the server with <kbd>Ctrl+C</kbd> and start it again.

Ground rules (each one is explained in [ARCHITECTURE.md](../../ARCHITECTURE.md#invariants)):

- Pure Go, no CGO. Standard library `net/http` routing with method patterns (`"GET /api/sites/{id}"`).
- Never store an IP address or a raw user agent, and never log them.
- Never put user input into SQL. Column names come from whitelists; values are `?` parameters.
- Mutating dashboard endpoints read their body with `httpx.ReadJSON`.
- Migrations only move forward.

## How a request flows

| Request | Path through the code |
|---|---|
| `POST /api/event` | `server.New` → `ingest.Handler.ServeHTTP` (limits, bot check, `buildEvent`) → `visitor.Hasher.ID` → `geo.Locator.Country` → `store.InsertEvent` |
| `GET /api/sites/{id}/stats` | `server.New` → `auth.Service.Require` → `api.API.stats` → `parseQuery` (period, tz, filters) → `store.Summary` and `store.Timeseries` |
| `GET /api/sites/{id}/breakdown` | … → `api.API.breakdown` → check against `store.Dimensions` → `store.Breakdown` |
| `/api/auth/github/*` | `server.New` (rate limit 5/30 per IP) → `auth.Service` → `auth.GitHub` |

Errors go back as `{"error": "…"}` through `httpx.Error`. Unexpected errors are logged by
`api.API.internal` and returned as `500 internal error`, so details never reach the client.

## Recipes

### Add a dashboard endpoint

1. Write the handler as a method on `api.API` (in `api.go` for site management, `stats.go` for
   statistics). Get the site with `a.site(w, r)`, which returns `404` for unknown ids.
2. Add it to the `routes` map in `API.Register`. Every route there is wrapped in
   `auth.Service.Require`, so it needs a signed-in session.
3. If it changes data, read the body with `httpx.ReadJSON` and use `POST`, `PATCH` or `DELETE`.
4. Put the SQL in a `store` method, not in the handler.
5. Test auth and routing through the full router with `setup(t)` in
   `internal/server/server_test.go`, which gives you a handler and a signed-in cookie. Test
   response contents with `newTestAPI(t, now, events)` in `internal/api/handlers_test.go`, which
   serves the API on a seeded store with a fixed clock and no auth.
6. Add it to [reference/api.md](../reference/api.md) and the typed client in
   `apps/web/src/lib/api.ts`.

### Add a breakdown or filter dimension

Dimensions are whitelists, so a new one touches several lists on purpose:

1. `store.Dimensions` (`stats.go`) to allow it in `/breakdown`, and a `case` in `store.Breakdown`
   that says how to count it.
2. `store.FilterDims` (`filter.go`) and the right kind map (`visitorCols`, `pageCols` or
   `visitCols`) to allow filtering by it. The comment above those maps explains the kinds.
3. If it needs a new column: a migration, a field on `store.Event`, the `INSERT` in
   `store.InsertEvent`, and the value set in `ingest.buildEvent`. Check
   [privacy.md](../privacy.md) first, and update it, because this changes what is stored.
4. The dashboard: the `Dimension` and `FilterDim` types in `apps/web/src/lib/api.ts`, a label in
   `lib/dims.ts`, and a report that shows it (see [dashboard.md](dashboard.md)).
5. Document it in [reference/api.md](../reference/api.md#statistics).

### Add a migration

1. Create `apps/server/internal/store/migrations/NNNN_short_name.sql`, numbered one higher than
   the last file. The number is the version stored in `schema_migrations`.
2. Write plain SQLite DDL. Each file runs in its own transaction at startup, once.
3. Never edit or rename a migration that has been released. Fix mistakes with a new one.
4. Add-only changes (new table, new nullable column, new index) are safe on a running Cloud Run
   instance. Anything that rewrites a large table should be mentioned in
   [upgrading.md](../guides/upgrading.md) and `CHANGELOG.md`.

`TestMigrationsAreIdempotent` checks that opening a database twice works.

### Add an environment variable

1. Read it in `config.Load` (`internal/config/config.go`). Nothing else may call `os.Getenv`.
   Validate it there, so a bad value stops the server at startup.
2. Add a row to [reference/configuration.md](../reference/configuration.md), and if it should
   be set on Cloud Run, a variable in `infra/terraform/main/variables.tf` and an `env` block in
   `run.tf`.

### Change what the ingest endpoint accepts

The checks in `ingest.Handler.ServeHTTP` run cheapest first, and the order is deliberate (see
[ARCHITECTURE.md](../../ARCHITECTURE.md#cross-cutting-concerns)). When you add a rejection:

- Return `202` for anything a bot could use to learn what is filtered, and an error status for
  real client mistakes.
- Call `h.reject(r, level, reason, status, siteID)` so it is logged with a `reason`. Use
  `slog.LevelInfo` for bad payloads and `slog.LevelDebug` for floods and bots.
- Update the table in [operations/bots.md](../operations/bots.md) and the status list in
  [reference/api.md](../reference/api.md).

## Tests

| Package | What the tests cover | Helper |
|---|---|---|
| `store` | SQL: sites, sessions, salts, stats, filters, purge | `openTemp(t)` |
| `server` | The whole router: auth, CRUD, CSRF (`Content-Type`), rate limits, headers | `setup(t)`, `call(...)` |
| `ingest` | Validation, bot detection, limits, rejection reasons | |
| `api` | Query parsing, periods, time zones, DST; handler responses on a seeded store with a fixed clock | `newTestAPI(t, now, events)`, `get[T]` |
| `auth` | OAuth flow, sessions, `DEV_LOGIN` | |
| `httpx`, `config`, `script`, `devdata` | Small units | |

Tests open a real SQLite database in `t.TempDir()`. Prefer that over interfaces and fakes. Run
with `-race`, as CI does.

<details>
<summary>Advanced: performance and SQLite</summary>

- The database is opened in WAL mode (`store.Open`) with two connection pools. All writes go
  through the write pool, which has one connection because SQLite allows one writer at a time.
  Statistics and lookups use a read-only pool (`query_only`, `readConns` connections), so a
  slow dashboard query never holds the connection an incoming event needs. A new store method
  that only reads uses `s.rdb`; anything that writes, or reads inside a write transaction,
  uses `s.db`.
- Concurrent inserts queue for the write connection, so `ingest` limits them to 32 write slots
  and returns `503` after waiting 2 seconds.
- Stats are computed from raw rows. Visit metrics group by `session_id`. If a query gets slow,
  check the indexes in the migrations before adding caching.
- `go run ./apps/server/cmd/loadtest` sends synthetic events to a running server. Use it to see
  the effect of a change on ingest throughput.
- `seed -scale 10` gives a larger dataset for checking query times in the dashboard.

</details>

## Next steps

- [Dashboard development](dashboard.md)
- [API reference](../reference/api.md)
- [Releasing](releasing.md)
