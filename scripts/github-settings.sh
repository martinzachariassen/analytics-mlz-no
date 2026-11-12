#!/usr/bin/env bash
# Repository settings that cannot live in a workflow file, applied through the GitHub API.
# Idempotent: run it again after changing this file.
#
#   scripts/github-settings.sh           apply
#   scripts/github-settings.sh --check   only compare; exit 1 on drift
#
# Needs `gh` signed in as a repository admin. See docs/development/releasing.md.
set -euo pipefail

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
mode=${1:-apply}

# Every job that runs on pull requests (ci.yml and codeql.yml). A required check that does not
# run on a pull request blocks it forever, so keep this in step with the workflows.
checks=(lint go docs tracker web e2e infra docker security
  "analyze (go, manual)" "analyze (javascript-typescript, none)" "analyze (actions, none)")
actions_app=15368 # GitHub Actions

topics='["analytics","web-analytics","privacy","cookie-free","self-hosted","go","sqlite","react"]'

repo_settings='{
  "has_wiki": false,
  "has_projects": false,
  "allow_merge_commit": false,
  "allow_rebase_merge": false,
  "allow_squash_merge": true,
  "squash_merge_commit_title": "PR_TITLE",
  "squash_merge_commit_message": "COMMIT_MESSAGES",
  "delete_branch_on_merge": true,
  "allow_update_branch": true,
  "allow_auto_merge": true,
  "security_and_analysis": {
    "secret_scanning": {"status": "enabled"},
    "secret_scanning_push_protection": {"status": "enabled"}
  }
}'

# main: pull request, linear history, resolved threads, signed commits and every check passing
# on an up-to-date branch. No bypass, administrators included.
main_ruleset=$(jq -n --argjson app "$actions_app" --args '{
  name: "main",
  target: "branch",
  enforcement: "active",
  bypass_actors: [],
  conditions: {ref_name: {include: ["~DEFAULT_BRANCH"], exclude: []}},
  rules: [
    {type: "deletion"},
    {type: "non_fast_forward"},
    {type: "required_linear_history"},
    {type: "required_signatures"},
    {type: "pull_request", parameters: {
      allowed_merge_methods: ["squash"],
      required_approving_review_count: 0,
      dismiss_stale_reviews_on_push: true,
      require_code_owner_review: false,
      require_last_push_approval: false,
      required_review_thread_resolution: true
    }},
    {type: "required_status_checks", parameters: {
      strict_required_status_checks_policy: true,
      do_not_enforce_on_create: false,
      required_status_checks: [$ARGS.positional[] | {context: ., integration_id: $app}]
    }}
  ]
}' "${checks[@]}")

# Release tags: only administrators create them, and nobody moves or deletes them.
tag_ruleset='{
  "name": "release tags",
  "target": "tag",
  "enforcement": "active",
  "bypass_actors": [{"actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always"}],
  "conditions": {"ref_name": {"include": ["refs/tags/v*"], "exclude": []}},
  "rules": [{"type": "creation"}, {"type": "update"}, {"type": "deletion"}, {"type": "non_fast_forward"}]
}'

ruleset_id() {
  gh api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$1\") | .id"
}

# Prints the fields this script manages, normalised, so apply and check compare the same thing.
state() {
  local main_id tag_id
  main_id=$(ruleset_id main)
  tag_id=$(ruleset_id "release tags")
  jq -n \
    --argjson repo "$(gh api "repos/$repo" --jq '{has_wiki, has_projects, allow_merge_commit,
      allow_rebase_merge, allow_squash_merge, squash_merge_commit_title,
      squash_merge_commit_message, delete_branch_on_merge, allow_update_branch, allow_auto_merge,
      security_and_analysis: (.security_and_analysis | {secret_scanning, secret_scanning_push_protection}),
      topics: (.topics | sort)}')" \
    --argjson dependabot "$(gh api "repos/$repo/automated-security-fixes" --jq .enabled)" \
    --argjson pvr "$(gh api "repos/$repo/private-vulnerability-reporting" --jq .enabled)" \
    --argjson actions "$(gh api "repos/$repo/actions/permissions" --jq '{enabled, sha_pinning_required}')" \
    --argjson token "$(gh api "repos/$repo/actions/permissions/workflow" --jq '{default_workflow_permissions, can_approve_pull_request_reviews}')" \
    --argjson classic "$(gh api "repos/$repo/branches/main/protection" >/dev/null 2>&1 && echo true || echo false)" \
    --argjson main "$( [ -n "$main_id" ] && gh api "repos/$repo/rulesets/$main_id" --jq '{enforcement, bypass_actors, conditions, rules}' || echo null)" \
    --argjson tag "$( [ -n "$tag_id" ] && gh api "repos/$repo/rulesets/$tag_id" --jq '{enforcement, bypass_actors, conditions, rules}' || echo null)" \
    '{repo: $repo, dependabot_security_updates: $dependabot, private_vulnerability_reporting: $pvr,
      actions: $actions, workflow_token: $token, classic_branch_protection: $classic,
      main_ruleset: $main, tag_ruleset: $tag}'
}

