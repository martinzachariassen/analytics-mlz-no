# Releasing

Releases are cut by pushing a version tag. The pipeline in `.github/workflows/release.yml` does the rest.

## Pre-release checklist

Code and docs are ready; these steps need real infrastructure and are not automated.

- [ ] **Production domain** chosen and DNS pointed at Firebase Hosting ([DEPLOY.md](DEPLOY.md)).
- [ ] **`PROXY_HOPS` verified** on Cloud Run behind Firebase Hosting. Log `X-Forwarded-For` for a
      request, count the proxies, and confirm the stored country and visitor hash match your own
      IP. A wrong value breaks rate limiting and visitor counting.
- [ ] **End-to-end smoke test in production:** GitHub sign-in works, the tracking script on a real
      page produces an event in the dashboard, and the Litestream restore log line appears after a
      redeploy.
- [ ] `infra/docker/test-restore.sh` passes against the image you are about to release.
- [ ] `CHANGELOG.md`: move "Unreleased" under the new version heading with today's date.
- [ ] `main` is green in CI.

### Known gap: dashboard for self-hosters

The Docker image contains the API only. The dashboard (`apps/web/`) is deployed to Firebase Hosting and
reaches the API through a same-origin rewrite. Someone running `docker compose` therefore has a
working collector but no dashboard unless they serve `apps/web/dist` themselves behind the same
origin. Decide before 1.0 whether to embed `apps/web/dist` in the Go binary (simplest for
self-hosting) or document a reverse-proxy recipe.

## Cutting a release

```sh
git checkout main && git pull
git tag v0.1.0            # pre-release: v0.1.0-rc.1
git push origin v0.1.0
```

The workflow then:

1. runs the full CI workflow as a gate,
2. builds and pushes `ghcr.io/martinzachariassen/analytics-mlz-no` for linux/amd64 and
   linux/arm64, tagged `0.1.0`, `0.1` and `latest` (pre-releases get only their own tag),
3. cross-compiles static binaries for Linux and macOS (amd64, arm64) with `checksums.txt`,
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
- Branch protection on `main`: require a pull request and the CI jobs `go`, `docker`, `tracker`,
  `web` and `security` to pass.
- Enable private vulnerability reporting (Security → Advisories), which `SECURITY.md` points to.
- Enable Dependabot alerts. The update schedule is in `.github/dependabot.yml`.
- Create labels `bug` and `enhancement` (used by the issue templates), and `good first issue`.

## Performance reference

`go run ./apps/server/cmd/loadtest` measures ingestion on a single instance. One run on an Apple M5 laptop
(server and load generator on the same machine, loopback, `PROXY_HOPS=1 -vary-ip`, 32 clients,
10 s): about 5,700 events/s, p99 latency about 10 ms. A Cloud Run instance with little CPU will be
lower, but this is far above what a personal site produces. Re-measure on your own hardware before
quoting numbers.
