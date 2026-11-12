# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Until 1.0, minor versions may contain breaking changes.

## [Unreleased]

### Added
- Documentation reorganised around reader needs: a start page with reading paths (`docs/README.md`), guides, reference (API, configuration, CLI), an operations runbook, and development guides. Every page starts with a TL;DR.
- Terraform: an alert (`alert_email`) when the server logs an error, at most one email per hour. `docs/operations/runbook.md` lists useful Logs Explorer filters.
- `LOG_LEVEL` (`debug`, `info`, `warn`, `error`; Terraform `log_level`). Rejected events log why (`event rejected` with a `reason`, never the IP or user agent): bad payloads at `INFO`, rate limits, bots and load shedding at `DEBUG`.
- Terraform: an "Analytics" operations dashboard in Cloud Monitoring (requests by status, latency, memory, CPU, instances, backups, uptime, server warnings). `terraform output dashboard_url` and `logs_url` link to it and to the logs.
- `analytics sessions revoke [-user LOGIN]` signs dashboard users out everywhere.

### Security
- Built with Go 1.27.4, which fixes a vulnerability in `net/http` ([GO-2026-6859](https://pkg.go.dev/vuln/GO-2026-6859)).
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
- `data-hash="true"` had no effect: the server dropped the fragment. Fragments that name a route (`#/docs`, `#!/docs`) are now part of the stored path; in-page anchors are still dropped.
- Tracker: `history.replaceState` navigations (router redirects) and pages restored from the back-forward cache are counted. `*.localhost`, `0.0.0.0` and the whole `127.0.0.0/8` range count as localhost.
- `PATCH /api/sites/{id}` with only `name` failed with "domain is required". Fields are now optional.
- A database error while looking up a visitor's session started a new session instead of failing the insert. Unique-constraint errors are detected by SQLite error code instead of message text. Duplicate migration version numbers fail at startup instead of being skipped.
- Shutdown: a second signal ends the process, a shutdown timeout closes open connections instead of exiting non-zero, and `net/http`'s own errors are logged as JSON.
- Terraform: scheduled backups never ran. The scheduler's service account had `roles/run.invoker`, but the schedules pass `args` as an override, which needs `roles/run.jobsExecutorWithOverrides`. A new alert (`alert_email`) fires when no backup has succeeded for two hours.

### Changed
- `404`, `405` and `429` responses are JSON like the API's other errors.
- Statistics queries are cancelled after 10 seconds.
- Site creation, changes, deletion and purges are logged with the signed-in user.
- `ReadJSON` rejects trailing data after the JSON body.
- Tracker: CI fails if the gzipped script grows past 1024 bytes (`npm run check-size`). It is now 1.9 KB minified and 1.0 KB gzipped.
- More `golangci-lint` linters (`gocritic`, `noctx`, `sqlclosecheck`, `rowserrcheck`, `nilerr`, `usestdlibvars`, `unparam`, `perfsprint`, `exhaustive`, `contextcheck`).
- Server logs use `severity` and `message` instead of `level` and `msg`, so Cloud Logging shows the level and `severity>=ERROR` finds app errors. Update log queries that matched on `msg` or `level`.
- Dependencies updated: Litestream 0.5.18 in the Docker image, `modernc.org/sqlite` 1.62.0, and the dashboard's npm packages (Vite 8.3, Tailwind 4.3, TanStack Query 5.107).

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
