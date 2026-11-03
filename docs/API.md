# API

All dashboard endpoints require a session cookie (`__session`) obtained by signing in.
Responses are JSON; errors look like `{"error": "message"}`.
Requests with a body must use `Content-Type: application/json` (this is also the CSRF protection).

## Public

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/event` | Collect an event (used by `script.js`) |
| `GET` | `/api/script.js` | Tracking script |
| `GET` | `/healthz` | Health check |

`POST /api/event` body:

```json
{ "site": "SITE_ID", "type": "pageview", "url": "https://example.com/page?utm_source=x", "referrer": "https://google.com/" }
{ "site": "SITE_ID", "type": "event", "name": "signup", "url": "https://example.com/", "props": { "plan": "pro" } }
```

## Authentication

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/auth/config` | `{"providers": ["github"]}` — enabled sign-in options |
| `GET` | `/api/auth/github/login` | Redirects to GitHub; returns to `PUBLIC_URL/` when done |
| `GET` | `/api/auth/github/callback` | OAuth callback (configure this URL in the GitHub OAuth App) |
| `GET` | `/api/auth/me` | `{"login": "...", "provider": "github"}` or 401 |
| `POST` | `/api/auth/logout` | Ends the session (204) |

A failed sign-in redirects to `PUBLIC_URL/?auth_error=<code>` where code is one of
`state`, `denied`, `not_allowed`, `conflict`, `failed`.

## Sites

| Method | Path | Body | Description |
|---|---|---|---|
| `GET` | `/api/sites` | | List sites |
| `POST` | `/api/sites` | `{"name", "domain"}` | Create (201; 409 if the domain exists) |
| `GET` | `/api/sites/{id}` | | Get one |
| `PATCH` | `/api/sites/{id}` | `{"name", "domain"}` | Update |
| `DELETE` | `/api/sites/{id}` | | Delete the site **and all its events** (204) |

## Statistics

Common query parameters:

| Param | Default | Description |
|---|---|---|
| `from` | today | `YYYY-MM-DD`, inclusive |
| `to` | `from` | `YYYY-MM-DD`, inclusive |
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

## Privacy note on "visitors"

Visitor ids rotate daily, so a person visiting on three different days counts as three
visitors in a multi-day range. This is the trade-off for not using cookies.
