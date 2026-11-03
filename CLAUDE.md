# CLAUDE.md

Self-hostable, cookie-free web analytics. Plan and all architectural decisions: `docs/PLAN.md` — read it before larger changes.

## Layout

- `server/cmd/analytics` — main binary (`serve`, `sites add|list`)
- `server/internal/` — `config`, `store` (SQLite + embedded migrations, stats queries), `ingest` (POST /api/event), `visitor` (daily salt + hashing), `geo`, `httpx` (client IP, rate limit, JSON), `auth` (GitHub OAuth + sessions), `api` (sites + stats endpoints), `tracker` (embedded script.js), `server` (router)
- API reference: `docs/API.md`
- `server/internal/devdata` — synthetic traffic for `analytics seed`; `dev/demo/` — demo site for `make dev`
- `deploy/` — Dockerfile, docker-compose, Litestream config, entrypoint
- `tracker/` — TypeScript tracking script (`src/core.ts` logic, `src/index.ts` entry). Built with esbuild into `server/internal/tracker/script.js`, which is committed and embedded in the Go binary. Run `make tracker` after changes; CI fails if it's stale.
- `web/` — dashboard: React 19 + Vite + Tailwind v4 + shadcn/ui (radix-nova), TanStack Query, React Router. `src/lib/api.ts` is the typed API client; `src/components/ui/` is shadcn-generated (add with `npx shadcn@latest add <name>`, avoid hand-editing). Dev server proxies `/api` to :8080 (override with `API_PROXY`), same as Firebase Hosting in production.
  - Structure: `routes/app-layout.tsx` (auth + sidebar shell), `routes/site/` (per-site views: overview, realtime, pages/sources/locations/devices via `report.tsx`, events; `layout.tsx` has the top bar). Period, comparison, interval, filters (`f=dim:op:value`) and the detail sheet (`detail=dim:value`) live in the URL via `lib/use-scope.ts`, shared by all views. Dimension labels in `lib/dims.ts`, metrics in `lib/metrics.ts`, query hooks in `lib/queries.ts`.
  - Look: Linear/Vercel-style, dark first (`index.html` + `theme-provider`). Neutral tokens, one violet accent, `--positive`/`--negative` for deltas, and `--series-1..6` as the categorical chart palette in fixed order (validated for colour vision deficiency in both themes; do not reorder). All defined in `src/index.css`; `src/styles/mlz-brand.css` only supplies the wordmark face. Type is Geist plus Geist Mono. shadcn components are restyled from `index.css` via `data-slot`, not by editing them.
  - App primitives: `panel.tsx`, `kpi-strip.tsx`, `traffic-chart.tsx`, `bar-list.tsx`, `data-table.tsx`, `report-card.tsx`, `filter-bar.tsx`, `date-range-picker.tsx`, `detail-sheet.tsx`, `delta.tsx`.
- `infra/` — Terraform for GCP: `bootstrap` (project, APIs, state bucket, budget; local state) and `main` (Cloud Run, GCS replica bucket, Secret Manager, Firebase Hosting; GCS state). Deploy guide: `docs/DEPLOY.md`

## Commands

- `make test` — Go tests + tracker tests (vitest + happy-dom)
- `cd web && npm run typecheck && npm run lint` — dashboard checks
- `make lint` — `golangci-lint run`
- `make run` — run the server locally on :8080 (data in `./data`)
- `make dev` — local test environment: API + dashboard + demo site (:8081), two demo sites with two years of synthetic data in `data/dev.db`, one-click sign-in via `DEV_LOGIN=1` (localhost only). `make dev-reset` wipes it.
- `make dev-web` — dashboard on :5173; set `PUBLIC_URL=http://localhost:5173` for the server
- `docker compose -f deploy/docker-compose.yml up --build`
- `make deploy` — build/push the server image to Cloud Run and publish the dashboard to Firebase Hosting

## Conventions

- Pure Go, no CGO (`modernc.org/sqlite`). Standard library `net/http` routing.
- Never store IP addresses or raw user agents. Only derived, coarse fields.
- Migrations: add a new numbered file in `server/internal/store/migrations/`; never edit an applied one.
- Session cookie must be named `__session` (Firebase Hosting only forwards that cookie).
- Auth is OAuth-only (no passwords). Mutating dashboard endpoints must use `httpx.ReadJSON` (requires `application/json`, which is the CSRF protection).
- Breakdown dimensions are a whitelist in `store.Dimensions`; never interpolate user input into SQL.
- Code, comments and docs in English.
