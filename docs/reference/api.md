# API reference

> **TL;DR** — Three public endpoints: `POST /api/event` (the tracker), `GET /api/script.js` and
> `GET /healthz`. Everything under `/api/sites` needs the `__session` cookie from signing in. It
> returns sites and statistics as JSON for a date range, a time zone and optional filters.
> Errors are `{"error": "message"}`. Requests with a body must send
> `Content-Type: application/json`, and requests without one must come from the dashboard's own
> origin; that is the CSRF protection.

**Read this if:** you are building on the API, debugging the dashboard, or want to know what a
status code means. The dashboard's typed client is `apps/web/src/lib/api.ts`.

| Section | Endpoints |
|---|---|
| [Public](#public) | `/api/event`, `/api/script.js`, `/healthz` |
| [Authentication](#authentication) | `/api/auth/*` |
| [Sites](#sites) | `/api/sites`, `/api/sites/{id}` |
| [Cleaning up spam](#cleaning-up-spam) | `/api/sites/{id}/purge` |
| [Statistics](#statistics) | `/stats`, `/breakdown`, `/heatmap`, `/realtime` |

## Calling the API from a shell

There are no API tokens. Use the session cookie. Locally, with `make dev` running, sign in as the
dev user into a cookie jar:

```sh
curl -s -c jar -b jar -L -o /dev/null http://localhost:8080/api/auth/dev/login
curl -s -b jar http://localhost:8080/api/auth/me          # {"login":"dev","provider":"dev"}
curl -s -b jar http://localhost:8080/api/sites
curl -s -b jar "http://localhost:8080/api/sites/<id>/stats?from=2026-11-01&to=2026-11-07&tz=Europe/Oslo"
curl -s -b jar "http://localhost:8080/api/sites/<id>/breakdown?dim=referrer&limit=5&f=country:is:NO"
```

Requests with a body need the JSON content type, or they get `400`:

```sh
curl -s -b jar -H 'Content-Type: application/json' \
  -d '{"from":"2026-11-03T14:00:00Z","to":"2026-11-03T15:00:00Z","path":"/wp-login.php"}' \
  http://localhost:8080/api/sites/<id>/purge
```

In production, sign in with the browser, copy the `__session` cookie from the developer tools,
and pass it with `-b "__session=…"`. Treat it like a password: it stays valid while it is used
and expires after 7 days without use, when you sign out, or when your username is removed from
`ALLOWED_GITHUB_USERS`.

## Conventions

These apply to every endpoint under `/api/sites` and `/api/auth`:

| Rule | Otherwise |
|---|---|
| Responses are JSON, including `404` and `405`: `{"error": "message"}` | — |
| A request with a body sends `Content-Type: application/json` and exactly one JSON object with no unknown fields | `400` |
| A request without a body that changes something (`DELETE`, logout) carries an `Origin` (or, failing that, `Referer`) that is the dashboard's own origin | `403` |
| A session cookie is present and its user is still on the allowlist | `401` |

The JSON content type and the origin check together are the CSRF protection: a foreign page can
send neither. Every response also carries `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`, a deny-all `Content-Security-Policy`, `X-Frame-Options: DENY` and,
when `PUBLIC_URL` is https, `Strict-Transport-Security`. The server sets these itself, so the
direct Cloud Run URL and self-hosted instances get them without a proxy.

## Public

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/event` | Collect an event (used by `script.js`) |
| `OPTIONS` | `/api/event` | CORS preflight: allows any origin, `POST`, `Content-Type` |
| `GET` | `/api/script.js` | Tracking script (gzip, `ETag`, cached for an hour) |
| `GET` | `/healthz` | Health check: `200 {"status":"ok"}`, or `503` when the database does not answer within 2 seconds |

`GET /healthz` is JSON and never cached (`Cache-Control: no-store`). Probes only need the
status code. `200` body:

```json
{ "status": "ok" }
```

`503` body:

```json
{ "status": "unavailable", "error": "database unavailable" }
```

`POST /api/event` body:

```json
{ "site": "SITE_ID", "type": "pageview", "url": "https://example.com/page?utm_source=x", "referrer": "https://google.com/" }
{ "site": "SITE_ID", "type": "event", "name": "signup", "url": "https://example.com/", "props": { "plan": "pro" } }
```

Requests must carry an `Origin` header (browsers always send it on `POST`, including
`sendBeacon`) whose host is the site's domain or a subdomain; `null` is accepted. The `url` must
be `http(s)` and its host must match too. Unknown fields are ignored. Responses:

| Status | Meaning |
|---|---|
| `202` | Accepted. Also returned, without storing anything, for bots and for a visitor over its own rate limit, so scripts get no signal. |
| `400` | Unknown site, foreign host or origin, missing `Origin`, invalid payload. |
| `413` | Body over 8 KB. |
| `429` | Too many requests from one client IP (10/s, burst 30), or from one upstream address. |
| `503` | Server is shedding load: over `INGEST_RATE_LIMIT`, write queue full, or the database is over `MAX_DATABASE_MB`. Sent with `Retry-After`. The tracker does not retry. |

Control characters and bidi overrides are stripped from stored text, and referrers that are not
plain DNS hostnames are dropped. `/api/auth/*` is rate limited per IP (5/s, burst 30).

## Authentication

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/auth/config` | `{"providers": ["github"]}` — enabled sign-in options (`["dev"]` with `DEV_LOGIN=1`, `[]` with none) |
| `GET` | `/api/auth/github/login` | Redirects to GitHub (OAuth with PKCE); returns to `PUBLIC_URL/` when done. Starting a sign-in ends any existing session |
| `GET` | `/api/auth/github/callback` | OAuth callback (configure this URL in the GitHub OAuth App) |
| `GET` | `/api/auth/dev/login`, `/api/auth/dev/callback` | Only with `DEV_LOGIN=1`: signs in as `dev` without a provider. Refused (`403`) unless the connection comes from the loopback interface |
| `GET` | `/api/auth/me` | `{"login": "...", "provider": "github"}` or 401 |
| `POST` | `/api/auth/logout` | Ends the session (204). Same-origin only (`403`) |

A failed sign-in redirects to `PUBLIC_URL/?auth_error=<code>` where code is one of
`state`, `denied`, `not_allowed`, `conflict`, `failed`. The sign-in page must be completed
within 10 minutes (`state` otherwise).

Sessions last 7 days without use. A request made more than a day into a session extends it by
another 7 days and sends a refreshed cookie. The allowlist is checked on every request: a user
removed from `ALLOWED_GITHUB_USERS` gets `401` and their sessions are deleted.
`analytics sessions revoke [-user LOGIN]` deletes sessions from the command line.

## Sites

| Method | Path | Body | Description |
|---|---|---|---|
| `GET` | `/api/sites` | | List sites |
| `POST` | `/api/sites` | `{"name", "domain"}` | Create (201; 409 if the domain exists; 400 if the domain is not a hostname). `name` defaults to the domain |
| `GET` | `/api/sites/{id}` | | Get one |
| `PATCH` | `/api/sites/{id}` | `{"name", "domain"}` | Update the fields given. An absent or empty `domain` keeps the current one; an absent or empty `name` resets it to the domain |
| `DELETE` | `/api/sites/{id}` | | Delete the site **and all its events** (204). Same-origin only (`403`) |

`domain` is normalised: scheme, path, port and a leading `www.` are removed, and
internationalised names are stored in punycode (`ærø.no` → `xn--r-3fa9c.no`). It must contain a
dot (`localhost` and `*.localhost` excepted), so a bare TLD cannot match every site under it.
Names are trimmed to 100 characters. Site creation, changes, deletion and purges are logged with
the signed-in user.

## Cleaning up spam

`POST /api/sites/{id}/purge` with `{"from": "2026-11-01T00:00:00Z", "to": "2026-11-02T00:00:00Z", "path": "/optional"}`
deletes the site's events with `from <= time < to` (and the given exact path, if any). Returns
`{"deleted": n}`. This cannot be undone.

## Statistics

Common query parameters:

| Param | Default | Description |
|---|---|---|
| `from` | today | `YYYY-MM-DD`, inclusive |
| `to` | `from` | `YYYY-MM-DD`, inclusive. At most 5 years after `from` |
| `tz` | `UTC` | IANA time zone, e.g. `Europe/Oslo`; days and months follow local midnight |
| `f` | | Filter, repeatable (AND): `dim:op:value`, e.g. `f=country:is:NO&f=path:contains:/blog` |
| `compare` | | `previous` or `year`; see below |

Filters (at most 10):

- `dim` is one of `path`, `hostname`, `entry`, `exit`, `referrer`, `utm_source`,
  `utm_medium`, `utm_campaign`, `country`, `browser`, `os`, `device`, `event`.
- `op` is `is`, `is_not` or `contains` (case-sensitive substring; the value may contain `:`).
- How a filter applies depends on the dimension:
  - **Visitor dimensions** (`country`, `browser`, `os`, `device`) are constant within a visit.
  - **Page dimensions** (`path`, `hostname`) narrow page views to that page, and narrow
    visit metrics (visits, bounce rate, duration) to visits that included the page.
    `is_not` means visits without the page.
  - **Visit dimensions** (`entry`, `exit` and the sources) come from the first page view
    of the visit, or the last one for `exit`.
  - **`event`** selects visits in which that custom event happened.

Comparison periods:

- `previous` (the default) is the same-length period right
  before `from`. A range of whole calendar months is compared with the same number of
  months before it.
- `year` is the same dates one year earlier.

### `GET /api/sites/{id}/stats`

Extra param `interval` = `hour` (≤ 7 days) | `day` (≤ 400 days) | `week` (starting Monday) | `month`.
Default: hour for ≤ 2 days, day for ≤ 93 days, otherwise month.

```json
{
  "period":   { "from": "2026-11-01", "to": "2026-11-03", "tz": "Europe/Oslo", "interval": "day" },
  "summary":  { "pageviews": 120, "visitors": 45, "visits": 60, "bounce_rate": 0.42, "avg_duration": 73.5 },
  "previous": { "pageviews": 98, "visitors": 40, "visits": 51, "bounce_rate": 0.47, "avg_duration": 61.0 },
  "timeseries": [
    { "t": "2026-11-01T00:00:00+01:00", "pageviews": 40, "visitors": 15,
      "visits": 20, "bounce_rate": 0.4, "avg_duration": 70.2 }
  ],
  "previous_timeseries": [ "… only with compare, same shape, aligned by index …" ],
  "compare": { "from": "2026-10-29", "to": "2026-10-31", "tz": "Europe/Oslo", "interval": "day" }
}
```

- `previous` summarises the comparison period: `previous` by default, or `year` when
  `compare=year`.
- With `compare`, the response also has `previous_timeseries` (one bucket per current
  bucket) and `compare`, which gives that period's dates.
- `bounce_rate` is the share of visits with at most one page view.
- `avg_duration` is seconds per visit.
- In buckets, a visit counts in the bucket where it started.

### `GET /api/sites/{id}/breakdown?dim=…`

Returns `[{ "value": "...", "visitors": 10, "count": 14 }]`, sorted by visitors. `limit` defaults to 10 (max 1000).

| `dim` | `value` | `count` |
|---|---|---|
| `path`, `hostname` | page path / host | page views |
| `entry` | first page of the visit | visits |
| `exit` | last page of the visit | visits |
| `referrer` | referrer host (`""` = direct) | visits |
| `utm_source`, `utm_medium`, `utm_campaign` | UTM value of the visit | visits |
| `country` | ISO code | visits |
| `browser`, `os`, `device` | | visits |
| `event` | custom event name | events |
| `prop_key` (+ `event`) | property key used by that event | events |
| `prop` (+ `event`, `key`) | property value | events |

Options:

- **`metrics=full`** adds `visits`, `bounce_rate` and `avg_duration` to each row. These
  cover visits that include the value: for a page, visits that viewed it; for an event,
  visits in which it happened. Not available for `prop`/`prop_key`.
- **`compare=previous|year`** adds `previous_visitors`, the value's visitors in the
  comparison period.

### `GET /api/sites/{id}/heatmap`

Traffic by weekday and hour in `tz`, for the period and filters:
`{"visitors": [[…24…] ×7], "pageviews": [[…24…] ×7]}`. Rows start on Monday. Visitors are
distinct per hour, then summed per cell.

### `GET /api/sites/{id}/realtime`

`{"visitors": 3}` — distinct visitors in the last 5 minutes.

With `detail=1`, the response also has:

- `minutes`: 30 entries `{t, visitors, pageviews}`, oldest first, ending with the current
  minute.
- `pages`, `referrers` and `countries`: the top 10 for the last 30 minutes, as breakdown rows.

Statistics queries are cancelled after 10 seconds (`500`).

## Privacy note on "visitors"

Visitor ids rotate daily, so a person visiting on three different days counts as three
visitors in a multi-day range. This is the trade-off for not using cookies. Every metric is
defined in [concepts.md](../concepts.md#glossary).

## Next steps

- [Concepts](../concepts.md): what each number means
- [CLI reference](cli.md): the same site and purge operations from a shell
- [Backend development](../development/backend.md#add-a-dashboard-endpoint): add an endpoint
