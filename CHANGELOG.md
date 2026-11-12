# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Until 1.0, minor versions may contain breaking changes.

## [Unreleased]

### Added
- CSV export: report tables (pages, sources, locations, devices, events, event properties) and the overview chart have a "CSV" download with the current period, filters and comparison. API: `GET /api/sites/{id}/export?what=breakdown|timeseries`, UTF-8 with a byte order mark for Excel, up to 1000 rows (`X-Truncated: true` when cut), with formula-looking cells prefixed by `'` against CSV injection.
- Goals and conversions: a goal is a custom event or a page (`*` matches anything, so `/blog/*` is every post). The overview has a Goals card with conversions, visitors, conversion rate (share of all visitors) and its change; clicking a goal filters the dashboard to visits that reached it. Goals are managed in settings, and the detail sheet and the event properties panel offer "Make this a goal". Goals count past traffic too. `analytics seed` creates demo goals.
- API: `GET`/`POST /api/sites/{id}/goals`, `DELETE /api/sites/{id}/goals/{goalId}` and `GET /api/sites/{id}/goals/stats` (same period, filter and `compare` parameters as the other stats endpoints). At most 50 goals per site.
- Onboarding: a site with no stored events (new, or emptied by a purge or retention) shows "Waiting for the first event…" with its snippet and troubleshooting tips instead of empty charts, and switches to the dashboard by itself (with a "First event received" toast) when the first event arrives. It checks every 5 s in the first hour after the site was added, then every minute. Settings shows the same status and when the last event arrived; the site list shows "Waiting for first event" instead of an empty trend.
- API: sites have `first_event_at` and `last_event_at` (oldest and newest stored events, `null` before the first one).
- `docs/decisions.md` has a "Next" section with the product roadmap.
- Documentation reorganised around reader needs: a start page with reading paths (`docs/README.md`), guides, reference (API, configuration, CLI), an operations runbook, and development guides. Every page starts with a TL;DR.
- `ARCHITECTURE.md`: a page view end to end, where the data lives (replica and backups), and the server's handler chain. `docs/decisions.md` lists what must be settled before 1.0; `SECURITY.md` covers the supply chain.
- Terraform: an alert (`alert_email`) when the server logs an error, at most one email per hour. `docs/operations/runbook.md` lists useful Logs Explorer filters.
- `LOG_LEVEL` (`debug`, `info`, `warn`, `error`; Terraform `log_level`). Rejected events log why (`event rejected` with a `reason`, never the IP or user agent): bad payloads at `INFO`, rate limits, bots and load shedding at `DEBUG`.
- Terraform: an "Analytics" operations dashboard in Cloud Monitoring (requests by status, latency, memory, CPU, instances, backups, uptime, server warnings). `terraform output dashboard_url` and `logs_url` link to it and to the logs.
- `analytics sessions revoke [-user LOGIN]` signs dashboard users out everywhere.
- Terraform: `require_replica` (see Fixed), labels on every resource, lock files for Linux and macOS, `terraform_version < 2.0`, and an outputs table plus a restore playbook (`docs/guides/deploy-gcp.md`, `docs/operations/runbook.md`). The Docker image records which DB-IP month it carries in `/usr/share/geoip/VERSION`.
- Dashboard tests: component tests (Testing Library, happy-dom) for the filter bar, date range picker, detail sheet and error note, and Playwright end-to-end tests against a seeded server on desktop, mobile and the light theme, with an axe accessibility scan on every page. They run as the new `e2e` group of `scripts/verify.sh` and a CI job that uploads traces on failure.
- Dashboard: a failed view shows a "Try again" button that refetches every request the view needs that failed, and nothing else. The overview and the "Could not reach the server" page now use the same error message as the other views, and a retry that fails again is announced to screen readers again. Background polling no longer flips the message to "Retrying…", and focus stays on the button during a retry.
- Dashboard: the heatmap, the visitor map and the "Top … over time" chart show an error with a retry instead of a skeleton that never ends when their request fails; report panels that depend on a failed request say "Not available" under the page's error message.
- Dashboard: gzipped size budgets for the production build (JavaScript loaded before the first render, all CSS, the largest lazy chunk, all JavaScript), checked by `bun run check-size` in the `web` verify group. TypeScript also checks `noUncheckedIndexedAccess`.

