# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Until 1.0, minor versions may contain breaking changes.

## [Unreleased]

### Fixed
- Terraform: scheduled backups never ran. The scheduler's service account had `roles/run.invoker`, but the schedules pass `args` as an override, which needs `roles/run.jobsExecutorWithOverrides`. A new alert (`alert_email`) fires when no backup has succeeded for two hours.

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
- Documentation: bots, scanners and robots ([docs/BOTS.md](docs/BOTS.md)), privacy, upgrading, tracker and release guides; contributing and security policies.

### Earlier work
- Event ingestion, cookie-free visitor counting, tracking script, GitHub sign-in, sites and
  statistics API, dashboard, Terraform for GCP.

[Unreleased]: https://github.com/martinzachariassen/analytics-mlz-no/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/martinzachariassen/analytics-mlz-no/releases/tag/v0.1.0
