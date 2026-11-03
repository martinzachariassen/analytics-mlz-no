# CLAUDE.md

Self-hostable, cookie-free web analytics. Plan and all architectural decisions: `docs/PLAN.md` — read it before larger changes.

## Layout

- `server/cmd/analytics` — main binary (`serve`, `sites add|list`)
- `server/internal/` — `config`, `store` (SQLite + embedded migrations, stats queries), `ingest` (POST /api/event), `visitor` (daily salt + hashing), `geo`, `httpx` (client IP, rate limit, JSON), `auth` (GitHub OAuth + sessions), `api` (sites + stats endpoints), `tracker` (embedded script.js), `server` (router)
- API reference: `docs/API.md`
- `server/internal/devdata` — synthetic traffic for `analytics seed`; `dev/demo/` — demo site for `make dev`
- `deploy/` — Dockerfile, docker-compose, Litestream config, entrypoint
- `tracker/` — TypeScript tracking script (`src/core.ts` logic, `src/index.ts` entry). Built with esbuild into `server/internal/tracker/script.js`, which is committed and embedded in the Go binary. Run `make tracker` after changes; CI fails if it's stale.
- `web/` — dashboard: React 19 + Vite + Tailwind v4 + shadcn/ui (radix-nova), TanStack Query, React Router. `src/lib/api.ts` is the typed API client; `src/routes/` pages; `src/components/ui/` is shadcn-generated (add with `npx shadcn@latest add <name>`, avoid hand-editing). Dev server proxies `/api` to :8080, same as Firebase Hosting in production. Look: mlz brand colours (`src/styles/mlz-brand.css`, vendored from mlz.no, see its header) mapped onto shadcn tokens in `src/index.css`; type is Instrument Sans (UI, numbers), Instrument Serif (headlines), Geist Mono (labels); shadcn components are restyled from `index.css` via `data-slot`, not by editing them. App primitives: `panel.tsx`, `delta.tsx`, `segmented.tsx`, `brand-mark.tsx`.
- `infra/` — coming in milestone 5

## Commands

- `make test` — Go tests + tracker tests (vitest + happy-dom)
- `cd web && npm run typecheck && npm run lint` — dashboard checks
- `make lint` — `golangci-lint run`
- `make run` — run the server locally on :8080 (data in `./data`)
- `make dev` — local test environment: API + dashboard + demo site (:8081), two demo sites with two years of synthetic data in `data/dev.db`, one-click sign-in via `DEV_LOGIN=1` (localhost only). `make dev-reset` wipes it.
- `make dev-web` — dashboard on :5173; set `PUBLIC_URL=http://localhost:5173` for the server
- `docker compose -f deploy/docker-compose.yml up --build`

## Conventions

- Pure Go, no CGO (`modernc.org/sqlite`). Standard library `net/http` routing.
- Never store IP addresses or raw user agents. Only derived, coarse fields.
- Migrations: add a new numbered file in `server/internal/store/migrations/`; never edit an applied one.
- Session cookie must be named `__session` (Firebase Hosting only forwards that cookie).
- Auth is OAuth-only (no passwords). Mutating dashboard endpoints must use `httpx.ReadJSON` (requires `application/json`, which is the CSRF protection).
- Breakdown dimensions are a whitelist in `store.Dimensions`; never interpolate user input into SQL.
- Code, comments and docs in English.
