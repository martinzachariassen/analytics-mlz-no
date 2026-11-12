#!/bin/sh
# Writes a standalone, gzipped copy of the database to a separate bucket.
#
#   backup.sh [prefix]     prefix is a folder in the bucket (default: hourly)
#
# It restores the latest state from the Litestream replica (LITESTREAM_REPLICA_URL), so it never
# touches the running server or its database. This is a second line of defence: if the replica
# itself were damaged or deleted, these files still restore with a plain `gunzip`.
#
# Uploads to BACKUP_BUCKET with the service account of the Cloud Run Job (metadata server).
# For tests, set BACKUP_DEST_DIR to write to a local folder instead.
#
# An empty replica normally means "nothing to back up yet" and exits 0. With
# BACKUP_EXPECT_DATA=1 it is an error: once a service has data, an empty replica means it was
# lost, and a backup run that succeeds anyway would hide that.
set -eu

prefix=${1:-hourly}
: "${LITESTREAM_REPLICA_URL:?LITESTREAM_REPLICA_URL is required}"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Exits 0 without writing a file when the replica has no backups yet.
litestream restore -if-replica-exists -o "$tmp/analytics.db" "$LITESTREAM_REPLICA_URL"
if [ ! -s "$tmp/analytics.db" ]; then
  if [ "${BACKUP_EXPECT_DATA:-0}" = "1" ]; then
    echo "backup: the replica is empty but BACKUP_EXPECT_DATA=1; the database may have been lost" >&2
    exit 1
  fi
  echo "backup: no data in the replica yet, nothing to back up"
  exit 0
fi

# A restored file that is not a SQLite database must never replace a good backup.
if [ "$(head -c 15 "$tmp/analytics.db")" != "SQLite format 3" ]; then
  echo "backup: restored file is not a SQLite database" >&2
  exit 1
fi

# Seconds plus the Cloud Run execution id keep retries from colliding with a partial earlier
# upload: the job may only create objects, never overwrite them.
name="$prefix/$(date -u +%Y-%m-%dT%H%M%SZ)${CLOUD_RUN_EXECUTION:+-${CLOUD_RUN_EXECUTION##*-}}.db.gz"
gzip -c "$tmp/analytics.db" > "$tmp/backup.db.gz"
size=$(wc -c < "$tmp/backup.db.gz")

if [ -n "${BACKUP_DEST_DIR:-}" ]; then
  mkdir -p "$BACKUP_DEST_DIR/$prefix"
  cp "$tmp/backup.db.gz" "$BACKUP_DEST_DIR/$name"
else
  : "${BACKUP_BUCKET:?BACKUP_BUCKET is required}"
  token=$(curl -fsS --retry 3 --retry-all-errors -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" |
    sed -n 's/.*"access_token" *: *"\([^"]*\)".*/\1/p')
  if [ -z "$token" ]; then
    echo "backup: could not get an access token" >&2
    exit 1
  fi
  encoded=$(printf '%s' "$name" | sed 's#/#%2F#g')
  curl -fsS --retry 3 --retry-all-errors -X POST \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/gzip" \
    --data-binary "@$tmp/backup.db.gz" \
    "https://storage.googleapis.com/upload/storage/v1/b/$BACKUP_BUCKET/o?uploadType=media&name=$encoded" >/dev/null
fi

echo "backup: wrote $name ($size bytes)"
