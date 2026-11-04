VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)

.PHONY: run test lint build docker tracker web dev-web dev dev-api dev-demo dev-reset deploy deploy-server deploy-web

run:
	go run ./apps/server/cmd/analytics serve

test:
	go test -race ./apps/server/...
	cd apps/tracker && npm test
	cd apps/web && npm test

lint:
	cd apps/server && golangci-lint run
	cd apps/web && npm run lint

build:
	CGO_ENABLED=0 go build -trimpath -ldflags "-X main.version=$(VERSION)" -o bin/analytics ./apps/server/cmd/analytics

docker:
	docker build -f infra/docker/Dockerfile --build-arg VERSION=$(VERSION) -t analytics-mlz-no:local .

# Rebuild the embedded tracking script after changing apps/tracker/src.
tracker:
	cd apps/tracker && npm run build

# Dashboard dev server on :5173 (proxies /api to `make run` on :8080).
dev-web:
	cd apps/web && npm run dev

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

# Production build of the dashboard into apps/web/dist.
web:
	cd apps/web && npm run build

# ---------------------------------------------------------------- production (see infra/terraform)

PROJECT ?= analytics-mlz-no
REGION  ?= europe-north1
SERVICE ?= analytics
IMAGE   ?= $(REGION)-docker.pkg.dev/$(PROJECT)/analytics/server:$(shell git rev-parse --short HEAD)$(shell git diff --quiet HEAD -- apps infra go.work || echo -dirty)

deploy: deploy-server deploy-web

# Build for Cloud Run (amd64), push to Artifact Registry and roll out a new revision.
# One-time setup: gcloud auth configure-docker $(REGION)-docker.pkg.dev
deploy-server:
	docker buildx build --platform linux/amd64 --build-arg VERSION=$(VERSION) -f infra/docker/Dockerfile -t $(IMAGE) --push .
	gcloud run deploy $(SERVICE) --image $(IMAGE) --region $(REGION) --project $(PROJECT) --quiet

# Build the dashboard and publish it to Firebase Hosting (rewrites /api/** to Cloud Run).
deploy-web: web
	cd apps/web && firebase deploy --only hosting --project $(PROJECT) --non-interactive
