# analytics-mlz-no

Lightweight, privacy-friendly, self-hostable web analytics written in Go.

[![CI](https://github.com/martinzachariassen/analytics-mlz-no/actions/workflows/ci.yml/badge.svg)](https://github.com/martinzachariassen/analytics-mlz-no/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

- **Cookie-free and anonymous.** No IP addresses or user agents are stored. Visitors are counted with a hash that changes every day.
- **Tiny script.** About 1 KB gzipped. Tracks page views, single-page-app navigation, outbound links and custom events.
- **One binary, one SQLite file.** Optional continuous backup with Litestream.
- **Modern dashboard.** React + Vite + shadcn/ui, with GitHub sign-in. Filters, comparisons, realtime, and goals with conversion rates.

> [!NOTE]
> **Status: pre-1.0.** It works and runs on the author's own sites, but configuration and the
> database schema can still change between minor versions. Read the [changelog](CHANGELOG.md)
> before upgrading.

## Try it in one command

```sh
mise install && bun install   # tools pinned in mise.toml, JavaScript packages
make dev
```

This starts the API (:8080), the dashboard (<http://localhost:5173>) and a demo site
(<http://localhost:8081>) with two years of synthetic traffic. Sign-in is one click, with no
setup. Tools (Go, Bun, Node, Terraform, linters) are pinned in `mise.toml`. Next:
[Getting started](docs/getting-started.md).

## Host it

```sh
cp infra/docker/.env.example infra/docker/.env   # then edit it
docker compose -f infra/docker/docker-compose.yml up -d --build
docker compose -f infra/docker/docker-compose.yml exec analytics analytics sites add -domain example.com
```

Then add the script to your pages:

```html
<script defer src="https://analytics.example.com/api/script.js" data-site="SITE_ID"></script>
```

Guides: [Self-hosting](docs/guides/self-hosting.md) · [Deploying to Google Cloud](docs/guides/deploy-gcp.md) ·
[Tracking your site](docs/guides/tracking.md)

## Documentation

**Start at [docs/](docs/README.md)**, which has reading paths for users, operators and contributors.

| | |
|---|---|
| **Learn** | [Getting started](docs/getting-started.md) · [Concepts](docs/concepts.md) · [Architecture](ARCHITECTURE.md) |
| **Use** | [Tracking](docs/guides/tracking.md) · [Self-hosting](docs/guides/self-hosting.md) · [Google Cloud](docs/guides/deploy-gcp.md) · [Upgrading](docs/guides/upgrading.md) |
| **Reference** | [API](docs/reference/api.md) · [Configuration](docs/reference/configuration.md) · [CLI](docs/reference/cli.md) |
| **Operate** | [Runbook](docs/operations/runbook.md) · [Bots](docs/operations/bots.md) · [Privacy](docs/privacy.md) |
| **Contribute** | [CONTRIBUTING](CONTRIBUTING.md) · [Development guides](docs/README.md#development) · [Decisions](docs/decisions.md) · [Security](SECURITY.md) |

IP geolocation by [DB-IP](https://db-ip.com) (CC BY 4.0).

## License

[MIT](LICENSE)
