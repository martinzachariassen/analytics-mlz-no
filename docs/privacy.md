# Privacy

> **TL;DR** — No cookies on tracked sites, no IP addresses, no raw user agents. Each event keeps
> only the path, referrer host, UTM tags, country, browser, OS, device type and an anonymous
> visitor id. That id is a hash with a salt that is replaced and deleted every day, so a person
> cannot be followed from one day to the next.

**Read this if:** you need to answer a privacy question, write a privacy notice, or change what
is stored (then update this page in the same pull request).

The goal is to answer "how many people read what" without being able to follow an individual.
This page describes exactly what the server stores. Each statement below is enforced in code;
the file in parentheses is where to check it.

## No cookies, no client-side storage

The tracking script sets no cookies and does not use `localStorage` to identify visitors. The only
thing it reads from `localStorage` is the opt-out key `mlz_ignore` (see [tracking.md](guides/tracking.md#excluding-your-own-visits)). The dashboard
uses one session cookie, `__session`, for signed-in users only.

## What is stored for each event

(`apps/server/internal/store/migrations/0001_init.sql`, `apps/server/internal/ingest/ingest.go`)

| Field | Content |
|---|---|
| time | When the event arrived |
| hostname, path | Of the page. The **query string is not stored**, and the tracker does not even send it, except the `utm_*` tags. The fragment is dropped too, unless it names a route in a hash-based router (`#/docs`, `#!/docs`), which is kept as part of the path without any query inside it (`#/reset?token=…` is stored as `#/reset`) |
| referrer | The referrer's **hostname only**, and only when it is another site. The tracker sends only the referrer's origin |
| `utm_source`, `utm_medium`, `utm_campaign` | Read from the page URL |
| country | Two-letter code from a local DB-IP Lite database. No city or region |
| browser, OS, device type | Derived from the user agent, e.g. "Firefox", "macOS", "mobile" |
| visitor id | A one-way hash, see below |
| session id | A random number, reused while the visitor stays active (30 minutes) |
| custom event name and properties | Whatever **you** send with `mlz.track()` or `data-mlz-event` |
| outbound links | The automatic `outbound-link` event stores the link's **origin and path only**: query string, fragment and any credentials in the link are removed by the tracker and again by the server |

## What is never stored

- IP addresses, in the database or in the application's own logs.
- Raw user agent strings, in the database or in the application's own logs. Only the derived
  browser, OS and device are kept. A log line about a rejected event has only the reason, the
  status, the Origin's hostname and the site id.
- Full URLs with query strings, or referrer paths.
- Anything that identifies a person across days or across sites.

**Infrastructure logs are outside the application's control.** A reverse proxy or hosting
platform may log client IPs in its own access logs (for example nginx access logs, or Cloud Run
request logs). Check the retention of those logs, or disable them, if you want the "no IPs
anywhere" guarantee end to end.

## How visitors are counted

The visitor id is `SHA-256(daily salt, site id, IP address, user agent)`, truncated to 63 bits
(`apps/server/internal/visitor`).

- The salt is random, stored in the database and **replaced every UTC day**. The previous
  salt is deleted just after midnight UTC by the server's maintenance run, whether or not
  any traffic arrives (`maintain` in `cmd/analytics`, `Store.SaltForDay`).
- Without the old salt, a stored id cannot be recomputed, so the same person cannot be linked
  from one day to the next, and the IP address cannot be recovered from stored data.
- The site id is part of the hash, so the same person has different ids on different sites.
- Consequence: "unique visitors" over several days is the sum of daily uniques. A returning
  visitor counts once per day.

On hosts that pause the CPU between requests (Cloud Run with request-based billing) the
maintenance run happens at the first request after midnight; the Terraform setup's uptime check
makes one every 5 minutes. A server that is not running at midnight rotates the salt when it
starts. Backups and Litestream replicas contain the salt table as it was at the time they were
taken, so keep backups as access-controlled as the database.

## Bots

Requests from known crawlers and automation are dropped before anything is stored. See
[bots.md](operations/bots.md) for what is filtered, how floods are limited and what cannot be stopped.

## Custom events: your responsibility

Event properties are stored as sent. Do not put personal data (email addresses, names, user ids)
in event names or properties.

## Tracking pixel

`GET /api/pixel.gif` stores the same fields as the script, or fewer
(`apps/server/internal/ingest/pixel.go`). The path, event name, referrer host and UTM tags come
from the image URL, which you write. There are no event properties. Without a `ref` parameter,
the referrer is the hostname from the browser's `Referer` header, the page that embeds the image.

**Keep personal data out of pixel URLs.** The pixel makes it tempting to track emails per
recipient, for example `?p=/newsletter/ola@example.com` or `utm_campaign=user-1234`. That stores
personal data and identifies people, which this tool is built not to do, and the server cannot
tell such values apart from ordinary ones. Use one URL per campaign, not per recipient. Whether
tracking that an email was opened needs the recipient's consent depends on the ePrivacy rules
where you send it; in the EU and EEA it usually does.

When the request comes through an image proxy (GitHub's Camo, the image proxies of Gmail and Yahoo Mail), the address
and user agent belong to the proxy. No country, browser, OS or device is stored for those
events, and the visitor id is a hash of the proxy's address, not the reader's. The only new
stored field is the per-site setting `pixel_enabled`.

## Exports

CSV exports contain the same aggregates the dashboard shows (counts, rates and durations per
value or per time bucket), never single events or visitor ids. They are only available to
signed-in dashboard users.

## Goals

A goal stores only the site, an event name or a path pattern, and when it was created. Goals
are computed from the stored events when the dashboard asks, so they add no data about
visitors.

## Retention

Events are kept forever by default. Set `RETENTION_DAYS` to delete events older than N days; the
server checks hourly.

## Dashboard users

Signing in uses GitHub OAuth. The database stores the GitHub username and numeric account id for
each user who has signed in, and a SHA-256 hash of each session token with when it was created and
when it expires. No passwords, emails or access tokens are stored. A session lasts 7 days without
use and is extended while it is used, for at most 30 days after the sign-in;
removing a user from `ALLOWED_GITHUB_USERS` ends their sessions at their next request, and
`analytics sessions revoke` ends them at once.

## Third-party data

Country lookup uses [DB-IP Lite](https://db-ip.com) (CC BY 4.0), downloaded when the Docker image
is built. Lookups happen locally; no IP address leaves the server.

## Legal note

Not storing personal data and not using cookies means that, in most jurisdictions, no consent
banner is needed for this kind of measurement. That is not legal advice; check the rules that
apply to you.
