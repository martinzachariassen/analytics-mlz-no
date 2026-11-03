.PHONY: run test lint build docker tracker

run:
	go run ./server/cmd/analytics serve

test:
	go test -race ./...
	cd tracker && npm test

lint:
	golangci-lint run

build:
	CGO_ENABLED=0 go build -trimpath -o bin/analytics ./server/cmd/analytics

docker:
	docker build -f deploy/Dockerfile -t analytics-mlz-no:local .

# Rebuild the embedded tracking script after changing tracker/src.
tracker:
	cd tracker && npm run build
