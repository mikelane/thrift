#!/usr/bin/env bash
# Sourced by the release-merge*.test.sh files after canary-report-lib.sh: the release-merge lib, the
# constants the tests share, a stub `gh`, and the fixtures that fill it (open pull requests, a
# release PR, its changed files, CI runs).
# shellcheck disable=SC2034 # file-wide: the constants below are read by the test files that source this
# shellcheck source=../scripts/release-merge-lib.sh
source "$RELEASE_MERGE_LIB"

REPO=mikelane/thrift
BOT='thrift-release[bot]'
RELEASE_BRANCH=release-please--branches--main
SHA=0123456789abcdef0123456789abcdef01234567
CONFIG=$REPO_ROOT/release-please-config.json
SHA_A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
SHA_B=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

# write_pr <file> [jq filter]: a release PR that passes the gate (one changed file), edited by the filter.
write_pr() {
  jq -n --arg repo "$REPO" --arg bot "$BOT" --arg sha "$SHA" '{
    number: 111, state: "open", changed_files: 1, base: {ref: "main"},
    head: {ref: "release-please--branches--main", sha: $sha,
           repo: {full_name: $repo}},
    user: {login: $bot}}' | jq "${2:-.}" >"$1"
}

# stub_gh: a `gh` on PATH that answers the pull request list, the CI runs of a head commit and a
# single pull request from files in $TEST_DIR (pulls.json, runs-<sha>.json, pr-<n>.json). A head
# commit with no runs-<sha>.json has no CI run. The list calls (the pull request list with a
# query, CI runs, a pull request's files) fail unless `--paginate` is given, as a single page
# would miss results. The merge command logs its arguments to merge-calls and fails when
# merge.error exists, first replacing pr-<n>.json with pr-after-failed-merge.json if that exists
# (the other trigger got there first), and printing merge.error as its stderr ("merge refused"
# when it is empty). Each Actions route (the CI runs, a run's artifact list, an
# artifact's zip) records the GH_TOKEN it was called with in its own file (runs-token,
# artifacts-token, zip-token), so a test can check every one of them used the runs token.
stub_gh() {
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    "dir=$(printf '%q' "$TEST_DIR")" \
    'if [[ "$1 $2" == "pr merge" ]]; then' \
    '  echo "$*" >>"$dir/merge-calls"' \
    '  [[ -e "$dir/merge.error" ]] || exit 0' \
    '  [[ -r "$dir/pr-after-failed-merge.json" ]] && cp "$dir/pr-after-failed-merge.json" "$dir/pr-$3.json"' \
    '  if [[ -s "$dir/merge.error" ]]; then cat "$dir/merge.error" >&2; else echo "merge refused" >&2; fi; exit 1' \
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
    '  */actions/runs/*/artifacts\?*)' \
    '    require_paginate' \
    '    run=${path#*/actions/runs/}; run=${run%%/*}' \
    '    echo "$GH_TOKEN" >"$dir/artifacts-token"' \
    '    [[ -e "$dir/artifacts-$run.error" ]] && { echo "HTTP 500" >&2; exit 1; }' \
    '    if [[ -r "$dir/artifacts-$run.json" ]]; then cat "$dir/artifacts-$run.json"; else echo "{\"artifacts\":[]}"; fi ;;' \
    '  */actions/artifacts/*/zip)' \
    '    artifact=${path#*/actions/artifacts/}; artifact=${artifact%%/*}' \
    '    echo "$GH_TOKEN" >"$dir/zip-token"' \
    '    [[ -e "$dir/record-$artifact.error" ]] && { echo "HTTP 500" >&2; exit 1; }' \
    '    cat "$dir/record-$artifact.zip" ;;' \
    '  */pulls) jq -r ".[0].number // empty" "$dir/pulls.json" ;;' \
    '  */pulls/*/files) require_paginate; cat "$dir/files-$(basename "$(dirname "$path")").json" ;;' \
    '  */pulls\?*) require_paginate; echo "$path" >>"$dir/pulls-paths"; [[ -e "$dir/pulls.error" ]] && { echo "HTTP 500" >&2; exit 1; }; cat "$dir/pulls.json" ;;' \
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
    head: {ref: "release-please--branches--main", sha: $sha, repo: {full_name: $repo}}}' \
    | jq -c "${3:-.}"
}

# write_pulls <entry>...: the pulls list the stub serves.
write_pulls() { printf '%s\n' "$@" | jq -s '.' >"$TEST_DIR/pulls.json"; }

