.PHONY: run test lint build docker

run:
	go run ./server/cmd/analytics serve

test:
	go test -race ./...

lint:
	golangci-lint run

build:
	CGO_ENABLED=0 go build -trimpath -o bin/analytics ./server/cmd/analytics

docker:
	docker build -f deploy/Dockerfile -t analytics-mlz-no:local .
