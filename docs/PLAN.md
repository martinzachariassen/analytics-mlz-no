# Plan

Lightweight, privacy-friendly, self-hostable web analytics (inspired by Umami/Plausible, but smaller).

## Decisions

| Area | Decision |
|---|---|
| Repo | Monorepo: `server/` (Go), `web/` (React + Vite + shadcn/ui), `tracker/` (JS snippet), `deploy/` (Docker), `infra/` (Terraform). MIT license. |
| Go module | `github.com/martinzachariassen/analytics-mlz-no` (go.mod at repo root, code under `server/`) |
| Database | SQLite (`modernc.org/sqlite`, pure Go, no CGO). WAL mode. |
| Durability on Cloud Run | Litestream replicates SQLite to a GCS bucket; restores on start. `max-instances=1`. |
| Hosting | GCP Cloud Run in `europe-north1`; dashboard on Firebase Hosting with `/api/**` rewritten to Cloud Run (same origin). Self-hosters use `docker compose`. |
| Auth | **GitHub OAuth only** (no passwords). `ALLOWED_GITHUB_USERS` allowlist; username bound to the stable GitHub account id on first sign-in. Provider interface so Google/OIDC can be added later. Session cookie **must** be named `__session` (the only cookie Firebase Hosting forwards); it also carries the OAuth state during sign-in. |
| Privacy | No cookies, no stored IPs or raw user agents. Visitor id = hash(daily salt + site id + IP + UA). Salt rotates daily (UTC) and old salts are deleted. |
| Events (v1) | Page views, SPA navigation (pushState/popstate), outbound links (auto), custom events via `data-track` attributes and `window.mlz.track(name, props)`. |
| Dimensions (v1) | Views, uniques, bounce rate, top pages, referrer + UTM, browser/OS/device, country (DB-IP Lite, CC BY 4.0). |
| Retention | Keep forever by default; `RETENTION_DAYS` deletes older events. |
| Infra | Terraform, new GCP project. |
| CI | GitHub Actions: Go test + golangci-lint + web build. |

## Milestones

1. ✅ **Foundation** — repo skeleton, Go server, SQLite migrations, `POST /api/event`, Docker + compose, Litestream.
2. ✅ **Tracker** — `script.js`: page views, SPA navigation, outbound links, `data-track`, `mlz.track()`.
3. ✅ **Stats API + auth** — GitHub sign-in, sites CRUD, stats + breakdown endpoints.
4. ✅ **Dashboard** — React + Vite + shadcn/ui.
5. **Terraform** — Artifact Registry, Cloud Run, GCS, Secret Manager, Firebase Hosting.
6. **Contributor-friendliness** — README, CONTRIBUTING, issue templates, good-first-issues.

## Open items

- Production domain (needed for milestone 5).
- Verify `PROXY_HOPS` value on Cloud Run behind Firebase by logging `X-Forwarded-For`.
