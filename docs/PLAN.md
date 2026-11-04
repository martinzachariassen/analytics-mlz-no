# Plan

Lightweight, privacy-friendly, self-hostable web analytics (inspired by Umami/Plausible, but smaller).

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
| Infra | Terraform, new GCP project. `plan`/`apply` by hand, never from CI. |
| Tooling | Tools pinned in `mise.toml`; Bun workspace; Biome; `scripts/verify.sh` is the one quality gate for CI (`lint`, `go`, `tracker`, `web`, `infra`, `docker`, `security`, CodeQL) and for `make verify`. |
| Supply chain | Digest-pinned images, commit-pinned Actions, Trivy, CodeQL, SBOM and signed provenance on releases, Dependabot. |

## Milestones

1. ✅ **Foundation** — repo skeleton, Go server, SQLite migrations, `POST /api/event`, Docker + compose, Litestream.
2. ✅ **Tracker** — `script.js`: page views, SPA navigation, outbound links, `data-mlz-event`, `mlz.track()`.
3. ✅ **Stats API + auth** — GitHub sign-in, sites CRUD, stats + breakdown endpoints.
4. ✅ **Dashboard** — React + Vite + shadcn/ui.
5. ✅ **Terraform** — Artifact Registry, Cloud Run, GCS, Secret Manager, Firebase Hosting.
6. ✅ **Contributor-friendliness** — README, CONTRIBUTING, SECURITY, issue/PR templates (good-first-issues: label some once the repo is public).
7. ✅ **Release pipeline** — versioned builds, GHCR image + binaries on tag, SBOM and provenance (`.github/workflows/release.yml`). The first tag waits for the checklist in [RELEASING.md](RELEASING.md).
8. ✅ **Hardening audit (November 2026)** — server, tracker, dashboard, tooling, infrastructure and docs reviewed and fixed in one series of pull requests; see the "Unreleased" section of the changelog.

## Open items

- ✅ Production domain: `analytics.mlz.no` (dashboard and API), `t.mlz.no` (tracking script).
- ✅ `PROXY_HOPS=2` on Cloud Run behind Firebase Hosting: production events carry the right country and one visitor per person.
- Tag the first release (`v0.2.0`: the audited state; `v0.1.0` in the changelog was never tagged).

## Before 1.0

- **Dashboard for self-hosters.** The Docker image serves the API only. Embed `apps/web/dist` in the
  Go binary (simplest for self-hosting) or document a reverse-proxy recipe.
- **Site ownership.** The dashboard is single-tenant: every allowlisted user can read and change
  every site. Fine for one person or one team; a `site_users` table would be needed for more.
- **A second identity provider.** The `auth.Provider` interface is there; OIDC (Google, Keycloak)
  would make self-hosting without GitHub possible.
- **Schema freeze.** After 1.0 migrations stay additive and minor versions never break
  configuration.
