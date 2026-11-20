VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)

.PHONY: run verify test lint format build docker tracker web embed-web dev-web dev dev-api dev-live dev-reset deploy deploy-check deploy-server deploy-web

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

# A self-contained binary: the dashboard is built and embedded first (needs Bun).
build: embed-web
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

# Everything for trying the dashboard locally: a separate database with synthetic data for
# every feature, automatic sign-in (DEV_LOGIN, localhost only), a demo site that sends real
# events and a steady trickle of synthetic visits so Realtime moves. scripts/dev.sh starts
# it all and prints what runs where; dev-api, dev-web and dev-live start one part each.
#   dashboard  http://localhost:5173
#   API        http://127.0.0.1:8080
#   demo site  http://localhost:8081   (served by `seed -live -demo`)
DEV_ENV = DATABASE_PATH=data/dev.db PUBLIC_URL=http://localhost:5173 DEV_LOGIN=1 GITHUB_CLIENT_ID= GITHUB_CLIENT_SECRET= ADDR=127.0.0.1:8080

dev:
	@./scripts/dev.sh

dev-api:
	$(DEV_ENV) go run ./apps/server/cmd/analytics serve

dev-live:
	$(DEV_ENV) go run ./apps/server/cmd/analytics seed -live -demo 127.0.0.1:8081

# Start over with fresh synthetic data on the next `make dev`.
dev-reset:
	rm -f data/dev.db data/dev.db-wal data/dev.db-shm

# Production build of the dashboard into apps/web/dist. TRACKER_ORIGIN is the host the
# "Tracking code" page puts in the snippet (default: the dashboard's own origin).
TRACKER_ORIGIN ?=
web:
	cd apps/web && bun install --frozen-lockfile --silent
	cd apps/web && VITE_TRACKER_ORIGIN=$(TRACKER_ORIGIN) bun run build

# Copy the dashboard build into the server package, so the next `go build` embeds it.
WEB_EMBED = apps/server/internal/web/static
embed-web: web
	find $(WEB_EMBED) -mindepth 1 ! -name .gitkeep -delete
	cp -R apps/web/dist/. $(WEB_EMBED)/

# ---------------------------------------------------------------- production (see infra/terraform)

PROJECT ?= analytics-mlz-no
REGION  ?= europe-north1
SERVICE ?= analytics
BACKUP_JOB ?= $(SERVICE)-backup
# Any change in the working tree counts, untracked files included: a build must match a commit,
# or say that it does not. (Git-ignored files such as terraform.tfvars do not count.)
DIRTY   := $(shell test -z "$$(git status --porcelain)" || echo -dirty)
IMAGE   ?= $(REGION)-docker.pkg.dev/$(PROJECT)/analytics/server:$(shell git rev-parse --short HEAD)$(DIRTY)

# Server first, then the dashboard: a new dashboard must never go live before the API it needs.
# The check runs once here; SKIP_CHECK=1 stops the two sub-makes from repeating it.
deploy: deploy-check
	$(MAKE) deploy-server SKIP_CHECK=1
	$(MAKE) deploy-web SKIP_CHECK=1

# Refuses to deploy anything that is not a pushed commit on main, unless FORCE=1. Runs the
# quality gate first, so what reaches production is what CI would have passed.
deploy-check:
ifneq ($(SKIP_CHECK),1)
ifneq ($(FORCE),1)
	@test -z "$(DIRTY)" || { echo "error: uncommitted changes (FORCE=1 to deploy anyway)"; exit 1; }
	@test "$$(git rev-parse --abbrev-ref HEAD)" = main || { echo "error: not on main (FORCE=1 to deploy anyway)"; exit 1; }
	@git fetch -q origin main || { echo "error: could not fetch origin/main to compare (offline? FORCE=1 to deploy anyway)"; exit 1; }
	@test "$$(git rev-parse HEAD)" = "$$(git rev-parse origin/main)" || { echo "error: HEAD is not origin/main; push or pull first (FORCE=1 to deploy anyway)"; exit 1; }
endif
	./scripts/verify.sh lint go tracker web
endif

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
