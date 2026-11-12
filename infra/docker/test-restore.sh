#!/usr/bin/env bash
# Verifies that backups work: writes events, replicates them with Litestream to a local volume,
# throws the database away and checks that the next start restores every event.
#
#   make docker && infra/docker/test-restore.sh            # uses analytics-mlz-no:local
#   IMAGE=ghcr.io/martinzachariassen/analytics-mlz-no:0.1.0 infra/docker/test-restore.sh
#
# Needs docker, curl and sqlite3. Uses temporary docker volumes (not bind mounts: SQLite's WAL
# does not work on every host file sharing layer) and removes everything when it exits.
set -euo pipefail

IMAGE=${IMAGE:-analytics-mlz-no:local}
PORT=${PORT:-18080}
EVENTS=${EVENTS:-20}
name=analytics-restore-test
data=$name-data
replica=$name-replica
work=$(mktemp -d)
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$data" "$replica" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
cleanup_start() { docker rm -f "$name" >/dev/null 2>&1 || true; }

docker volume create "$data" >/dev/null
docker volume create "$replica" >/dev/null
# The replica folder must be writable by the unprivileged user the image runs as.
docker run --rm --user root -v "$replica:/replica" --entrypoint chown "$IMAGE" 10001 /replica

start() {
  cleanup_start
  docker run -d --name "$name" -p "127.0.0.1:$PORT:8080" \
    -v "$data:/data" -v "$replica:/replica" \
    -e LITESTREAM_REPLICA_URL=file:///replica "$@" "$IMAGE" >/dev/null
  for _ in $(seq 1 50); do
    curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && return 0
    sleep 0.2
  done
  echo "server did not become healthy" >&2
  docker logs "$name" >&2
  exit 1
}

# Number of events in the stopped container's database.
count() {
  rm -rf "$work/db" && mkdir "$work/db"
  docker cp "$name:/data/." "$work/db" >/dev/null
  sqlite3 "$work/db/analytics.db" 'SELECT count(*) FROM events'
}

echo "==> REQUIRE_REPLICA=1 with an empty replica must refuse to start"
cleanup_start
if docker run --rm -v "$data:/data" -v "$replica:/replica" \
    -e LITESTREAM_REPLICA_URL=file:///replica -e REQUIRE_REPLICA=1 "$IMAGE" >/dev/null 2>&1; then
  echo "FAIL: the server started with an empty replica and REQUIRE_REPLICA=1" >&2
  exit 1
fi

echo "==> first start (empty database)"
start
# The "Litestream reported a problem" alert (infra/terraform/main/monitoring.tf) matches these
# phrases. If a Litestream upgrade rewords them, fail here instead of going silently unalerted.
alert_pattern='no backup found, starting fresh|no matching backup|restore failed|level=ERROR'
if ! docker logs "$name" 2>&1 | grep -Eq "$alert_pattern"; then
  echo "FAIL: an empty start no longer logs a line the Litestream alert matches" >&2
  docker logs "$name" >&2
  exit 1
fi
site=$(docker exec "$name" analytics sites add -domain example.com | sed -n 's/^Site ID: //p')
echo "    site id: $site"

echo "==> sending $EVENTS events"
for i in $(seq 1 "$EVENTS"); do
  curl -fsS -A "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0" -H "Origin: https://example.com" \
    --data "{\"site\":\"$site\",\"url\":\"https://example.com/page-$i\"}" \
    "http://127.0.0.1:$PORT/api/event" >/dev/null
done

echo "==> waiting for Litestream to sync, then stopping the server"
sleep 4
docker stop -t 10 "$name" >/dev/null
before=$(count)
echo "    events before: $before"

echo "==> deleting the database and starting again with REQUIRE_REPLICA=1 (should restore from the replica)"
docker run --rm --user root -v "$data:/data" --entrypoint sh "$IMAGE" -c 'rm -f /data/analytics.db*'
start -e REQUIRE_REPLICA=1
docker stop -t 10 "$name" >/dev/null
after=$(count)
echo "    events after:  $after"

echo "==> a database newer than the replica is kept (not overwritten by the restore)"
start
curl -fsS -A "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0" -H "Origin: https://example.com" \
  --data "{\"site\":\"$site\",\"url\":\"https://example.com/extra\"}" \
  "http://127.0.0.1:$PORT/api/event" >/dev/null
sleep 4
docker stop -t 10 "$name" >/dev/null
start
docker stop -t 10 "$name" >/dev/null
extra=$(count)
if [ "$extra" -ne $((EVENTS + 1)) ]; then
  echo "FAIL: expected $((EVENTS + 1)) events after a restart with an existing database, got $extra" >&2
  exit 1
fi

if [ "$before" -ne "$EVENTS" ] || [ "$after" -ne "$before" ]; then
  echo "FAIL: expected $EVENTS events before and after, got $before and $after" >&2
  exit 1
fi
echo "OK: all $after events were restored from the replica"
