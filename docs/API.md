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

### `GET /api/sites/{id}/stats`

Extra param `interval` = `hour` (≤ 7 days) | `day` (≤ 400 days) | `month`. Default: hour for ≤ 2 days, day for ≤ 93 days, otherwise month.

```json
{
  "period":   { "from": "2026-11-01", "to": "2026-11-03", "tz": "Europe/Oslo", "interval": "day" },
  "summary":  { "pageviews": 120, "visitors": 45, "visits": 60, "bounce_rate": 0.42, "avg_duration": 73.5 },
  "previous": { "pageviews": 98, "visitors": 40, "visits": 51, "bounce_rate": 0.47, "avg_duration": 61.0 },
  "timeseries": [ { "t": "2026-11-01T00:00:00+01:00", "pageviews": 40, "visitors": 15 } ]
}
```

`previous` is the same-length period right before `from`, for trend arrows.
`bounce_rate` is the share of visits with at most one page view; `avg_duration` is seconds per visit.

### `GET /api/sites/{id}/breakdown?dim=…`

Returns `[{ "value": "...", "visitors": 10, "count": 14 }]`, sorted by visitors. `limit` defaults to 10 (max 1000).

| `dim` | `value` | `count` |
|---|---|---|
| `path`, `hostname` | page path / host | page views |
| `entry` | first page of the visit | visits |
| `referrer` | referrer host (`""` = direct) | visits |
| `utm_source`, `utm_medium`, `utm_campaign` | UTM value of the visit | visits |
| `country` | ISO code | visits |
| `browser`, `os`, `device` | | visits |
| `event` | custom event name | events |
| `prop_key` (+ `event`) | property key used by that event | events |
| `prop` (+ `event`, `key`) | property value | events |

### `GET /api/sites/{id}/realtime`

`{"visitors": 3}` — distinct visitors in the last 5 minutes.

## Privacy note on "visitors"

Visitor ids rotate daily, so a person visiting on three different days counts as three
visitors in a multi-day range. This is the trade-off for not using cookies.
