#!/usr/bin/env bash
# Sourced by the release-merge*.test.sh files after canary-report-lib.sh: the release-merge lib, the
# constants the tests share, a stub `gh`, and the fixtures that fill it (open pull requests, a
# release PR, its changed files, CI runs).
# shellcheck disable=SC2034 # file-wide: the constants below are read by the test files that source this
# shellcheck source=../scripts/release-merge-lib.sh
source "$RELEASE_MERGE_LIB"

REPO=mikelane/thrift
BOT='thrift-release[bot]'
RELEASE_BRANCH=release-please--branches--main--components--handoff
SHA=0123456789abcdef0123456789abcdef01234567
CONFIG=$REPO_ROOT/release-please-config.json
SHA_A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
SHA_B=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

# write_pr <file> [jq filter]: a release PR that passes the gate, edited by the filter.
write_pr() {
  jq -n --arg repo "$REPO" --arg bot "$BOT" --arg sha "$SHA" '{
    number: 111, state: "open", base: {ref: "main"},
    head: {ref: "release-please--branches--main--components--handoff", sha: $sha,
           repo: {full_name: $repo}},
    user: {login: $bot}}' | jq "${2:-.}" >"$1"
}

# stub_gh: a `gh` on PATH that answers the pull request list, the CI runs of a head commit and a
# single pull request from files in $TEST_DIR (pulls.json, runs-<sha>.json, pr-<n>.json). A head
# commit with no runs-<sha>.json has no CI run. The list calls (the pull request list with a
# query, CI runs, a pull request's files) fail unless `--paginate` is given, as a single page
# would miss results. The merge command logs its arguments to merge-calls and fails when
# merge.error exists, first replacing pr-<n>.json with pr-after-failed-merge.json if that exists
# (the other trigger got there first).
stub_gh() {
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    "dir=$(printf '%q' "$TEST_DIR")" \
    'if [[ "$1 $2" == "pr merge" ]]; then' \
    '  echo "$*" >>"$dir/merge-calls"' \
    '  [[ -e "$dir/merge.error" ]] || exit 0' \
    '  [[ -r "$dir/pr-after-failed-merge.json" ]] && cp "$dir/pr-after-failed-merge.json" "$dir/pr-$3.json"' \
    '  echo "merge refused" >&2; exit 1' \
    'fi' \
    'path= paginated=0' \
    'for arg in "$@"; do [[ "$arg" == repos/* ]] && path=$arg; [[ "$arg" == --paginate ]] && paginated=1; done' \
    '# A list call without --paginate would read only the first page: fail it, naming the call.' \
    'require_paginate() { [[ $paginated == 1 ]] || { echo "gh api $path lacks --paginate" >&2; exit 1; }; }' \
    'case "$path" in' \
    '  */actions/runs\?head_sha=*)' \
    '    require_paginate' \
    '    sha=${path#*head_sha=}; sha=${sha%%&*}' \
    '    [[ "$path" == *event=pull_request* ]] || { echo "no event filter" >&2; exit 1; }' \
    '    echo "$GH_TOKEN" >"$dir/runs-token"' \
    '    [[ -e "$dir/runs-$sha.error" ]] && { echo "HTTP 403" >&2; exit 1; }' \
    '    if [[ -r "$dir/runs-$sha.json" ]]; then cat "$dir/runs-$sha.json"; else echo "{\"workflow_runs\":[]}"; fi ;;' \
    '  */pulls) jq -r ".[0].number // empty" "$dir/pulls.json" ;;' \
    '  */pulls/*/files) require_paginate; cat "$dir/files-$(basename "$(dirname "$path")").json" ;;' \
    '  */pulls\?*) require_paginate; [[ -e "$dir/pulls.error" ]] && { echo "HTTP 500" >&2; exit 1; }; cat "$dir/pulls.json" ;;' \
    '  */pulls/*) cat "$dir/pr-${path##*/}.json" ;;' \
    '  *) echo "unexpected gh call: $*" >&2; exit 1 ;;' \
    'esac' >"$TEST_DIR/gh"
  chmod +x "$TEST_DIR/gh"
  PATH="$TEST_DIR:$PATH"
}

# open_pr <number> <sha> [jq filter]: one entry of the open-pull-requests list.
open_pr() {
  jq -n --arg n "$1" --arg sha "$2" --arg repo "$REPO" '{
    number: ($n | tonumber), state: "open", base: {ref: "main"},
    head: {ref: "release-please--branches--main--components--handoff", sha: $sha, repo: {full_name: $repo}}}' \
    | jq -c "${3:-.}"
}

# write_pulls <entry>...: the pulls list the stub serves.
write_pulls() { printf '%s\n' "$@" | jq -s '.' >"$TEST_DIR/pulls.json"; }

# write_runs <sha> <run>...: the CI runs the stub serves for a head commit, newest first as the API
# lists them. A run is `<name> <status> <conclusion|null> <created_at> [path] [repo] [branch] [prs]
# [id]`. A field given as `-` or left off takes its default: CI's workflow file, this repository,
# the release branch, pull request 111 into main, and id 0. [prs] is `none` for a run whose
# pull_requests array is empty, else a comma-separated list of `<number>[@<base>]`.
write_runs() {
  local sha=$1 run
  shift
  for run in "$@"; do
    # shellcheck disable=SC2086
    set -- $run
    jq -n --arg name "$1" --arg status "$2" --arg conclusion "$3" --arg at "$4" \
      --arg path "${5:--}" --arg repo "${6:--}" --arg branch "${7:--}" --arg prs "${8:-111}" --arg id "${9:-0}" \
      --arg default_repo "$REPO" --arg default_branch "$RELEASE_BRANCH" '
      def or_default($default): if . == "-" then $default else . end;
      {id: ($id | tonumber), name: $name, path: ($path | or_default(".github/workflows/ci.yml")),
        status: $status, head_branch: ($branch | or_default($default_branch)),
        head_repository: {full_name: ($repo | or_default($default_repo))},
        pull_requests: (if $prs == "none" then []
          else [$prs | split(",")[] | split("@") | {number: (.[0] | tonumber), base: {ref: (.[1] // "main")}}] end),
        conclusion: (if $conclusion == "null" then null else $conclusion end), created_at: $at}'
  done | jq -s '{workflow_runs: .}' >"$TEST_DIR/runs-$sha.json"
}

# stage_release_pr <number> <sha> <component> <ci-conclusion>: a release PR that passes the gate,
# with its changed files and its CI run, in $TEST_DIR. Each call adds the PR to the open list.
stage_release_pr() {
  local branch=release-please--branches--main--components--$3
  write_pr "$TEST_DIR/pr-$1.json" ".number = $1 | .head.sha = \"$2\" | .head.ref = \"$branch\""
  echo "[{\"filename\":\"plugins/$3/CHANGELOG.md\"}]" >"$TEST_DIR/files-$1.json"
  write_runs "$2" "CI completed $4 2026-10-18T10:00:00Z .github/workflows/ci.yml $REPO $branch $1"
  open_pr "$1" "$2" ".head.ref = \"$branch\"" >>"$TEST_DIR/open-prs.jsonl"
  jq -s . "$TEST_DIR/open-prs.jsonl" >"$TEST_DIR/pulls.json"
}

# edit_pr <number> <jq filter>: edits the staged PR the stub serves.
edit_pr() {
  jq "$2" "$TEST_DIR/pr-$1.json" >"$TEST_DIR/pr.tmp" && mv "$TEST_DIR/pr.tmp" "$TEST_DIR/pr-$1.json"
}
