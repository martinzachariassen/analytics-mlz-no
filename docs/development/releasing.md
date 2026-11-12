# Releasing

> **TL;DR** — Move the "Unreleased" changelog entries under a new version, then push a tag
> `vX.Y.Z`. `.github/workflows/release.yml` builds the multi-arch image for GHCR and the static
> binaries, and creates the GitHub release.

**Read this if:** you maintain the project and are about to publish a version.

Releases are cut by pushing a version tag. The pipeline in `.github/workflows/release.yml` does the rest.

## Pre-release checklist

Code and docs are ready; these steps need real infrastructure and are not automated.

- [x] **Production domain** chosen and DNS pointed at Firebase Hosting ([deploy-gcp.md](../guides/deploy-gcp.md)):
      `analytics.mlz.no` and `t.mlz.no`.
- [x] **`PROXY_HOPS` verified** on Cloud Run behind Firebase Hosting (`2`). Log `X-Forwarded-For`
      for a request, count the proxies, and confirm the stored country and visitor hash match your
      own IP. A wrong value breaks rate limiting and visitor counting.
- [ ] **End-to-end smoke test in production:** GitHub sign-in works, the tracking script on a real
      page produces an event in the dashboard, and the Litestream restore log line appears after a
      redeploy.
- [ ] `infra/docker/test-restore.sh` and `infra/docker/test-backup.sh` pass against the image you
      are about to release (CI runs both on every push).
- [ ] `CHANGELOG.md`: move "Unreleased" under the new version heading with today's date.
- [ ] `main` is green in CI.

Before 1.0, also settle the items in [decisions.md](../decisions.md#before-10), starting with the
dashboard for self-hosters.

## Cutting a release

Releases follow [Semantic Versioning](https://semver.org/). `CHANGELOG.md` is the source: move
"Unreleased" under the new version heading with today's date, add the compare link, commit as
`release: vX.Y.Z` on a `release/vX.Y.Z` branch and merge it through a pull request. Then tag the
merge commit with an annotated tag:

```sh
git checkout main && git pull
git tag -a v0.1.0 -m "v0.1.0"   # pre-release: v0.1.0-rc.1
git push origin v0.1.0
```

The workflow then:

1. runs the full CI workflow as a gate,
2. builds and pushes `ghcr.io/martinzachariassen/analytics-mlz-no` for linux/amd64 and
   linux/arm64, tagged `0.1.0`, `0.1` and `latest` (pre-releases get only their own tag), with an
   SBOM and a signed build provenance attestation; the GeoIP month is pinned to the release month,
3. cross-compiles static binaries for Linux and macOS (amd64, arm64) with `checksums.txt` and a
   provenance attestation (`gh attestation verify <file> --owner martinzachariassen`),
4. creates the GitHub release with generated notes. A tag containing `-` is marked as a pre-release.

Edit the generated notes afterwards if needed, copying the relevant part of the changelog.

## After the release

- `docker run --rm ghcr.io/martinzachariassen/analytics-mlz-no:0.1.0 version` prints the tag.
- Production already runs the tagged commit: the Deploy workflow deployed it when it merged to
  `main` (the version is `git describe`, so it shows the tag from the next deploy on). Without
  the workflow, deploy with `make deploy`.
- The first push of the package to GHCR is private by default: set its visibility to public under
  the repository's Packages settings once.

## Repository settings

[`scripts/github-settings.sh`](../../scripts/github-settings.sh) applies the GitHub settings
that cannot live in a workflow file, through the API, and is safe to run again. Run it as a
repository admin after changing it; `scripts/github-settings.sh --check` only compares and exits
with `1` on drift.

| Area | Setting |
|---|---|
| Merging | Squash only, with the pull request title as the commit title (so the title must be a Conventional Commit) and the branch's commit messages as the body. Branches are deleted after merge; "Update branch" and auto-merge are on. Wiki and Projects are off: the docs live in `docs/`. |
| `main` ruleset | No direct pushes, force pushes or deletion; a pull request with every review thread resolved; linear history; signed commits (GitHub signs squash merges made on github.com); and these checks passing on a branch that is up to date with `main`: `Lint`, `Go tests`, `Docs links`, `Tracker`, `Dashboard`, `Dashboard end-to-end`, `Infra lint`, `Docker image`, `Dependency audit`, `CodeQL (go)`, `CodeQL (javascript-typescript)`, `CodeQL (actions)`. Repository admins can bypass it for an emergency fix or a stuck check; everyone else, Dependabot included, cannot. The checks are the jobs' `name:` in `ci.yml` and `codeql.yml`: a new or renamed job that runs on pull requests goes in the script's `checks` list too, because a required check that never runs blocks every pull request. |
| `release tags` ruleset | Only admins create, move or delete `v*` tags. |
| `production` environment | The Deploy workflow's environment; only `main` may deploy to it. GCP trusts only tokens from this environment ([deploy guide](../guides/deploy-gcp.md#deploy-on-merge-to-main-github-actions)). The `GCP_*` and `TRACKER_ORIGIN` repository variables are not in the script; they come from `terraform output github_deploy_variables`. |
| Security | Dependabot alerts and security updates (the schedule is in `.github/dependabot.yml`), private vulnerability reporting (which `SECURITY.md` points to), secret scanning with push protection. Generic-pattern detection and validity checks need GitHub Secret Protection, which this repository does not have, so the API ignores them. |
| Actions | Every action must be pinned to a full commit SHA; `GITHUB_TOKEN` is read-only by default and cannot approve pull requests. |
| Description and topics | Topics `analytics`, `web-analytics`, `privacy`, `cookie-free`, `self-hosted`, `go`, `sqlite`, `react`. |

Also in the repository, not in the script: `.github/CODEOWNERS` (every pull request asks
@martinzachariassen for review), code scanning through the CodeQL workflow rather than the
default setup, and the [OpenSSF Scorecard](https://scorecard.dev) workflow
(`.github/workflows/scorecard.yml`), which grades these settings weekly and on every push to
`main`. The labels `bug`, `enhancement` and `good first issue` that the issue templates use
exist already.

Still manual: the GHCR package's visibility after the first release (see above).

## Performance reference

`go run ./apps/server/cmd/loadtest` measures ingestion on a single instance. One run on an Apple M5 laptop
(server and load generator on the same machine, loopback, `PROXY_HOPS=1 -vary-ip`, 32 clients,
10 s): about 5,700 events/s, p99 latency about 10 ms. A Cloud Run instance with little CPU will be
lower, but this is far above what a personal site produces. Re-measure on your own hardware before
quoting numbers.
