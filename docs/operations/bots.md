# Bots, scanners and robots

Every public service is probed within hours of going live. This page explains what reaches this
one, what the server does about it, what it cannot do, and what to check now and then.

> **TL;DR** — Bots are dropped before anything is stored, floods are bounded by hard limits (and
> alert you), the dashboard is kept out of search engines, and a deliberate attacker who forges
> browser headers can still add noise, which you can delete afterwards.

## What reaches the service

| Traffic | Where it shows up | What happens |
|---|---|---|
| Search-engine and SEO crawlers (Googlebot, Bytespider, ...) | Hitting the dashboard or running the tracking script | Not counted. See [filtering](#how-events-are-filtered). Told not to index (see [indexing](#keeping-the-dashboard-out-of-search-engines)). |
| Vulnerability scanners probing `/.env`, `/wp-login.php`, `/api/v1/.env`, ... | Request logs, mostly against the `run.app` URL | The server answers `404`. Nothing is stored and nothing is exposed. On the custom domain, Firebase Hosting answers unknown non-`/api` paths with the dashboard page (`200`), because the dashboard is a single-page app. That is a hosting limitation, not a leak. |
| Uptime monitors, benchmarks, link-preview fetchers | `POST /api/event` from non-browser clients | Not counted (see the marker list in `apps/server/internal/ingest/ingest.go`). |
| Headless browsers and test tools (Puppeteer, Playwright, Lighthouse) | The tracking script runs | The script does nothing when `navigator.webdriver` is set, and counts a prerendered page only once the visitor navigates to it. Headless Chrome that does not announce itself is dropped by its user agent where it says "Headless". |
| Scripts posting fake events (referrer spam, junk paths, floods) | `POST /api/event` | Rejected or dropped as described below. What gets through can be removed with the purge endpoint. |

## How events are filtered

`POST /api/event` runs these checks in order (`apps/server/internal/ingest/ingest.go`). Only an
event that passes all of them is stored. The cheap checks come first, so a flood is refused
before it costs anything.

1. **Rate limits by address.** First per upstream address as seen by Cloud Run, which cannot be
   forged with `X-Forwarded-For` (50 requests/s, burst 200), then per client address (10/s, burst
   30). Both answer `429`. Addresses are parsed before they are used as limiter keys: a forged
   header that is not an IP address falls back to the real peer, so junk headers cannot grow the
   limiter's memory.
2. **Global limit and capacity.** `INGEST_RATE_LIMIT` (default 50 events/s in Terraform) and the
   database size cap `MAX_DATABASE_MB` (default 200 in Terraform) answer `503`. On Cloud Run the
   database lives in the instance's 512 MiB of memory, so the cap is what keeps a flood from
   crashing the service.
3. **Bots.** An empty user agent, anything the user-agent parser flags as a bot, and a list of
   markers (`bot`, `crawl`, `spider`, `headless`, `lighthouse`, `curl/`, `python-requests`,
   `go-http-client`, `gtmetrix`, `nagios`, `statuscake`, ...) are dropped. The answer is `202`,
   the same as for a real visitor, so a scraper gets no signal about why.
4. **Payload.** At most 8 KB (`413`) of valid JSON (`400`).
5. **Site, host and origin.** The site id must have the shape of a real id and exist, the page
   URL must be `http(s)` and its host the site's domain or a subdomain, and `Origin` must be
   present and match the same domain (`null` is allowed for sandboxed contexts). Mismatches get
   `400`. Browsers always send `Origin` on a `POST`, including `sendBeacon`, so this stops naive
   replays from `curl`.
6. **Text cleanup.** Control characters and bidirectional overrides are stripped from stored text,
   referrers with an invalid host are discarded, and the `outbound-link` event's URL is reduced to
   origin and path.
7. **Per-visitor limit.** About 1 event/s, burst 60, per site and daily visitor hash. Excess is
   answered `202` and dropped, so a script replaying one visitor cannot inflate counts.
8. **Write queue.** A bounded number of concurrent inserts; a request that waits more than two
   seconds for a slot gets `503`.

Sign-in endpoints have their own limits (5 requests/s per client, burst 30, and 20/s per upstream
address). Dashboard and sign-in endpoints reject changes that a browser marks as cross-origin
(`Sec-Fetch-Site` or `Origin`) with `403`; that is the CSRF protection.

Nothing in these checks stores an IP address or a raw user agent. See [privacy.md](../privacy.md).

## Keeping the dashboard out of search engines

- `robots.txt` disallows everything (`apps/web/public/robots.txt`). It is a request, not a lock;
  well-behaved crawlers obey it.
- `<meta name="robots" content="noindex">` in `apps/web/index.html`.
- `X-Robots-Tag: noindex, nofollow` on every response, from Firebase Hosting
  (`apps/web/firebase.json`) and from the server itself (so it also covers the API and the
  tracking script when reached directly).
- `/.well-known/security.txt` names the private GitHub advisory form from
  [SECURITY.md](../../SECURITY.md) as the contact. Its `Expires` date has to be renewed at least once
  a year; the current value is in `apps/web/public/.well-known/security.txt`.

None of this affects tracking: browsers load `/api/script.js` whatever `robots.txt` says.

## What cannot be stopped

- **A determined script that sends a realistic user agent and a matching `Origin`** looks like a
  browser to the server. The checks make this tedious and the limits cap the damage, but they do
  not make it impossible. Expect small amounts of noise if someone targets you.
- **Real browsers driven by automation** that hide `navigator.webdriver` and the headless
  user-agent token.
- **CAPTCHA, IP reputation and a web application firewall** (for example Cloud Armor) would help
  against some of this, but they cost money, need IP addresses, or put a challenge in front of your
  visitors. This project deliberately does not use them.

## When something looks wrong

Follow the [spam playbook](runbook.md#spam-a-traffic-spike-or-a-flood) in the runbook. The
[routine checks](runbook.md#routine-checks) are listed there too.

## For the sites you track

- Exclude your own visits: `localStorage.setItem("mlz_ignore", "true")` in your browser.
- Respect Do Not Track if your audience expects it: `data-respect-dnt="true"`.
- If a site sets a Content Security Policy, allow the analytics host for `script-src` and
  `connect-src` ([tracking.md](../guides/tracking.md#content-security-policy)).
- The site's domain is what the server compares against. Add every domain you serve a site from as
  a separate site, or use a parent domain (subdomains are accepted).
