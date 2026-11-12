# Documentation

> **TL;DR** — analytics-mlz-no is a small, self-hostable, cookie-free web analytics service.
> A ~1 KB script on your site sends page views and events to a Go server, which stores them in
> SQLite without IP addresses. A React dashboard shows the numbers. Try everything locally with
> `make dev`.

## Start here: pick your path

| I want to… | Read, in order | Time |
|---|---|---|
| **Understand what this is** | [README](../README.md) → [concepts](concepts.md) | 10 min |
| **Track my website** | [Tracking your site](guides/tracking.md) | 5 min |
| **Host it myself** | [Self-hosting](guides/self-hosting.md) or [Deploy to Google Cloud](guides/deploy-gcp.md) → [Runbook](operations/runbook.md) | 1 h |
| **Take over and operate it** | [Getting started](getting-started.md) → [Concepts](concepts.md) → [Architecture](../ARCHITECTURE.md) → [Runbook](operations/runbook.md) → [Reference](#reference) | 1 day |
| **Change the code** | [Getting started](getting-started.md) → [Architecture](../ARCHITECTURE.md) → [Development](#development) → [CONTRIBUTING](../CONTRIBUTING.md) | 2 h |

## All pages

### Learn
- [Getting started](getting-started.md): run everything locally and take a tour, in 10 minutes
- [Concepts](concepts.md): how it works, and what visitor, visit, bounce rate and the daily salt mean
- [Architecture](../ARCHITECTURE.md): code map, invariants and the path of an event through the system

### Guides
- [Tracking your site](guides/tracking.md): the script tag, custom events, options, CSP
- [Self-hosting](guides/self-hosting.md): Docker or binary, GitHub sign-in, reverse proxy, backups
- [Deploying to Google Cloud](guides/deploy-gcp.md): Terraform, Cloud Run, Firebase Hosting
- [Upgrading and rolling back](guides/upgrading.md)

### Reference
- [HTTP API](reference/api.md): event collection, auth, sites, stats, breakdowns
- [Configuration](reference/configuration.md): every environment and Terraform variable
- [CLI](reference/cli.md): `analytics serve`, `sites`, `events purge`, `seed`, `version`

### Operations
- [Runbook](operations/runbook.md): health checks, logs, alerts, and playbooks for incidents
- [Bots, scanners and robots](operations/bots.md): what is filtered and what is not

### Development
- [Backend (Go)](development/backend.md)
- [Dashboard (React)](development/dashboard.md)
- [Tracking script (TypeScript)](development/tracker.md)
- [Releasing](development/releasing.md)

### Background
- [Privacy](privacy.md): exactly what is stored, and what never is
- [Decisions](decisions.md): architectural decisions, open items and the roadmap
- [Changelog](../CHANGELOG.md) · [Contributing](../CONTRIBUTING.md) · [Security policy](../SECURITY.md)

## How these docs are written

Every page starts with a **TL;DR**, then the basics, then details. Advanced material is folded
into collapsible sections. Code paths such as `apps/server/internal/ingest` are named so you can
check every statement against the code. If you change behaviour, update the page that describes it
(see [CONTRIBUTING](../CONTRIBUTING.md#documentation)). CI checks that every relative link and
anchor resolves, and Go tests check that every environment variable and API dimension is
documented.
