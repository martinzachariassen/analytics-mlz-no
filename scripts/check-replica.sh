#!/usr/bin/env bash
# Checks that the Litestream replica's LTX files form one unbroken chain of transaction ids on
# every compaction level (0-3). Read-only: it lists files and never changes the replica.
#
#   scripts/check-replica.sh gs://<project_id>-db/analytics
#   scripts/check-replica.sh ./replica-copy       # a local copy, e.g. from `gcloud storage cp -r`
#
# Two instances replicating at the same time (Cloud Run can briefly run more than
# max_instance_count) write the same transaction ids twice, so a level gets overlapping files.
# Litestream then logs "compaction failed ... non-contiguous transaction ids" on every
# compaction of the next level. See docs/operations/runbook.md, "Litestream compaction fails".
#
# Exit status: 0 when every level is contiguous, 1 when it found an overlap or a gap.
set -euo pipefail

src=${1:-${LITESTREAM_REPLICA_URL:-}}
if [ -z "$src" ]; then
  echo "usage: $0 gs://bucket/path | <local directory>" >&2
  exit 2
fi
src=${src%/}

list() {
  if [[ $src == gs://* ]]; then
    gcloud storage ls "$src/ltx/$1/" 2>/dev/null | sed 's#.*/##' || true
  elif [ -d "$src/ltx/$1" ]; then
    ls "$src/ltx/$1"
  fi
}

problems=0
drop=()
for level in 0 1 2 3; do
  prev=""
  # Ids are fixed-width hex, so a plain sort orders files by (min, max).
  while read -r file; do
    [[ $file =~ ^([0-9a-f]{16})-([0-9a-f]{16})\.ltx$ ]] || continue
    min=$((16#${BASH_REMATCH[1]}))
    max=$((16#${BASH_REMATCH[2]}))
    if [ -n "$prev" ] && [ "$min" -le "$prev" ]; then
      echo "L$level: overlap: $file starts at or before $(printf '%016x' "$prev"), the end of the chain so far"
      drop+=("ltx/$level/$file")
      problems=1
      continue
    fi
    if [ -n "$prev" ] && [ "$min" -gt $((prev + 1)) ]; then
      echo "L$level: gap: nothing between $(printf '%016x' "$prev") and $file"
      problems=1
    fi
    prev=$max
  done < <(list "$level" | sort)
done

if [ "$problems" -eq 0 ]; then
  echo "ok: every level is contiguous"
  exit 0
fi

if [ "${#drop[@]}" -gt 0 ]; then
  echo
  echo "Dropping these files would leave one chain per level (check for a gap above first, and"
  echo "follow the runbook before deleting anything):"
  for f in "${drop[@]}"; do
    echo "  $src/$f"
  done
fi
exit 1
