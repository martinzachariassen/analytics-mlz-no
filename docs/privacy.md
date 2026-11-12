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
| hostname, path | Of the page. The **query string is not stored**. The fragment is dropped too, unless it names a route in a hash-based router (`#/docs`, `#!/docs`), which is kept as part of the path |
| referrer | The referrer's **hostname only**, and only when it is another site |
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
  salt is deleted when the first event of the new day arrives (`Store.SaltForDay`).
- Without the old salt, a stored id cannot be recomputed, so the same person cannot be linked
  from one day to the next, and the IP address cannot be recovered from stored data.
- The site id is part of the hash, so the same person has different ids on different sites.
- Consequence: "unique visitors" over several days is the sum of daily uniques. A returning
  visitor counts once per day.

A quiet site keeps the previous day's salt until its next event. Backups and Litestream replicas
contain the salt table as it was at that time, so keep backups as access-controlled as the database.

## Bots

Requests from known crawlers and automation are dropped before anything is stored. See
[bots.md](operations/bots.md) for what is filtered, how floods are limited and what cannot be stopped.

## Custom events: your responsibility

Event properties are stored as sent. Do not put personal data (email addresses, names, user ids)
in event names or properties.

## Retention

Events are kept forever by default. Set `RETENTION_DAYS` to delete events older than N days; the
server checks hourly.

## Dashboard users

Signing in uses GitHub OAuth. The database stores the GitHub username and numeric account id for
each user who has signed in, and a SHA-256 hash of each session token. No passwords, emails or
access tokens are stored. A session lasts 7 days without use and is extended while it is used;
removing a user from `ALLOWED_GITHUB_USERS` ends their sessions at their next request, and
`analytics sessions revoke` ends them at once.

## Third-party data

Country lookup uses [DB-IP Lite](https://db-ip.com) (CC BY 4.0), downloaded when the Docker image
is built. Lookups happen locally; no IP address leaves the server.

## Legal note

Not storing personal data and not using cookies means that, in most jurisdictions, no consent
banner is needed for this kind of measurement. That is not legal advice; check the rules that
apply to you.
