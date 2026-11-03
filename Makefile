.PHONY: run test lint build docker tracker web dev-web

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
