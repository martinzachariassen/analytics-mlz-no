# Upgrading

## Before you upgrade

1. Read [CHANGELOG.md](../CHANGELOG.md) for the versions you skip. Before 1.0, minor versions
   (0.x) may contain breaking changes.
2. **Take a backup.** Migrations only move forward.
   - With Litestream, the replica already is a backup; confirm it is recent.
   - Otherwise copy the SQLite file while the server is stopped, or use
     `sqlite3 analytics.db ".backup backup.db"`. Copying the file of a running server can give an
     inconsistent copy because of WAL mode.

## Docker

```sh
# Pin a version rather than "latest" in production.
export ANALYTICS_IMAGE=ghcr.io/martinzachariassen/analytics-mlz-no:0.2.0
docker compose -f infra/docker/docker-compose.yml pull
docker compose -f infra/docker/docker-compose.yml up -d --no-build
docker compose -f infra/docker/docker-compose.yml exec analytics analytics version
```

## Binary

Download the archive for your platform from the GitHub release, verify it against
`checksums.txt` (`sha256sum -c`), replace the old binary and restart.

## What happens on start

New migrations in `apps/server/internal/store/migrations/` are applied automatically, in order,
before the server starts listening. An applied migration is never edited, so a database is always
upgradable from any earlier release.

## Rolling back

Old binaries do not understand a database that a newer version has migrated. To roll back:

1. Stop the server.
2. Restore the backup from before the upgrade (`litestream restore -o analytics.db <replica-url>`
   with a timestamp, or copy your file back).
3. Start the older image or binary.

Events collected after the backup are lost.

## Cloud Run

Cloud Run runs the old and new revision side by side for a moment. The new one restores from the
replica while the old one still serves, so events from those seconds can be lost. Deploy when
traffic is quiet. See [DEPLOY.md](DEPLOY.md).
