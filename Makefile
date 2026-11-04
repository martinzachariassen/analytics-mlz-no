VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)

.PHONY: run verify test lint format build docker tracker web dev-web dev dev-api dev-demo dev-reset deploy deploy-server deploy-web

run:
	go run ./apps/server/cmd/analytics serve

# scripts/verify.sh is the quality gate; CI runs the same file. Tools: `mise install`, packages: `bun install`.
verify:
	./scripts/verify.sh

test:
	./scripts/verify.sh go tracker web

lint:
	./scripts/verify.sh lint
	cd apps/server && golangci-lint run

format:
	bun run format

build:
	CGO_ENABLED=0 go build -trimpath -ldflags "-X main.version=$(VERSION)" -o bin/analytics ./apps/server/cmd/analytics

docker:
	docker build -f infra/docker/Dockerfile --build-arg VERSION=$(VERSION) -t analytics-mlz-no:local .

# Rebuild the embedded tracking script after changing apps/tracker/src.
tracker:
	cd apps/tracker && bun run build

# Dashboard dev server on :5173 (proxies /api to `make run` on :8080).
dev-web:
	cd apps/web && bun run dev

# ---------------------------------------------------------------- local test environment

# Everything for trying the dashboard locally: a separate database with synthetic data,
# automatic sign-in (DEV_LOGIN, localhost only) and a demo site that sends real events.
#   dashboard  http://localhost:5173
#   demo site  http://localhost:8081/?site=<id>   (printed below)
DEV_ENV = DATABASE_PATH=data/dev.db PUBLIC_URL=http://localhost:5173 DEV_LOGIN=1 GITHUB_CLIENT_ID= GITHUB_CLIENT_SECRET=

dev:
	@$(DEV_ENV) go run ./apps/server/cmd/analytics seed
	@echo
	@echo "  Dashboard:  http://localhost:5173"
	@echo "  Demo site:  http://localhost:8081/?site=$$($(DEV_ENV) go run ./apps/server/cmd/analytics sites list | awk '$$NF != "CREATED" && $$(NF-1) == "localhost" {print $$1}')"
	@echo
	@$(MAKE) --no-print-directory -j3 dev-api dev-web dev-demo

dev-api:
	$(DEV_ENV) go run ./apps/server/cmd/analytics serve

dev-demo:
	python3 -m http.server 8081 --bind 127.0.0.1 --directory apps/demo

# Start over with fresh synthetic data on the next `make dev`.
dev-reset:
	rm -f data/dev.db data/dev.db-wal data/dev.db-shm

# Production build of the dashboard into apps/web/dist. TRACKER_ORIGIN is the host the
# "Tracking code" page puts in the snippet (default: the dashboard's own origin).
TRACKER_ORIGIN ?=
web:
	cd apps/web && bun install --frozen-lockfile --silent
	cd apps/web && VITE_TRACKER_ORIGIN=$(TRACKER_ORIGIN) bun run build

# ---------------------------------------------------------------- production (see infra/terraform)

PROJECT ?= analytics-mlz-no
REGION  ?= europe-north1
SERVICE ?= analytics
BACKUP_JOB ?= $(SERVICE)-backup
# Untracked files count as dirty too: a build must match a commit, or say that it does not.
DIRTY   := $(shell test -z "$$(git status --porcelain -- apps infra go.work)" || echo -dirty)
IMAGE   ?= $(REGION)-docker.pkg.dev/$(PROJECT)/analytics/server:$(shell git rev-parse --short HEAD)$(DIRTY)

# Server first, then the dashboard: a new dashboard must never go live before the API it needs.
deploy: deploy-check
	$(MAKE) deploy-server
	$(MAKE) deploy-web

# Refuses to deploy anything that is not a pushed commit on main, unless FORCE=1. Runs the
# quality gate first, so what reaches production is what CI would have passed.
deploy-check:
ifndef FORCE
	@test -z "$(DIRTY)" || { echo "error: uncommitted changes in apps/, infra/ or go.work (FORCE=1 to deploy anyway)"; exit 1; }
	@test "$$(git rev-parse --abbrev-ref HEAD)" = main || { echo "error: not on main (FORCE=1 to deploy anyway)"; exit 1; }
	@git fetch -q origin main && test "$$(git rev-parse HEAD)" = "$$(git rev-parse origin/main)" || { echo "error: HEAD is not pushed to origin/main (FORCE=1 to deploy anyway)"; exit 1; }
endif
	./scripts/verify.sh lint go tracker web

# Build for Cloud Run (amd64), push to Artifact Registry and roll out a new revision.
# One-time setup: gcloud auth configure-docker $(REGION)-docker.pkg.dev
deploy-server: deploy-check
	docker buildx build --platform linux/amd64 --build-arg VERSION=$(VERSION) -f infra/docker/Dockerfile -t $(IMAGE) --push .
	gcloud run deploy $(SERVICE) --image $(IMAGE) --region $(REGION) --project $(PROJECT) --quiet
	gcloud run jobs update $(BACKUP_JOB) --image $(IMAGE) --region $(REGION) --project $(PROJECT) --quiet

# Build the dashboard and publish it to Firebase Hosting (rewrites /api/** to Cloud Run).
# SERVICE and REGION are also hard-coded in apps/web/firebase.json; change both.
deploy-web: deploy-check web
	cd apps/web && bunx firebase-tools deploy --only hosting --project $(PROJECT) --non-interactive