desired() {
  jq -n \
    --argjson repo "$repo_settings" --argjson topics "$topics" \
    --argjson main "$main_ruleset" --argjson tag "$tag_ruleset" \
    '{repo: ($repo + {topics: ($topics | sort)}), dependabot_security_updates: true,
      private_vulnerability_reporting: true,
      actions: {enabled: true, sha_pinning_required: true},
      workflow_token: {default_workflow_permissions: "read", can_approve_pull_request_reviews: false},
      classic_branch_protection: false,
      main_ruleset: ($main | {enforcement, bypass_actors, conditions, rules}),
      tag_ruleset: ($tag | {enforcement, bypass_actors, conditions, rules})}'
}

# GitHub adds defaults to what it stores (extra rule parameters, ids), so the check asks whether
# every field set here has the same value there; lists must match in length, in any order.
matches() {
  jq -n --argjson want "$1" --argjson have "$2" -e '
    def sub($a; $b):
      if ($a | type) == "object" then
        ($b | type) == "object" and all($a | keys[]; . as $k | sub($a[$k]; $b[$k]))
      elif ($a | type) == "array" then
        ($b | type) == "array" and ($a | length) == ($b | length)
        and all($a[]; . as $x | any($b[]; sub($x; .)))
      else $a == $b end;
    sub($want; $have)' >/dev/null
}

check() {
  local want have
  want=$(desired)
  have=$(state)
  if matches "$want" "$have"; then
    echo "ok   $repo matches scripts/github-settings.sh"
  else
    echo "drift: $repo differs from scripts/github-settings.sh (- wanted, + actual; GitHub's extra defaults show as + too)" >&2
    diff -u <(jq -S . <<<"$want") <(jq -S . <<<"$have") >&2 || true
    exit 1
  fi
}

upsert_ruleset() {
  local name=$1 body=$2 id
  id=$(ruleset_id "$name")
  if [ -n "$id" ]; then
    gh api -X PUT "repos/$repo/rulesets/$id" --input - <<<"$body" >/dev/null
  else
    gh api -X POST "repos/$repo/rulesets" --input - <<<"$body" >/dev/null
  fi
  echo "set  ruleset \"$name\""
}

apply() {
  gh api -X PATCH "repos/$repo" --input - <<<"$repo_settings" >/dev/null
  gh api -X PUT "repos/$repo/topics" --input - <<<"{\"names\": $topics}" >/dev/null
  echo "set  repository options and topics"

  gh api -X PUT "repos/$repo/vulnerability-alerts" >/dev/null
  gh api -X PUT "repos/$repo/automated-security-fixes" >/dev/null
  gh api -X PUT "repos/$repo/private-vulnerability-reporting" >/dev/null
  echo "set  Dependabot alerts and security updates, private vulnerability reporting"

  gh api -X PUT "repos/$repo/actions/permissions" \
    -F enabled=true -f allowed_actions=all -F sha_pinning_required=true >/dev/null
  gh api -X PUT "repos/$repo/actions/permissions/workflow" \
    -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false >/dev/null
  echo "set  Actions: commit-pinned actions only, read-only GITHUB_TOKEN"

  # The ruleset goes in before the classic protection comes out, so main is never unprotected.
  upsert_ruleset main "$main_ruleset"
  upsert_ruleset "release tags" "$tag_ruleset"
  if gh api "repos/$repo/branches/main/protection" >/dev/null 2>&1; then
    gh api -X DELETE "repos/$repo/branches/main/protection" >/dev/null
    echo "del  classic branch protection on main (replaced by the \"main\" ruleset)"
  fi

  check
}

case $mode in
  apply) apply ;;
  --check) check ;;
  *) echo "usage: $0 [--check]" >&2; exit 2 ;;
esac
