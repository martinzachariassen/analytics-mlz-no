.PHONY: run test lint build docker tracker web dev-web deploy deploy-server deploy-web

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

# Production build of the dashboard into web/dist.
web:
	cd web && npm run build

# ---------------------------------------------------------------- production (see infra/)

PROJECT ?= analytics-mlz-no
REGION  ?= europe-north1
SERVICE ?= analytics
IMAGE   ?= $(REGION)-docker.pkg.dev/$(PROJECT)/analytics/server:$(shell git rev-parse --short HEAD)$(shell git diff --quiet HEAD -- server deploy go.mod go.sum || echo -dirty)

deploy: deploy-server deploy-web

# Build for Cloud Run (amd64), push to Artifact Registry and roll out a new revision.
# One-time setup: gcloud auth configure-docker $(REGION)-docker.pkg.dev
deploy-server:
	docker buildx build --platform linux/amd64 -f deploy/Dockerfile -t $(IMAGE) --push .
	gcloud run deploy $(SERVICE) --image $(IMAGE) --region $(REGION) --project $(PROJECT) --quiet

# Build the dashboard and publish it to Firebase Hosting (rewrites /api/** to Cloud Run).
deploy-web: web
	cd web && firebase deploy --only hosting --project $(PROJECT) --non-interactive
