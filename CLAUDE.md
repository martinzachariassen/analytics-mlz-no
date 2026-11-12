# CLAUDE.md

Self-hostable, cookie-free web analytics. Read `ARCHITECTURE.md` (code map, invariants) and `docs/decisions.md` (architectural decisions) before larger changes. Docs index: `docs/README.md`.

## Golden rule: docs move with the code

Every change that adds, changes or removes behaviour, configuration, an endpoint, a CLI command, a stored field, a tool or a workflow must update the docs **in the same PR**. Before opening a PR:

1. **Scan**: grep `README.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`, `CLAUDE.md` and `docs/` for every name you touched (env var, flag, endpoint, file path, command, package) and read the pages the "If you change…, update…" table in `CONTRIBUTING.md` points to.
2. **Update**: fix every hit so it describes the code as it is after the PR. Add new things where a reader will look for them (reference page, guide, runbook, `CHANGELOG.md`).
3. **Never downgrade**: when removing or replacing something, rewrite the affected docs so they stay just as complete, keeping the TL;DR, examples, `<details>` and "Next steps". Removing a feature removes its docs, never the surrounding explanation. Rebasing or resolving conflicts must not drop doc content from either side.

A PR that changes behaviour without matching docs is not done.

## Layout

Monorepo: `apps/` holds everything that runs (`server`, `web`, `tracker`, `demo`), `infra/` holds Docker and Terraform. The Go module lives in `apps/server`; a root `go.work` lets `go run ./apps/server/cmd/analytics` work from the repo root.

- `apps/server/cmd/analytics` — main binary (`serve`, `sites add|list`, `events purge`, `sessions revoke`, `seed`, `version`)
- `apps/server/internal/` — `config`, `store` (SQLite + embedded migrations, stats queries), `ingest` (POST /api/event), `visitor` (daily salt + hashing), `geo`, `httpx` (client IP, rate limit, JSON), `auth` (GitHub OAuth + sessions), `api` (sites + stats endpoints), `script` (embedded tracking script), `server` (router)
- Docs: API `docs/reference/api.md`; env/Terraform vars `docs/reference/configuration.md`; CLI `docs/reference/cli.md`; privacy facts `docs/privacy.md` (update when stored fields change); operations `docs/operations/runbook.md`; release process `docs/development/releasing.md` + `.github/workflows/release.yml`; `CHANGELOG.md` gets a line per user-visible change. The "If you change…, update…" table in `CONTRIBUTING.md` says which page to update. Docs changes go in the same PR as the code.
- `apps/server/internal/devdata` — synthetic traffic for `analytics seed`; `apps/demo/` — demo site for `make dev`
- `infra/docker/` — Dockerfile, docker-compose, Litestream config, entrypoint, restore test
- `apps/tracker/` — TypeScript tracking script (`src/core.ts` logic, `src/index.ts` entry). Built with esbuild into `apps/server/internal/script/script.js`, which is committed and embedded in the Go binary. Run `make tracker` after changes; CI fails if it's stale or over 1024 B gzipped.
- `apps/web/` — dashboard: React 19 + Vite + Tailwind v4 + shadcn/ui (radix-nova), TanStack Query, React Router. `src/lib/api.ts` is the typed API client; `src/components/ui/` is shadcn-generated (add with `cd apps/web && bunx shadcn@latest add <name>`, avoid hand-editing; Biome skips that folder). Dev server proxies `/api` to :8080 (override with `API_PROXY`), same as Firebase Hosting in production.
  - Structure: `routes/app-layout.tsx` (auth + sidebar shell), `routes/site/` (per-site views: overview, realtime, pages/sources/locations/devices via `report.tsx`, events; `layout.tsx` has the top bar). Period, comparison, interval, filters (`f=dim:op:value`) and the detail sheet (`detail=dim:value`) live in the URL via `lib/use-scope.ts`, shared by all views. Dimension labels in `lib/dims.ts`, metrics in `lib/metrics.ts`, query hooks in `lib/queries.ts`.
  - Look: Linear/Vercel-style, dark first (`index.html` + `theme-provider`). Neutral tokens, one violet accent, `--positive`/`--negative` for deltas, and `--series-1..6` as the categorical chart palette in fixed order (validated for colour vision deficiency in both themes; do not reorder). All defined in `src/index.css`; `src/styles/mlz-brand.css` only supplies the wordmark face. Type is Geist plus Geist Mono. shadcn components are restyled from `index.css` via `data-slot`, not by editing them.
  - App primitives: `panel.tsx`, `kpi-strip.tsx`, `traffic-chart.tsx`, `bar-list.tsx`, `data-table.tsx`, `report-card.tsx`, `filter-bar.tsx`, `date-range-picker.tsx`, `detail-sheet.tsx`, `delta.tsx`.
- `infra/terraform/` — Terraform for GCP: `bootstrap` (project, APIs, state bucket, budget; local state) and `main` (Cloud Run, GCS replica bucket, Secret Manager, Firebase Hosting; GCS state). Deploy guide: `docs/guides/deploy-gcp.md`

## Commands

Tools are pinned in `mise.toml` (`mise install`); JavaScript packages are a Bun workspace (`bun install` at the root, which also installs the pre-commit hook). Biome replaces eslint and prettier.

- `make verify` — `scripts/verify.sh`, the quality gate CI runs too (groups: `lint go tracker web infra`)
- `make test` — Go tests (race) + tracker tests (vitest + happy-dom) + dashboard tests and build
- `make lint` — Biome + gofmt, then `golangci-lint run`; `make format` fixes formatting
- `make run` — run the server locally on :8080 (data in `./data`)
- `make dev` — local test environment: API + dashboard + demo site (:8081), two demo sites with two years of synthetic data in `data/dev.db`, one-click sign-in via `DEV_LOGIN=1` (localhost only). `make dev-reset` wipes it.
- `make dev-web` — dashboard on :5173; set `PUBLIC_URL=http://localhost:5173` for the server
- `docker compose -f infra/docker/docker-compose.yml up --build`
- `infra/docker/test-restore.sh` — verifies Litestream backup/restore with the local Docker image; `go run ./apps/server/cmd/loadtest` — ingest load test
- `make deploy` — build/push the server image to Cloud Run and publish the dashboard to Firebase Hosting

## Conventions

- Pure Go, no CGO (`modernc.org/sqlite`). Standard library `net/http` routing.
- Never store IP addresses or raw user agents. Only derived, coarse fields.
- Migrations: add a new numbered file in `apps/server/internal/store/migrations/`; never edit an applied one.
- Session cookie must be named `__session` (Firebase Hosting only forwards that cookie).
- Auth is OAuth-only (no passwords). Mutating dashboard endpoints must use `httpx.ReadJSON` (requires `application/json`, which is the CSRF protection); endpoints without a body (`DELETE`, logout) must check `auth.SameOrigin`.
- Rate limiters are keyed on parsed IP addresses (`httpx.ClientIP`/`PeerIP`), never on raw header text; check the peer limiter before the client limiter.
- Breakdown dimensions are a whitelist in `store.Dimensions`; never interpolate user input into SQL.
- Code, comments and docs in English. No comments unless they explain a non-obvious why.
- Conventional Commits; PRs use the template; every user-visible change gets a line in `CHANGELOG.md`. Merging to `main`, tagging and releasing happen only when Martin asks. Terraform `plan`/`apply` are run by hand, never by CI.
