# Bots, scanners and robots

Every public service is probed within hours of going live. This page explains what reaches this
one, what the server does about it, what it cannot do, and what to check now and then.

The short version: bots are dropped before anything is stored, floods are bounded by hard limits
(and alert you), the dashboard is kept out of search engines, and a deliberate attacker who forges
browser headers can still add noise, which you can delete afterwards.

## What reaches the service

| Traffic | Where it shows up | What happens |
|---|---|---|
| Search-engine and SEO crawlers (Googlebot, Bytespider, ...) | Hitting the dashboard or running the tracking script | Not counted. See [filtering](#how-events-are-filtered). Told not to index (see [indexing](#keeping-the-dashboard-out-of-search-engines)). |
| Vulnerability scanners probing `/.env`, `/wp-login.php`, `/api/v1/.env`, ... | Request logs, mostly against the `run.app` URL | The server answers `404`. Nothing is stored and nothing is exposed. On the custom domain, Firebase Hosting answers unknown non-`/api` paths with the dashboard page (`200`), because the dashboard is a single-page app. That is a hosting limitation, not a leak. |
| Uptime monitors, benchmarks, link-preview fetchers | `POST /api/event` from non-browser clients | Not counted (see the marker list in `apps/server/internal/ingest/ingest.go`). |
| Headless browsers and test tools (Puppeteer, Playwright, Lighthouse) | The tracking script runs | The script does nothing when `navigator.webdriver` is set, and does not count prerendered pages. Headless Chrome that does not announce itself is dropped by its user agent where it says "Headless". |
| Scripts posting fake events (referrer spam, junk paths, floods) | `POST /api/event` | Rejected or dropped as described below. What gets through can be removed with the purge endpoint. |

## How events are filtered

`POST /api/event` runs these checks in order. Only an event that passes all of them is stored.

1. **Site and host.** The site id must exist, the page URL's host must be the site's domain or a
   subdomain, and `Origin` must be present and match the same domain (`null` is allowed for
   sandboxed contexts). Mismatches get `400`. Browsers always send `Origin` on a `POST`, including
   `sendBeacon`, so this stops naive replays from `curl`.
2. **Bots.** An empty user agent, anything the user-agent parser flags as a bot, and a list of
   markers (`bot`, `crawl`, `spider`, `headless`, `lighthouse`, `curl/`, `python-requests`,
   `go-http-client`, `gtmetrix`, `nagios`, `statuscake`, ...) are dropped. The answer is `202`,
   the same as for a real visitor, so a scraper gets no signal about why.
3. **Text cleanup.** Control characters and bidirectional overrides are stripped from stored text,
   and referrers with an invalid host are discarded.
4. **Rate limits**, each answered so that a flood is cheap to refuse:
   - per client address: 10 requests/s, burst 30 (`429`),
   - per upstream address as seen by Cloud Run (cannot be forged with `X-Forwarded-For`): 50/s,
     burst 200 (`429`),
   - per visitor (site plus the daily hash): about 1 event/s, burst 60 (answered `202`, dropped),
   - global, `INGEST_RATE_LIMIT` (default 50 events/s in Terraform): `503` when exceeded.
5. **Capacity.** A bounded write queue (`503` when full) and an optional database size cap,
   `MAX_DATABASE_MB` (default 200 in Terraform), after which new events get `503`. On Cloud Run the
   database lives in the instance's 512 MiB of memory, so this cap is what keeps a flood from
   crashing the service.

Sign-in endpoints have their own limit (5 requests/s per client, burst 30). Mutating dashboard
endpoints require `Content-Type: application/json`, which is the CSRF protection.

Nothing in these checks stores an IP address or a raw user agent. See [PRIVACY.md](PRIVACY.md).

## Keeping the dashboard out of search engines

- `robots.txt` disallows everything (`apps/web/public/robots.txt`). It is a request, not a lock;
  well-behaved crawlers obey it.
- `<meta name="robots" content="noindex">` in `apps/web/index.html`.
- `X-Robots-Tag: noindex, nofollow` on every response, from Firebase Hosting
  (`apps/web/firebase.json`) and from the server itself (so it also covers the API and the
  tracking script when reached directly).
- `/.well-known/security.txt` names the private GitHub advisory form from
  [SECURITY.md](../SECURITY.md) as the contact. Its `Expires` date has to be renewed at least once
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

Signs: a sudden spike on one page or from one country, a referrer you do not recognise, the memory
or load-shedding alert email (`alert_email`), or `503`s in the logs.

1. Look at what is arriving:
   ```sh
   gcloud run services logs read analytics --region <region> --project <project_id> --limit 200 \
     | grep -E ' (429|503) '
   ```
2. Delete the junk. Signed in, send `POST /api/sites/{id}/purge` with a time window (and an exact
   path if it is one page); see [API.md](API.md#cleaning-up-spam). Locally or with Docker you can
   use `analytics events purge -site ID -from ... -to ...`. Purging cannot be undone, so use a
   narrow window and check the numbers first.
3. If the flood continues, lower `ingest_rate_limit` or `max_database_mb` in `terraform.tfvars` and
   apply. Real traffic for a personal site is a few events per second at most.
4. Inspect before you delete. Use the filter bar to isolate the offending referrer, path or country
   and see how many events it is.

## Routine checks

- After the first deploy and after changing `PROXY_HOPS`: compare your own country and visitor
  count against a visit you made yourself. A wrong value breaks rate limiting and counting.
- Now and then: skim the top referrers and paths in the dashboard for things you do not recognise.
- Once a year: renew `Expires` in `security.txt`.
- Keep Dependabot and `govulncheck` (CI) enabled.

## For the sites you track

- Exclude your own visits: `localStorage.setItem("mlz_ignore", "true")` in your browser.
- Respect Do Not Track if your audience expects it: `data-respect-dnt="true"`.
- If a site sets a Content Security Policy, allow the analytics host for `script-src` and
  `connect-src` ([TRACKER.md](TRACKER.md#content-security-policy)).
- The site's domain is what the server compares against. Add every domain you serve a site from as
  a separate site, or use a parent domain (subdomains are accepted).
