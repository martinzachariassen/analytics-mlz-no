.PHONY: run test lint build docker tracker web dev-web dev dev-api dev-demo dev-reset

run:
	go run ./server/cmd/analytics serve

test:
	go test -race ./server/...
	cd tracker && npm test

lint:
	golangci-lint run
	cd web && npm run lint

build:
	CGO_ENABLED=0 go build -trimpath -o bin/analytics ./server/cmd/analytics

docker:
	docker build -f deploy/Dockerfile -t analytics-mlz-no:local .

# Rebuild the embedded tracking script after changing tracker/src.
tracker:
	cd tracker && npm run build

# Dashboard dev server on :5173 (proxies /api to `make run` on :8080).
dev-web:
	cd web && npm run dev

# ---------------------------------------------------------------- local test environment

# Everything for trying the dashboard locally: a separate database with synthetic data,
# automatic sign-in (DEV_LOGIN, localhost only) and a demo site that sends real events.
#   dashboard  http://localhost:5173
#   demo site  http://localhost:8081/?site=<id>   (printed below)
DEV_ENV = DATABASE_PATH=data/dev.db PUBLIC_URL=http://localhost:5173 DEV_LOGIN=1 GITHUB_CLIENT_ID= GITHUB_CLIENT_SECRET=

dev:
	@$(DEV_ENV) go run ./server/cmd/analytics seed
	@echo
	@echo "  Dashboard:  http://localhost:5173"
	@echo "  Demo site:  http://localhost:8081/?site=$$($(DEV_ENV) go run ./server/cmd/analytics sites list | awk '$$NF != "CREATED" && $$(NF-1) == "localhost" {print $$1}')"
	@echo
	@$(MAKE) --no-print-directory -j3 dev-api dev-web dev-demo

dev-api:
	$(DEV_ENV) go run ./server/cmd/analytics serve

dev-demo:
	python3 -m http.server 8081 --bind 127.0.0.1 --directory dev/demo

# Start over with fresh synthetic data on the next `make dev`.
dev-reset:
	rm -f data/dev.db data/dev.db-wal data/dev.db-shm

# Production build of the dashboard into web/dist.
web:
	cd web && npm run build