# write_runs <sha> <run>...: the CI runs the stub serves for a head commit, newest first as the API
# lists them. A run is `<name> <status> <conclusion|null> <created_at> [path] [repo] [branch] [prs]
# [id] [record]`. A field given as `-` or left off takes its default: CI's workflow file, this
# repository, the release branch, pull request 111 into main, a fresh id, and a pr-record naming
# the first of [prs]. [prs] is `none` for a run whose pull_requests array is empty, else a
# comma-separated list of `<number>[@<base>]`. [record] is `none` for a run with no pr-record
# artifact, `corrupt` for one that is not a zip, else `<number>[@<base>]` for a record naming that
# PR whatever pull_requests says (the closed decoy of issue #117).
write_runs() {
  local sha=$1 run id record
  shift
  for run in "$@"; do
    # shellcheck disable=SC2086
    set -- $run
    id=${9:--}
    [[ "$id" != - ]] || id=$(next_run_id)
    record=${10:--}
    if [[ "$record" == - ]]; then
      record=${8:-111}
      [[ "$record" == none ]] || record=${record%%,*}
    fi
    write_record "$id" "$record"
    jq -n --arg name "$1" --arg status "$2" --arg conclusion "$3" --arg at "$4" \
      --arg path "${5:--}" --arg repo "${6:--}" --arg branch "${7:--}" --arg prs "${8:-111}" --arg id "$id" \
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

# next_run_id: an id no other default-id run has. Explicit ids in the tests stay below 1000.
next_run_id() {
  local next=$(( $(cat "$TEST_DIR/run-id-seq" 2>/dev/null || echo 1000) + 1 ))
  echo "$next" >"$TEST_DIR/run-id-seq"
  echo "$next"
}

# write_record <run-id> <none|corrupt|number[@base]>: the pr-record artifact the stub serves for a
# run: the artifact listing (artifact id = 5000 + run id) and the zip it downloads. `none` serves
# an empty listing, `corrupt` a zip that is not one, and anything else a zip holding
# pr-record.json with that number and base (default main).
write_record() {
  local run=$1 spec=$2 artifact=$((5000 + $1))
  rm -f "$TEST_DIR/artifacts-$run.json" "$TEST_DIR/record-$artifact.zip"
  [[ "$spec" != none ]] || return 0
  printf '{"artifacts":[{"id":%s,"name":"pr-record","expired":false}]}\n' "$artifact" >"$TEST_DIR/artifacts-$run.json"
  if [[ "$spec" == corrupt ]]; then
    echo 'this is not a zip' >"$TEST_DIR/record-$artifact.zip"
  else
    python3 -I -c '
import json, sys, zipfile
number, _, base = sys.argv[2].partition("@")
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.writestr("pr-record.json", json.dumps({"number": int(number), "base": base or "main"}))
' "$TEST_DIR/record-$artifact.zip" "$spec"
  fi
}

# write_artifact_pages <run-id> <page>...: the artifact listing the stub serves for a run, each
# <page> a JSON object as one page of `gh api --paginate` prints it, pages concatenated.
write_artifact_pages() {
  local run=$1
  shift
  printf '%s\n' "$@" >"$TEST_DIR/artifacts-$run.json"
}

# artifact_entry <id> [name] [expired]: one entry of an artifact listing (default pr-record, false).
artifact_entry() {
  printf '{"id":%s,"name":"%s","expired":%s}' "$1" "${2:-pr-record}" "${3:-false}"
}

# write_raw_record <artifact-id> <content> [member]: the zip the stub serves for an artifact, holding
# <content> verbatim in <member> (default pr-record.json), for records ci.yml would never write.
write_raw_record() {
  python3 -I -c '
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.writestr(sys.argv[3], sys.argv[2])
' "$TEST_DIR/record-$1.zip" "$2" "${3:-pr-record.json}"
}

# stage_release_pr <number> <sha> <component> <ci-conclusion>: a release PR that passes the gate,
# with its changed files and its CI run (id 100 + the number, its pr-record naming the PR), in $TEST_DIR. Each call adds the PR to the open list.
# The first PR staged is on $RELEASE_BRANCH; open PRs may not share a head ref, so each later one gets
# $RELEASE_BRANCH--<component>.
stage_release_pr() {
  local branch=$RELEASE_BRANCH
  [[ ! -s "$TEST_DIR/open-prs.jsonl" ]] || branch=$RELEASE_BRANCH--$3
  write_pr "$TEST_DIR/pr-$1.json" ".number = $1 | .head.sha = \"$2\" | .head.ref = \"$branch\""
  echo "[{\"filename\":\"plugins/$3/CHANGELOG.md\"}]" >"$TEST_DIR/files-$1.json"
  write_runs "$2" "CI completed $4 2026-10-18T10:00:00Z .github/workflows/ci.yml $REPO $branch $1 $((100 + $1))"
  open_pr "$1" "$2" ".head.ref = \"$branch\"" >>"$TEST_DIR/open-prs.jsonl"
  jq -s . "$TEST_DIR/open-prs.jsonl" >"$TEST_DIR/pulls.json"
}

# edit_pr <number> <jq filter>: edits the staged PR the stub serves.
edit_pr() {
  jq "$2" "$TEST_DIR/pr-$1.json" >"$TEST_DIR/pr.tmp" && mv "$TEST_DIR/pr.tmp" "$TEST_DIR/pr-$1.json"
}
