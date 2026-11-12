#!/usr/bin/env bash
# The quality gate. CI and the Makefile run the same file, so "green locally" means "green in CI".
#
#   scripts/verify.sh            everything
#   scripts/verify.sh go web     only these groups: lint, go, tracker, web, e2e, infra
#
# Tools come from mise.toml (`mise install`); packages from `bun install`.
set -euo pipefail
cd "$(dirname "$0")/.."

groups=("$@")
if [ ${#groups[@]} -eq 0 ]; then
  groups=(lint go tracker web e2e infra)
fi

want() {
  local g
  for g in "${groups[@]}"; do
    [ "$g" = "$1" ] && return 0
  done
  return 1
}

step() { printf '\n==> %s\n' "$1"; }

if want lint; then
  step "Biome (format + lint) and gofmt"
  bun run --silent lint
fi

if want go; then
  step "Go: vet, race tests, golangci-lint"
  go vet ./apps/server/...
  go test -race ./apps/server/...
  (cd apps/server && golangci-lint run)
fi

if want tracker; then
  step "Tracker: types, tests, embedded script up to date, size budget"
  (cd apps/tracker && bun run --silent typecheck && bun run --silent test)
  # The committed script.js must be what the current source builds; rebuild and compare.
  script=apps/server/internal/script/script.js
  before="$(mktemp)"
  trap 'rm -f "$before"' EXIT
  cp "$script" "$before"
  (cd apps/tracker && bun run --silent build)
  if ! cmp -s "$before" "$script"; then
    echo "FAIL $script was stale and has been rebuilt: commit it" >&2
    exit 1
  fi
  (cd apps/tracker && bun run --silent check-size)
fi

if want web; then
  step "Dashboard: types, tests, production build"
  (cd apps/web && bun run --silent typecheck && bun run --silent test && bun run --silent build)
fi

if want e2e; then
  step "Dashboard end to end: Playwright + axe against the Go server with seeded data"
  # A no-op once the browser is cached; CI installs it with system dependencies first.
  prebuilt=""
  if want web; then prebuilt=1; fi
  (cd apps/web && bunx playwright install chromium >/dev/null && E2E_PREBUILT=$prebuilt bun run --silent e2e)
fi

if want infra; then
  step "Infra: Terraform fmt/validate, shellcheck, hadolint, actionlint"
  terraform fmt -check -recursive -diff infra/terraform
  for dir in infra/terraform/main infra/terraform/bootstrap; do
    (cd "$dir" && terraform init -backend=false -input=false -lockfile=readonly >/dev/null && terraform validate)
  done
  shellcheck infra/docker/*.sh scripts/*.sh .githooks/*
  hadolint --config .hadolint.yaml infra/docker/Dockerfile
  actionlint
fi

printf '\nok   all checks passed (%s)\n' "${groups[*]}"
