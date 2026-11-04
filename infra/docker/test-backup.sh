#!/usr/bin/env bash
# Verifies the standalone backup (backup.sh): writes events, replicates them with Litestream to a
# local volume, runs the backup script against that replica and checks that the gzipped file it
# produces is a SQLite database with every event.
#
#   make docker && infra/docker/test-backup.sh
#
# Needs docker, curl, gunzip and sqlite3. Temporary docker volumes are removed on exit.
set -euo pipefail

IMAGE=${IMAGE:-analytics-mlz-no:local}
PORT=${PORT:-18081}
EVENTS=${EVENTS:-20}
name=analytics-backup-test
data=$name-data
replica=$name-replica
out=$name-out
work=$(mktemp -d)
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$data" "$replica" "$out" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

docker volume create "$data" >/dev/null
docker volume create "$replica" >/dev/null
docker volume create "$out" >/dev/null
docker run --rm --user root -v "$replica:/replica" -v "$out:/out" --entrypoint chown "$IMAGE" 10001 /replica /out

run_backup() {
  docker run --rm -v "$replica:/replica" -v "$out:/out" \
    -e LITESTREAM_REPLICA_URL=file:///replica -e BACKUP_DEST_DIR=/out \
    --entrypoint /usr/local/bin/backup.sh "$IMAGE" "$@"
}

echo "==> backup of an empty replica must succeed without writing a file"
run_backup hourly
if [ -n "$(docker run --rm -v "$out:/out" --entrypoint sh "$IMAGE" -c 'ls -A /out')" ]; then
  echo "FAIL: a file was written for an empty replica" >&2
  exit 1
fi

echo "==> with BACKUP_EXPECT_DATA=1 an empty replica must fail"
if docker run --rm -v "$replica:/replica" -v "$out:/out" \
    -e LITESTREAM_REPLICA_URL=file:///replica -e BACKUP_DEST_DIR=/out -e BACKUP_EXPECT_DATA=1 \
    --entrypoint /usr/local/bin/backup.sh "$IMAGE" hourly >/dev/null 2>&1; then
  echo "FAIL: backup.sh succeeded on an empty replica with BACKUP_EXPECT_DATA=1" >&2
  exit 1
fi

echo "==> starting the server and sending $EVENTS events"
docker run -d --name "$name" -p "127.0.0.1:$PORT:8080" \
  -v "$data:/data" -v "$replica:/replica" \
  -e LITESTREAM_REPLICA_URL=file:///replica "$IMAGE" >/dev/null
up=0
for _ in $(seq 1 100); do
  curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && up=1 && break
  sleep 0.2
done
if [ "$up" != 1 ]; then
  echo "FAIL: server did not become healthy" >&2
  docker logs "$name" >&2
  exit 1
fi
site=$(docker exec "$name" analytics sites add -domain example.com | sed -n 's/^Site ID: //p')
for i in $(seq 1 "$EVENTS"); do
  curl -fsS -A "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0" -H "Origin: https://example.com" \
    --data "{\"site\":\"$site\",\"url\":\"https://example.com/page-$i\"}" \
    "http://127.0.0.1:$PORT/api/event" >/dev/null
done
sleep 2
docker stop -t 10 "$name" >/dev/null

echo "==> running backup.sh (BACKUP_EXPECT_DATA=1 passes now that there is data)"
run_backup hourly
docker run --rm -v "$replica:/replica" -v "$out:/out" \
  -e LITESTREAM_REPLICA_URL=file:///replica -e BACKUP_DEST_DIR=/out -e BACKUP_EXPECT_DATA=1 \
  -e CLOUD_RUN_EXECUTION=analytics-backup-abc12 \
  --entrypoint /usr/local/bin/backup.sh "$IMAGE" daily
if ! docker run --rm -v "$out:/out" --entrypoint sh "$IMAGE" -c 'ls /out/daily/*-abc12.db.gz' >/dev/null; then
  echo "FAIL: the execution id is not part of the file name" >&2
  exit 1
fi

for prefix in hourly daily; do
  file=$(docker run --rm -v "$out:/out" --entrypoint sh "$IMAGE" -c "ls /out/$prefix/*.db.gz")
  rm -rf "$work/o" && mkdir "$work/o"
  docker run --rm -v "$out:/out" --entrypoint cat "$IMAGE" "$file" | gunzip > "$work/o/$prefix.db"
  count=$(sqlite3 "$work/o/$prefix.db" 'SELECT count(*) FROM events')
  echo "    $prefix: $file has $count events"
  if [ "$count" -ne "$EVENTS" ]; then
    echo "FAIL: expected $EVENTS events in the $prefix backup, got $count" >&2
    exit 1
  fi
done
echo "OK: both backups are valid SQLite databases with all $EVENTS events"
