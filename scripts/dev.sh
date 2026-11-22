#!/usr/bin/env bash
# The local test environment in one command (`make dev`): builds the server once, seeds
# data/dev.db, starts the API, the dashboard dev server and the demo site with live visits,
# waits until all three answer, and prints what runs where. Ctrl+C stops everything.
#
# Runs on the bash 3.2 that macOS ships: no `wait -n`, no associative arrays.
set -euo pipefail
cd "$(dirname "$0")/.."

API_PORT=8080 WEB_PORT=5173 DEMO_PORT=8081
API_URL="http://127.0.0.1:$API_PORT"
WEB_URL="http://localhost:$WEB_PORT"
DEMO_URL="http://localhost:$DEMO_PORT"
BIN=data/bin/analytics

# The same settings as DEV_ENV in the Makefile. ADDR keeps the API on loopback only.
export DATABASE_PATH=data/dev.db PUBLIC_URL="$WEB_URL" DEV_LOGIN=1 GITHUB_CLIENT_ID='' GITHUB_CLIENT_SECRET=''
export ADDR="127.0.0.1:$API_PORT"

if [ -t 1 ]; then
  bold=$'\e[1m' dim=$'\e[2m' red=$'\e[31m' reset=$'\e[0m'
  colours=($'\e[36m' $'\e[35m' $'\e[33m')
else
  bold='' dim='' red='' reset=''
  colours=('' '' '')
fi

say() { printf '%sdev%s  %s\n' "$dim" "$reset" "$*"; }
die() {
  printf '%sdev  %s%s\n' "$red" "$*" "$reset" >&2
  exit 1
}

# ---------------------------------------------------------------- preflight

for tool in go bun curl; do
  command -v "$tool" >/dev/null || die "$tool not found. Run \`mise install\` (versions are pinned in mise.toml)."
done
if [ ! -d node_modules ]; then
  say "installing JavaScript packages (bun install)"
  bun install --frozen-lockfile
fi

listening() {
  (: </dev/tcp/127.0.0.1/"$1") 2>/dev/null || (: </dev/tcp/::1/"$1") 2>/dev/null
}
for port in "$API_PORT" "$WEB_PORT" "$DEMO_PORT"; do
  if listening "$port"; then
    holder=""
    if command -v lsof >/dev/null; then
      # lsof exits 1 when it finds nothing, which is not an error here.
      holder=$({ lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || :; } | awk 'NR > 1 {print "     " $1 " (pid " $2 ")"}' | sort -u)
    fi
    die "port $port is already in use${holder:+ by:
$holder}
     make dev needs $API_PORT (API), $WEB_PORT (dashboard) and $DEMO_PORT (demo site). Stop what holds it, or an earlier make dev."
  fi
done

# ---------------------------------------------------------------- build and seed

say "building the server ($BIN)"
mkdir -p "$(dirname "$BIN")"
go build -o "$BIN" ./apps/server/cmd/analytics
version=$("$BIN" version)

say "seeding $DATABASE_PATH"
"$BIN" seed | sed "s/^/     /"

# ---------------------------------------------------------------- start

names=(api web live)
pids=()

prefix() {
  local line
  while IFS= read -r line; do
    printf '%s%-4s│%s %s\n' "$2" "$1" "$reset" "$line"
  done
}

cleanup() {
  trap - EXIT INT TERM
  local pid
  for pid in ${pids[@]+"${pids[@]}"}; do
    kill -TERM -- "-$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  say "stopped"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Each process gets its own process group, so cleanup also reaches what it spawns (bun → vite).
set -m
"$BIN" serve </dev/null > >(prefix api "${colours[0]}") 2>&1 &
pids+=($!)
(cd apps/web && exec bun run dev) </dev/null > >(prefix web "${colours[1]}") 2>&1 &
pids+=($!)
"$BIN" seed -live -demo "127.0.0.1:$DEMO_PORT" </dev/null > >(prefix live "${colours[2]}") 2>&1 &
pids+=($!)
set +m

check_alive() {
  local i
  for i in 0 1 2; do
    kill -0 "${pids[$i]}" 2>/dev/null || die "${names[$i]} exited; its output is above."
  done
}

wait_for() {
  local url=$1 tries=0
  until curl -fsS -o /dev/null "$url" 2>/dev/null; do
    check_alive
    tries=$((tries + 1))
    [ "$tries" -le 120 ] || die "$url did not answer within 60 seconds."
    sleep 0.5
  done
}
wait_for "$API_URL/healthz"
wait_for "$WEB_URL"
wait_for "http://127.0.0.1:$DEMO_PORT"

# ---------------------------------------------------------------- overview

line="────────────────────────────────────────────────────────────────────────────────"
row() { printf '  %s%-10s%s %-38s %s\n' "$bold" "$1" "$reset" "$2" "$3"; }
{
  printf '\n%s── mlz analytics · local development %s%s\n' "$bold" "${line:0:42}" "$reset"
  row Dashboard "$WEB_URL" "Vite dev server, /api proxied to $API_URL   pid ${pids[1]}"
  row API "$API_URL" "$version, health $API_URL/healthz   pid ${pids[0]}"
  row Tracker "$API_URL/api/script.js" ""
  row "Demo site" "$DEMO_URL" "real events to Fjord Labs Blog (demo), plus live visits   pid ${pids[2]}"
  row Database "$DATABASE_PATH" "SQLite, $(du -h "$DATABASE_PATH" | cut -f1 | tr -d ' ')"
  row Sign-in "one click, as \"dev\"" "DEV_LOGIN=1, loopback only"
  row Binds "$ADDR (API), 127.0.0.1:$DEMO_PORT (demo)" "localhost:$WEB_PORT (Vite); nothing is reachable from the network"
  printf '  %sSites%s\n' "$bold" "$reset"
  "$BIN" sites list | sed "s/^/             /"
  row Logs "below, prefixed api, web, live" ""
  row Stop "Ctrl+C" "fresh data: make dev-reset, feature tour: docs/development/seed-data.md"
  printf '%s%s%s\n\n' "$bold" "${line:0:80}" "$reset"
}

while :; do
  check_alive
  sleep 1
done