### Security
- CSRF protection moved into the router: every dashboard and sign-in route is wrapped in Go's `http.CrossOriginProtection`, which rejects changes a browser marks as cross-origin (`Sec-Fetch-Site`, or an `Origin` that is neither the host nor `PUBLIC_URL`) with `403`. It replaces the per-handler origin checks on `DELETE` and logout, so a new endpoint is protected without remembering to add one. The `application/json` requirement stays as a second layer.
- Dashboard sessions end 30 days after sign-in however often they are used (`auth.SessionMaxAge`); before, a session used at least once a week never expired. Migration `0004` adds `sessions.created_at`, set for existing sessions to their last renewal.
- Built with Go 1.27.4, which fixes a vulnerability in `net/http` ([GO-2026-6859](https://pkg.go.dev/vuln/GO-2026-6859)).
- Supply chain: base images and the Litestream binary are pinned by digest (Litestream 0.5.18 now comes from its official image instead of a `curl | tar`), GitHub Actions are pinned to commits, `actions/checkout` no longer persists credentials, the CI image is scanned with Trivy, CodeQL runs on Go, TypeScript and the workflows, and releases carry an SBOM and signed build provenance for the image and the binaries (`gh attestation verify`). Release images pin the GeoIP month (`DBIP_MONTH`, the month before the tagged commit), so a rebuilt tag is the same image and a release on the 1st cannot fail on a file DB-IP has not published yet.
- Docker: the container runs as `10001:10001` with a group, has a `HEALTHCHECK`, and `docker-compose.yml` binds to `127.0.0.1`, runs read-only with all capabilities dropped and `no-new-privileges`, limits memory and log size, and reads secrets from `infra/docker/.env` (`.env.example`) instead of inline values. `.dockerignore` keeps databases, env files and node_modules out of the build context.
- Terraform: the default compute service account loses its project-wide `roles/editor` (`google_project_default_service_accounts`, `DEPRIVILEGE`); the state, replica and backup buckets have `prevent_destroy`; variables are validated (`extra_domains` needs `domain`, limits have ranges, `alert_email` is an address).
- Rate limiters key on parsed IP addresses. A forged `X-Forwarded-For` entry that is not an address falls back to the real peer, so a flood of junk headers can no longer grow the limiter maps until the server runs out of memory. The unforgeable upstream limit now runs before the per-client limit, for ingest and sign-in alike.
- The allowlist is checked on every authenticated request: a user removed from `ALLOWED_GITHUB_USERS` gets `401` and their sessions are deleted. `analytics sessions revoke [-user LOGIN]` deletes sessions from the command line.
- Sessions last 7 days without use (was a fixed 30 days) and are extended while in use. Starting a new sign-in ends the previous session; a failed callback no longer clears a valid session cookie.
- GitHub sign-in uses OAuth with PKCE, no longer requests the `read:user` scope, enforces the 10-minute sign-in window server-side and caps what it reads from GitHub.
- `POST /api/auth/logout` and `DELETE /api/sites/{id}` require the dashboard's own `Origin`, so every mutating endpoint has CSRF protection.
- The server sets `X-Content-Type-Options`, `Referrer-Policy`, a deny-all `Content-Security-Policy`, `X-Frame-Options` and (with an https `PUBLIC_URL`) `Strict-Transport-Security` on every response, including on the direct Cloud Run URL and for self-hosters without a CDN.
- `DEV_LOGIN=1` only answers connections from the loopback interface, so a machine on the same network cannot sign in as `dev`. `seed -reset` requires `DEV_LOGIN=1`.
- `PUBLIC_URL` must be an origin (no path or query) and must be `https://` when sign-in is enabled, except on localhost. A logged `Config` never includes the client secret.
- Site ids are validated before the database or its cache is consulted, so junk ids cannot fill the site cache.
- Site domains are validated: internationalised names are stored as punycode (`ærø.no` → `xn--r-3fa9c.no`, so they match the host ingest sees), a dot is required (a bare `no` would have matched every site under it) and names are capped at 100 characters without control characters.
- The automatic `outbound-link` event stores the link's origin and path only: query strings, fragments and credentials are removed by the tracker and again by the server. Page URLs must be `http(s)`.
- Tracker: nothing the script does can throw into the host page; a failure to send is swallowed.

### Fixed
- Ingestion no longer drops events with `503` while the dashboard loads a long period: statistics run on a separate read-only SQLite connection pool, and writes have a connection of their own. Health checks use the read pool, so a busy writer does not fail them.
- Terraform: `public_url` was `https://https://<site>.web.app` when `domain` was empty, which broke the OAuth callback for installs without a custom domain.
- A lost Litestream replica was invisible: the next cold start began with an empty database and replicated that over the bucket, while the backup job kept succeeding on nothing. `require_replica = true` (`REQUIRE_REPLICA=1`, `BACKUP_EXPECT_DATA=1`) makes an empty replica a startup failure and a failed backup, and a new alert fires on Litestream errors and empty restores (`infra/docker/test-restore.sh` checks that the log lines it matches still exist). `docs/operations/runbook.md` has a restore playbook, and the Terraform variable `replica_path` points the service and the backup job at a freshly seeded replica without a code change.
- The uptime check fetched `/api/script.js`, which the CDN caches for an hour, so it could pass while Cloud Run was down. It now expects a `401` from the uncached `/api/auth/me`. Cloud Run gets a liveness probe, so a hung instance is replaced.
- `backup.sh` retries uploads, names files with seconds and the execution id (a retry could not overwrite a partial object), and the test scripts fail when the server never becomes healthy. `test-restore.sh` also covers `REQUIRE_REPLICA` and a database newer than the replica; `test-backup.sh` covers `BACKUP_EXPECT_DATA`. CI runs both on every push, for amd64 and arm64.
- `make deploy` runs the quality gate and refuses uncommitted, untracked, unpushed or non-`main` changes unless `FORCE=1`; it deploys the server before the dashboard and installs dashboard packages from the lockfile first.
- Dashboard: deep links and `/` were served with Firebase Hosting's default one-hour cache, so after a deploy a visitor could get an `index.html` pointing at chunks that no longer existed. Every non-asset path is now `no-cache`; `/assets/**` and `/fonts/**` stay immutable. A stale chunk reloads the page once instead of showing a blank error.
- Dashboard: URL parameters such as `?period=toString` or `?auth_error=__proto__` matched inherited object properties and crashed the page. Lookups use `Object.hasOwn`, and more than 10 filters in the URL are ignored instead of producing a `400`.
- Dashboard: every view shows a failed request as a message instead of a skeleton that never ends (reports, realtime, detail sheet, overview cards, settings, site list). A `401` during a mutation re-checks the session like queries already did; a failed sign-out shows a toast instead of hanging. Error messages fall back to `HTTP <status>` when the server sends no text (HTTP/2 has no status text).
- Dashboard: the GitHub avatar was blocked by the Content-Security-Policy in production; the menu shows initials instead. `Permissions-Policy` uses `browsing-topics` instead of the retired `interest-cohort`. `theme-color` matches `index.html`. The theme works when `localStorage` is unavailable.
- Dashboard: table rows, the map's countries and the quick-filter button in lists can be reached with the keyboard.
- `data-hash="true"` had no effect: the server dropped the fragment. Fragments that name a route (`#/docs`, `#!/docs`) are now part of the stored path; in-page anchors are still dropped.
- Tracker: `history.replaceState` navigations (router redirects) and pages restored from the back-forward cache are counted. `*.localhost`, `0.0.0.0` and the whole `127.0.0.0/8` range count as localhost.
- `PATCH /api/sites/{id}` with only `name` failed with "domain is required". Fields are now optional.
- A database error while looking up a visitor's session started a new session instead of failing the insert. Unique-constraint errors are detected by SQLite error code instead of message text. Duplicate migration version numbers fail at startup instead of being skipped.
- Shutdown: a second signal ends the process, a shutdown timeout closes open connections instead of exiting non-zero, and `net/http`'s own errors are logged as JSON.
- Terraform: scheduled backups never ran. The scheduler's service account had `roles/run.invoker`, but the schedules pass `args` as an override, which needs `roles/run.jobsExecutorWithOverrides`. A new alert (`alert_email`) fires when no backup has succeeded for two hours.
- Dashboard: "Filter dashboard by this" in the detail sheet closed the sheet but dropped the filter, because two URL updates in one click overwrote each other. Requests that hit a rate limit (`429`) are now retried instead of shown as errors.
- Dashboard accessibility (WCAG 2.1 AA): muted text, deltas and sidebar group labels have enough contrast in both themes; clickable table rows are real buttons instead of rows with `role="button"`; the clickable world map is a group instead of an image; the landing page's Home link is named by its visible text and its code block wraps instead of scrolling; animations skip their delay when reduced motion is on.

### Changed
- Tooling: every tool is pinned in `mise.toml` (`mise install`), JavaScript packages are one Bun workspace (`bun install`), Biome replaces eslint and prettier, a pre-commit hook runs `bun run lint`, and `scripts/verify.sh` (`make verify`) is the one quality gate that CI runs too, including Terraform `fmt`/`validate`, shellcheck, hadolint and actionlint.
- `404`, `405` and `429` responses are JSON like the API's other errors.
- `GET /healthz` returns JSON, `{"status":"ok"}` or `503` with `{"status":"unavailable",…}`, instead of the plain text `ok`, and is never cached. Probes that only check the status code (Docker, Compose, Cloud Run) are unaffected; a script that compared the body to `ok` must check the status code instead. A failed check is logged with the database error.
- Statistics queries are cancelled after 10 seconds.
- Site creation, changes, deletion and purges are logged with the signed-in user.
- `ReadJSON` rejects trailing data after the JSON body.
- Dashboard: `make web TRACKER_ORIGIN=https://t.example.com` builds the "Tracking code" page with that host in the snippet (`docs/guides/deploy-gcp.md`). Vite refuses to start on another port than 5173, since the OAuth callback names it. `shadcn`, `tailwindcss` and `@tailwindcss/vite` are dev dependencies, so `bun audit --prod` covers only what ships.
- Tracker: CI fails if the gzipped script grows past 1024 bytes (`bun run check-size`). It is now 1.9 KB minified and 1.0 KB gzipped.
- More `golangci-lint` linters (`gocritic`, `noctx`, `sqlclosecheck`, `rowserrcheck`, `nilerr`, `usestdlibvars`, `unparam`, `perfsprint`, `exhaustive`, `contextcheck`).
- Server logs use `severity` and `message` instead of `level` and `msg`, so Cloud Logging shows the level and `severity>=ERROR` finds app errors. Update log queries that matched on `msg` or `level`.
- Dependencies updated: Litestream 0.5.18 in the Docker image, `modernc.org/sqlite` 1.62.0, and the dashboard's JavaScript packages (Vite 8.3, Tailwind 4.3, TanStack Query 5.107).

## [0.1.0] - 2026-11-04

### Security
- Dashboard and API tell search engines not to index anything: `robots.txt`, `X-Robots-Tag: noindex, nofollow` and `/.well-known/security.txt`. More monitoring, benchmark and link-preview clients are treated as bots.
- Ingestion is hardened against abuse: a global limit (`INGEST_RATE_LIMIT`), a per-visitor limit, a limit per upstream address (closes forged `X-Forwarded-For` on a directly reachable Cloud Run URL), a bounded write queue and an optional database size cap (`MAX_DATABASE_MB`). Overload returns `503` instead of timing out.
- `POST /api/event` now requires an `Origin` header, strips control characters and bidi overrides from stored text, drops invalid referrer hosts and filters more script user agents.
- Sign-in endpoints are rate limited; the dashboard sends a Content-Security-Policy, HSTS and Permissions-Policy.
- `POST /api/sites/{id}/purge` and `analytics events purge` delete spam events for a site and time window.
- Terraform: `ingest_rate_limit`, `max_database_mb` and optional email alerts (`alert_email`) for memory pressure and load shedding.

### Fixed
- Terraform: the backup schedules failed to create in regions without Cloud Scheduler (such as `europe-north1`). They now use `scheduler_region` (default `europe-west1`).

### Changed
- **Breaking:** HTML event attributes are namespaced. `data-track="x"` is now `data-mlz-event="x"` and `data-track-plan="pro"` is now `data-mlz-event-plan="pro"`, so they cannot collide with other tools. The old names are no longer read. `window.mlz.track()` and event names are unchanged.
- Tracking script is smaller (1.7 KB minified, 0.9 KB gzipped, down from 2.4/1.2 KB) and is served gzip-compressed. It now targets ES2022 (Safari 15.4+, Chrome 94+, Firefox 93+).
- Repository restructured: `server/`, `web/`, `tracker/` moved to `apps/`, `deploy/` to `infra/docker/`, Terraform to `infra/terraform/`. Self-hosters now use `infra/docker/docker-compose.yml`. The Go module path is now `github.com/martinzachariassen/analytics-mlz-no/apps/server`.

### Added
- Terraform: `infra/terraform/bootstrap/backend.tf.example` and a DEPLOY.md section for moving the bootstrap state into the state bucket.
- Terraform: with `alert_email` and `domain` set, an uptime check on `/api/script.js` emails you when the service is unreachable.
- Terraform: `extra_domains` serves the dashboard site on additional hostnames (for example a short host for the tracking script), without redirects. See docs/DEPLOY.md.
- Standalone database backups: a Cloud Run Job restores the Litestream replica every hour and every day, gzips it and writes it to a separate bucket (`<project>-backups`), with retention and a failure alert. `infra/docker/backup.sh`, `infra/docker/test-backup.sh`.
- `analytics version` and version information in the startup log.
- Release pipeline: multi-arch image on GHCR and static binaries on GitHub Releases.
- CI: dashboard type checking and unit tests, `govulncheck`, `npm audit`, Dependabot.
- `infra/docker/test-restore.sh` (backup/restore check) and `apps/server/cmd/loadtest` (ingest load test).
- Documentation: bots, scanners and robots ([docs/operations/bots.md](docs/operations/bots.md)), privacy, upgrading, tracker and release guides; contributing and security policies.

### Earlier work
- Event ingestion, cookie-free visitor counting, tracking script, GitHub sign-in, sites and
  statistics API, dashboard, Terraform for GCP.

[Unreleased]: https://github.com/martinzachariassen/analytics-mlz-no/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/martinzachariassen/analytics-mlz-no/releases/tag/v0.1.0
