# CLAUDE.md

Self-hostable, cookie-free web analytics. Plan and all architectural decisions: `docs/PLAN.md` — read it before larger changes.

## Layout

- `server/cmd/analytics` — main binary (`serve`, `sites add|list`)
- `server/internal/` — `config`, `store` (SQLite + embedded migrations), `ingest` (POST /api/event), `visitor` (daily salt + hashing), `geo`, `httpx` (client IP, rate limit), `server` (router)
- `deploy/` — Dockerfile, docker-compose, Litestream config, entrypoint
- `web/`, `tracker/`, `infra/` — coming in later milestones

## Commands

- `make test` — `go test ./...`
- `make lint` — `golangci-lint run`
- `make run` — run the server locally on :8080 (data in `./data`)
- `docker compose -f deploy/docker-compose.yml up --build`

## Conventions

- Pure Go, no CGO (`modernc.org/sqlite`). Standard library `net/http` routing.
- Never store IP addresses or raw user agents. Only derived, coarse fields.
- Migrations: add a new numbered file in `server/internal/store/migrations/`; never edit an applied one.
- Session cookie must be named `__session` (Firebase Hosting only forwards that cookie).
- Code, comments and docs in English.
