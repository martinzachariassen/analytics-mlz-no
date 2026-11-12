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
- Deploy to Cloud Run with `make deploy` (the version is taken from `git describe`).
- The first push of the package to GHCR is private by default: set its visibility to public under
  the repository's Packages settings once.

## Repository settings (manual, once)

Settings that cannot live in code:

- Description and topics (`analytics`, `privacy`, `self-hosted`, `go`, `sqlite`, `react`).
- Branch protection on `main`: require a pull request and the CI jobs `lint`, `go`, `tracker`,
  `web`, `infra`, `docker`, `security` and `CodeQL / analyze` to pass; enforce for administrators.
- Enable private vulnerability reporting (Security → Advisories), which `SECURITY.md` points to.
- Enable Dependabot alerts and security updates. The update schedule is in `.github/dependabot.yml`.
- Code scanning uses the CodeQL workflow in the repo, not the default setup.
- Create labels `bug` and `enhancement` (used by the issue templates), and `good first issue`.

## Performance reference

`go run ./apps/server/cmd/loadtest` measures ingestion on a single instance. One run on an Apple M5 laptop
(server and load generator on the same machine, loopback, `PROXY_HOPS=1 -vary-ip`, 32 clients,
10 s): about 5,700 events/s, p99 latency about 10 ms. A Cloud Run instance with little CPU will be
lower, but this is far above what a personal site produces. Re-measure on your own hardware before
quoting numbers.
