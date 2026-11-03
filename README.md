# analytics-mlz-no

Lightweight, privacy-friendly, self-hostable web analytics written in Go.

- Cookie-free, anonymous visitor counting (no IP addresses stored)
- Page views, SPA navigation, outbound links and custom events
- SQLite storage (with optional Litestream replication)
- React + shadcn/ui dashboard

> 🚧 Early development — not ready for production yet. See [docs/PLAN.md](docs/PLAN.md).

## Quick start (Docker)

```sh
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml exec analytics analytics sites add -domain example.com
```

Send a test event:

```sh
curl -A "Mozilla/5.0" --data '{"site":"<site-id>","url":"https://example.com/"}' http://localhost:8080/api/event
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` / `ADDR` | `8080` / `:$PORT` | Listen address |
| `DATABASE_PATH` | `data/analytics.db` | SQLite file |
| `GEOIP_DB_PATH` | bundled in Docker image | MaxMind-format country DB (DB-IP Lite) |
| `PROXY_HOPS` | `0` | Trusted reverse proxies in front (1 = Cloud Run / nginx, 2 = Firebase → Cloud Run) |
| `RETENTION_DAYS` | `0` | Delete events older than N days (0 = forever) |
| `LITESTREAM_REPLICA_URL` | – | Continuous backup, e.g. `gs://bucket/analytics` or `s3://bucket/analytics` |

## Development

```sh
make test   # go test -race ./...
make lint   # golangci-lint
make run    # local server on :8080
```

IP geolocation by [DB-IP](https://db-ip.com) (CC BY 4.0).

## License

[MIT](LICENSE)
