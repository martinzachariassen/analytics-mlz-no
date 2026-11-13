# Decisions

> **TL;DR** — Go, SQLite and one instance. Litestream for durability, Cloud Run plus Firebase
> Hosting in production, Docker Compose for everyone else. GitHub OAuth only, and no cookies on
> tracked sites. The table below is the record. Change it when a decision changes.

**Read this if:** you are about to make a larger change, or wonder why something is the way it is.

Lightweight, privacy-friendly, self-hostable web analytics (inspired by Umami/Plausible, but smaller).
This page records the architectural decisions, open items, what comes next and what must be settled before 1.0. Read it before larger changes.

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
| Tracking pixel | `GET /api/pixel.gif` for places without JavaScript (READMEs, email). **Opt-in per site** (`pixel_enabled`), because a `GET` has no `Origin` to check against the domain. Always answers the same GIF, rate limits and pauses included, so a page never shows a broken image. Known image proxies (GitHub Camo by its exact user agent, Gmail, Yahoo Mail; never a user agent with a bot marker) get no country or device and skip the per-visitor limit, so their views count but their visitors do not. Without `ref`, the `Referer` header's host is the referrer, so a site owner can see where a third party embedded the pixel; embedding by others cannot be prevented without breaking legitimate use, so opt-in is the defence. |
| Ingest origin | `POST /api/event` requires an `Origin` matching the site's domain and rejects `null`: any page can send `null` from a sandboxed iframe, so allowing it made the check meaningless against third parties posting from their visitors' browsers. |
| Tracker size and URL data | Budget **1100 B gzipped** (was 1024 B). The extra bytes keep query parameters other than `utm_*` and the referrer's path from ever leaving the browser, instead of relying on the server to drop them. A query inside a hash route is dropped by the server only, since it did not fit. |
| Dimensions (v1) | Views, uniques, bounce rate, top pages, referrer + UTM, browser/OS/device, country (DB-IP Lite, CC BY 4.0). |
| Retention | Keep forever by default; `RETENTION_DAYS` deletes older events. |
| Infra | Terraform, new GCP project. `plan`/`apply` by hand, never from CI. |
| Deploy | GitHub Actions deploys every push to `main` once CI has passed on it (`deploy.yml`, through the same `make deploy-server`/`deploy-web` targets). Workload Identity Federation, no service account keys; GCP only trusts the `production` environment on `main`. One deploy at a time, and an overtaken commit is skipped. `make deploy` stays as the manual fallback. |
| CI | GitHub Actions running `scripts/verify.sh` (the same file as `make verify`), one group per job, plus a docs link check, `govulncheck`, `bun audit` and a Docker build. |
| Tooling | Tool versions pinned in `mise.toml`; one Bun workspace (`apps/web`, `apps/tracker`) with a root `bun.lock`; Biome for TypeScript formatting and linting, gofmt and golangci-lint for Go. |
| Supply chain | Digest-pinned images, commit-pinned Actions, Trivy and CodeQL in CI, SBOM and signed provenance on releases, Dependabot. |

## Milestones

1. ✅ **Foundation** — repo skeleton, Go server, SQLite migrations, `POST /api/event`, Docker + compose, Litestream.
2. ✅ **Tracker** — `script.js`: page views, SPA navigation, outbound links, `data-mlz-event`, `mlz.track()`.
3. ✅ **Stats API + auth** — GitHub sign-in, sites CRUD, stats + breakdown endpoints.
4. ✅ **Dashboard** — React + Vite + shadcn/ui.
5. ✅ **Terraform** — Artifact Registry, Cloud Run, GCS, Secret Manager, Firebase Hosting.
6. ✅ **Contributor-friendliness** — README, CONTRIBUTING, SECURITY, issue/PR templates (good-first-issues: label some once the repo is public).
7. ✅ **Release pipeline** — CI hardening, versioned builds, GHCR image + binaries on tag with SBOM and provenance (`.github/workflows/release.yml`), privacy/upgrade docs. The first tag waits for the remaining production checks in [releasing.md](development/releasing.md).
8. ✅ **Hardening audit (November 2026)** — server, tracker, dashboard, tooling, infrastructure and docs reviewed and fixed in one series of pull requests; see the "Unreleased" section of the [changelog](../CHANGELOG.md).

## Open items

- ✅ Production domain: `analytics.mlz.no` (dashboard and API), `t.mlz.no` (tracking script).
- ✅ `PROXY_HOPS=2` on Cloud Run behind Firebase Hosting: production events carry the right country and one visitor per person.
- The rest of the pre-release checklist in [releasing.md](development/releasing.md#pre-release-checklist), then the first tag.

## Next

The product roadmap after the quality base, in order. Each is one pull request with its docs.

1. ✅ **Onboarding and empty states**: "waiting for the first event" with polling,
   `first_event_at`/`last_event_at` on sites.
2. ✅ **Goals and conversions**: `goals` table (event name or path, `*` wildcard), conversions
   and rate per goal on the overview, management in settings.
3. ✅ **CSV export**: breakdowns and time series with the same period and filter parameters,
   formula-escaped cells.
4. **Dashboard in the binary**: embed `apps/web/dist` in the Go binary and serve it from the
   same origin as the API, so `docker compose` gives self-hosters a working dashboard (see
   [Before 1.0](#before-10)). Firebase Hosting keeps serving it in production.

Dropped: **shareable read-only links** (a public `/api/share/{token}/…`). Every reader today is a
signed-in, allowlisted user, so a token-based read path would add an unauthenticated surface
without anyone to serve. Revisit together with site ownership if the dashboard gets readers
outside the allowlist.

Later, not scheduled: OIDC (see below), an OpenAPI
spec and `/api/v1`, rollup tables if queries get slow, email reports, funnels, property
filters, and `utm_term`/`utm_content`.

## Before 1.0

- **Dashboard for self-hosters.** The Docker image contains the API only. The dashboard (`apps/web/`) is
  deployed to Firebase Hosting and reaches the API through a same-origin rewrite, so someone running
  `docker compose` has a working collector but no dashboard unless they serve `apps/web/dist`
  themselves behind the same origin. Decide whether to embed `apps/web/dist` in the Go
  binary (simplest for self-hosting) or document a reverse-proxy recipe. Chosen: embed it,
  item 4 under [Next](#next).
- **Site ownership.** The dashboard is single-tenant: every allowlisted user can read and change
  every site. Fine for one person or one team; more would need a `site_users` table.
- **A second identity provider.** The `auth.Provider` interface is there; OIDC (Google, Keycloak)
  would make self-hosting without GitHub possible.
- **Schema freeze.** After 1.0, migrations stay additive and minor versions never break
  configuration.
