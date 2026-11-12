# Decisions

> **TL;DR** — Go, SQLite and one instance. Litestream for durability, Cloud Run plus Firebase
> Hosting in production, Docker Compose for everyone else. GitHub OAuth only, and no cookies on
> tracked sites. The table below is the record. Change it when a decision changes.

**Read this if:** you are about to make a larger change, or wonder why something is the way it is.

Lightweight, privacy-friendly, self-hostable web analytics (inspired by Umami/Plausible, but smaller).
This page records the architectural decisions and open items. Read it before larger changes.

## Decisions

| Area | Decision |
|---|---|
| Repo | Monorepo: `apps/server` (Go), `apps/web` (React + Vite + shadcn/ui), `apps/tracker` (JS snippet), `apps/demo` (demo site), `infra/docker` (Docker), `infra/terraform` (Terraform). MIT license. |
| Go module | `github.com/martinzachariassen/analytics-mlz-no/apps/server` (go.mod in `apps/server`; a root `go.work` lets `go run ./apps/server/...` work from the repo root) |
| Database | SQLite (`modernc.org/sqlite`, pure Go, no CGO). WAL mode. |
| Durability on Cloud Run | Litestream replicates SQLite to a GCS bucket; restores on start. `max-instances=1`. |
| Hosting | GCP Cloud Run in `europe-north1`; dashboard on Firebase Hosting with `/api/**` rewritten to Cloud Run (same origin). Self-hosters use `docker compose`. |
| Auth | **GitHub OAuth only** (no passwords). `ALLOWED_GITHUB_USERS` allowlist; username bound to the stable GitHub account id on first sign-in. Provider interface so Google/OIDC can be added later. Session cookie **must** be named `__session` (the only cookie Firebase Hosting forwards); it also carries the OAuth state during sign-in. |
| Privacy | No cookies, no stored IPs or raw user agents. Visitor id = hash(daily salt + site id + IP + UA). Salt rotates daily (UTC) and old salts are deleted. |
| Events (v1) | Page views, SPA navigation (pushState/popstate), outbound links (auto), custom events via `data-mlz-event` attributes and `window.mlz.track(name, props)`. |
| Dimensions (v1) | Views, uniques, bounce rate, top pages, referrer + UTM, browser/OS/device, country (DB-IP Lite, CC BY 4.0). |
| Retention | Keep forever by default; `RETENTION_DAYS` deletes older events. |
| Infra | Terraform, new GCP project. |
| CI | GitHub Actions running `scripts/verify.sh` (the same file as `make verify`), one group per job, plus a docs link check, `govulncheck`, `bun audit` and a Docker build. |
| Tooling | Tool versions pinned in `mise.toml`; one Bun workspace (`apps/web`, `apps/tracker`) with a root `bun.lock`; Biome for TypeScript formatting and linting, gofmt and golangci-lint for Go. |

## Milestones

1. ✅ **Foundation** — repo skeleton, Go server, SQLite migrations, `POST /api/event`, Docker + compose, Litestream.
2. ✅ **Tracker** — `script.js`: page views, SPA navigation, outbound links, `data-mlz-event`, `mlz.track()`.
3. ✅ **Stats API + auth** — GitHub sign-in, sites CRUD, stats + breakdown endpoints.
4. ✅ **Dashboard** — React + Vite + shadcn/ui.
5. ✅ **Terraform** — Artifact Registry, Cloud Run, GCS, Secret Manager, Firebase Hosting.
6. ✅ **Contributor-friendliness** — README, CONTRIBUTING, SECURITY, issue/PR templates (good-first-issues: label some once the repo is public).
7. **Release** — CI hardening, versioned builds, GHCR image + binaries on tag (`.github/workflows/release.yml`), privacy/upgrade docs. Code is ready; the first tag waits for the production checks in [releasing.md](development/releasing.md).

## Open items

- ✅ Production domain: `analytics.mlz.no` (dashboard and API), `t.mlz.no` (tracking script).
- ✅ `PROXY_HOPS=2` on Cloud Run behind Firebase Hosting: production events carry the right country and one visitor per person.
- **Dashboard for self-hosters.** The Docker image contains the API only. The dashboard (`apps/web/`) is
  deployed to Firebase Hosting and reaches the API through a same-origin rewrite, so someone running
  `docker compose` has a working collector but no dashboard unless they serve `apps/web/dist`
  themselves behind the same origin. Decide before 1.0 whether to embed `apps/web/dist` in the Go
  binary (simplest for self-hosting) or document a reverse-proxy recipe.
