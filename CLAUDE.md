# CLAUDE.md

Self-hostable, cookie-free web analytics. Plan and all architectural decisions: `docs/PLAN.md` — read it before larger changes.

## Layout

- `server/cmd/analytics` — main binary (`serve`, `sites add|list`)
- `server/internal/` — `config`, `store` (SQLite + embedded migrations, stats queries), `ingest` (POST /api/event), `visitor` (daily salt + hashing), `geo`, `httpx` (client IP, rate limit, JSON), `auth` (GitHub OAuth + sessions), `api` (sites + stats endpoints), `tracker` (embedded script.js), `server` (router)
- API reference: `docs/API.md`
- `deploy/` — Dockerfile, docker-compose, Litestream config, entrypoint
- `tracker/` — TypeScript tracking script (`src/core.ts` logic, `src/index.ts` entry). Built with esbuild into `server/internal/tracker/script.js`, which is committed and embedded in the Go binary. Run `make tracker` after changes; CI fails if it's stale.
- `web/`, `infra/` — coming in later milestones

## Commands

- `make test` — Go tests + tracker tests (vitest + happy-dom)
- `make lint` — `golangci-lint run`
- `make run` — run the server locally on :8080 (data in `./data`)
- `docker compose -f deploy/docker-compose.yml up --build`

## Conventions

- Pure Go, no CGO (`modernc.org/sqlite`). Standard library `net/http` routing.
- Never store IP addresses or raw user agents. Only derived, coarse fields.
- Migrations: add a new numbered file in `server/internal/store/migrations/`; never edit an applied one.
- Session cookie must be named `__session` (Firebase Hosting only forwards that cookie).
- Auth is OAuth-only (no passwords). Mutating dashboard endpoints must use `httpx.ReadJSON` (requires `application/json`, which is the CSRF protection).
- Breakdown dimensions are a whitelist in `store.Dimensions`; never interpolate user input into SQL.
- Code, comments and docs in English.
