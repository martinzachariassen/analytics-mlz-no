#!/bin/sh
# Runs the server. When LITESTREAM_REPLICA_URL is set (e.g. gs://bucket/analytics), the database
# is restored from the replica if missing and then continuously replicated while the server runs.
# With REQUIRE_REPLICA=1 a missing database AND an empty replica is an error instead of a fresh
# start: a production instance must never quietly begin with no data. Admin subcommands
# (e.g. `sites list`) run directly, with any further arguments.
set -eu

if [ "$#" -eq 0 ] || [ "$1" = "serve" ]; then
  if [ -n "${LITESTREAM_REPLICA_URL:-}" ]; then
    if [ "${REQUIRE_REPLICA:-0}" = "1" ] && [ ! -f "$DATABASE_PATH" ]; then
      # Fails when the replica has no backup; litestream prints why.
      litestream restore -o "$DATABASE_PATH" "$LITESTREAM_REPLICA_URL"
    fi
    exec litestream replicate -config /etc/litestream.yml -restore-if-db-not-exists -exec "analytics serve"
  fi
  exec analytics serve
fi

exec analytics "$@"
