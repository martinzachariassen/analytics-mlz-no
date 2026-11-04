#!/bin/sh
# Runs the server. When LITESTREAM_REPLICA_URL is set (e.g. gs://bucket/analytics),
# the database is restored from the replica if missing and then continuously
# replicated while the server runs. Admin subcommands (e.g. `sites list`) run directly.
set -eu

if [ "$#" -eq 0 ] || [ "$1" = "serve" ]; then
  if [ -n "${LITESTREAM_REPLICA_URL:-}" ]; then
    exec litestream replicate -config /etc/litestream.yml -restore-if-db-not-exists -exec "analytics serve"
  fi
  exec analytics serve
fi

exec analytics "$@"
