# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Until 1.0, minor versions may contain breaking changes.

## [Unreleased]

### Changed
- Tracking script is smaller (1.7 KB minified, 0.9 KB gzipped, down from 2.4/1.2 KB) and is served gzip-compressed. It now targets ES2022 (Safari 15.4+, Chrome 94+, Firefox 93+).
- Repository restructured: `server/`, `web/`, `tracker/` moved to `apps/`, `deploy/` to `infra/docker/`, Terraform to `infra/terraform/`. Self-hosters now use `infra/docker/docker-compose.yml`. The Go module path is now `github.com/martinzachariassen/analytics-mlz-no/apps/server`.

### Added
- `analytics version` and version information in the startup log.
- Release pipeline: multi-arch image on GHCR and static binaries on GitHub Releases.
- CI: dashboard type checking and unit tests, `govulncheck`, `npm audit`, Dependabot.
- `infra/docker/test-restore.sh` (backup/restore check) and `apps/server/cmd/loadtest` (ingest load test).
- Documentation: privacy, upgrading, tracker and release guides; contributing and security policies.

### Earlier work
- Event ingestion, cookie-free visitor counting, tracking script, GitHub sign-in, sites and
  statistics API, dashboard, Terraform for GCP.
