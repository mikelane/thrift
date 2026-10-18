#!/usr/bin/env bash
# The gate that lets CI merge a release-please PR: the PR must be open, on main, from this repo's
# release-please branch, authored by the release App, at the commit CI tested, and change only the
# files release-please writes. Stub PR JSON and file lists exercise each way the gate says no.
# Usage: release-merge.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"
# shellcheck source=release-merge-lib.sh
source "$HARNESS_DIR/release-merge-lib.sh"

REPO=mikelane/thrift
BOT='thrift-release[bot]'
SHA=0123456789abcdef0123456789abcdef01234567
CONFIG=$REPO_ROOT/release-please-config.json

# write_pr <file> [jq filter]: a release PR that passes the gate, edited by the filter.
write_pr() {
  jq -n --arg repo "$REPO" --arg bot "$BOT" --arg sha "$SHA" '{
    state: "open", base: {ref: "main"},
    head: {ref: "release-please--branches--main--components--handoff", sha: $sha,
           repo: {full_name: $repo}},
    user: {login: $bot}}' | jq "${2:-.}" >"$1"
}

GOOD_FILES='.release-please-manifest.json
plugins/handoff/CHANGELOG.md
plugins/handoff/version.txt
plugins/handoff/.claude-plugin/plugin.json'

# problems <pr-filter> [files]: the gate's output for a PR edited by the filter.
problems() {
  local dir
  dir=$TEST_DIR
  write_pr "$dir/pr.json" "$1"
  printf '%s\n' "${2:-$GOOD_FILES}" >"$dir/files"
  release_merge_problems "$dir/pr.json" "$dir/files" "$CONFIG" "$REPO" main "$BOT" "$SHA"
}

test_allowlist_names_the_manifest_and_each_packages_changelog_and_extra_files() {
  local got want
  got=$(release_merge_allowlist "$CONFIG")
  want=$GOOD_FILES
  [[ "$got" == "$want" ]] || fail "got [$got]"
}

test_allowlist_follows_a_package_added_to_the_config() {
  local dir got
  dir=$TEST_DIR
  jq '.packages["plugins/other"] = {"changelog-path": "HISTORY.md", "extra-files": ["a.json", {"path": "b.json"}]}' \
    "$CONFIG" >"$dir/config.json"
  got=$(release_merge_allowlist "$dir/config.json")
  [[ "$got" == *$'\nplugins/other/HISTORY.md\nplugins/other/a.json\nplugins/other/b.json' ]] || fail "got [$got]"
}

test_allowlist_defaults_the_changelog_name_and_allows_no_extra_files() {
  local dir got
  dir=$TEST_DIR
  echo '{"packages": {"plugins/bare": {}}}' >"$dir/config.json"
  got=$(release_merge_allowlist "$dir/config.json")
  [[ "$got" == $'.release-please-manifest.json\nplugins/bare/CHANGELOG.md' ]] || fail "got [$got]"
}

test_a_release_pr_that_changes_only_allowed_files_has_no_problems() {
  local got
  got=$(problems .)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_pr_that_changes_only_some_allowed_files_has_no_problems() {
  local got
  got=$(problems . 'plugins/handoff/CHANGELOG.md')
  [[ -z "$got" ]] || fail "got [$got]"
}

test_an_extra_file_blocks_the_merge() {
  local got
  got=$(problems . "$GOOD_FILES"$'\nscripts/check.sh')
  [[ "$got" == 'scripts/check.sh is not a file a release PR changes' ]] || fail "got [$got]"
}

test_another_file_under_a_package_path_blocks_the_merge() {
  local got
  got=$(problems . "$GOOD_FILES"$'\nplugins/handoff/hooks/register.tsx')
  [[ "$got" == 'plugins/handoff/hooks/register.tsx is not a file a release PR changes' ]] || fail "got [$got]"
}

test_a_changelog_outside_a_package_path_blocks_the_merge() {
  local got
  got=$(problems . 'CHANGELOG.md')
  [[ "$got" == 'CHANGELOG.md is not a file a release PR changes' ]] || fail "got [$got]"
}

test_a_path_that_merely_contains_an_allowed_name_blocks_the_merge() {
  local got
  got=$(problems . 'evil/plugins/handoff/CHANGELOG.md')
  [[ "$got" == 'evil/plugins/handoff/CHANGELOG.md is not a file a release PR changes' ]] || fail "got [$got]"
}

test_a_blank_line_in_the_file_list_is_skipped() {
  local got
  got=$(problems . $'plugins/handoff/CHANGELOG.md\n\n.release-please-manifest.json')
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_branch_without_the_release_please_prefix_blocks_the_merge() {
  local got
  got=$(problems '.head.ref = "feature/x"')
  [[ "$got" == 'the PR branch feature/x does not start with release-please--' ]] || fail "got [$got]"
}

test_an_author_other_than_the_release_app_blocks_the_merge() {
  local got
  got=$(problems '.user.login = "mikelane"')
  [[ "$got" == "the PR author is mikelane, not $BOT" ]] || fail "got [$got]"
}

test_a_head_commit_other_than_the_one_ci_tested_blocks_the_merge() {
  local got
  got=$(problems '.head.sha = "ffffffffffffffffffffffffffffffffffffffff"')
  [[ "$got" == "the PR head is ffffffffffffffffffffffffffffffffffffffff but CI tested $SHA" ]] || fail "got [$got]"
}

test_a_fork_head_blocks_the_merge() {
  local got
  got=$(problems '.head.repo.full_name = "someone/thrift"')
  [[ "$got" == "the PR head is in someone/thrift, not $REPO" ]] || fail "got [$got]"
}

test_a_deleted_head_repo_blocks_the_merge() {
  local got
  got=$(problems '.head.repo = null')
  [[ "$got" == "the PR head is in (deleted), not $REPO" ]] || fail "got [$got]"
}

test_a_closed_pr_blocks_the_merge() {
  local got
  got=$(problems '.state = "closed"')
  [[ "$got" == 'the PR is closed, not open' ]] || fail "got [$got]"
}

test_a_pr_that_targets_another_branch_blocks_the_merge() {
  local got
  got=$(problems '.base.ref = "dev"')
  [[ "$got" == 'the PR targets dev, not main' ]] || fail "got [$got]"
}

test_every_problem_is_reported() {
  local got
  got=$(problems '.state = "closed" | .user.login = "x"' 'oops')
  [[ "$got" == "the PR is closed, not open"$'\n'"the PR author is x, not $BOT"$'\n''oops is not a file a release PR changes' ]] \
    || fail "got [$got]"
}

test_an_unreadable_config_blocks_the_merge() {
  local dir got
  dir=$TEST_DIR
  write_pr "$dir/pr.json"
  echo 'plugins/handoff/CHANGELOG.md' >"$dir/files"
  got=$(release_merge_problems "$dir/pr.json" "$dir/files" "$dir/missing.json" "$REPO" main "$BOT" "$SHA" 2>/dev/null)
  [[ "$got" == *'cannot read the allowlist'* ]] || fail "got [$got]"
}

test_an_unreadable_changed_files_list_blocks_the_merge() {
  local dir got
  dir=$TEST_DIR
  write_pr "$dir/pr.json"
  got=$(release_merge_problems "$dir/pr.json" "$dir/missing-files" "$CONFIG" "$REPO" main "$BOT" "$SHA" 2>/dev/null)
  [[ "$got" == "cannot read the changed files from $dir/missing-files" ]] || fail "got [$got]"
}

# The inline `gh` behaves like the real one when `gh api` gets fields (-f) and no --method: it
# sends a POST, which would try to create a pull request.
test_the_pr_lookup_sends_a_get_request_so_gh_does_not_create_a_pull_request() {
  local dir got
  dir=$TEST_DIR
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'method= has_field=' \
    'for arg in "$@"; do [[ "$arg" == -f || "$arg" == -F ]] && has_field=1; done' \
    'prev=; for arg in "$@"; do [[ "$prev" == -X || "$prev" == --method ]] && method=$arg; prev=$arg; done' \
    '[[ -z "$method" && -n "$has_field" ]] && method=POST' \
    '[[ "${method:-GET}" == GET ]] || { echo "gh would send a $method and create a pull request" >&2; exit 1; }' \
    'echo 42' >"$dir/gh"
  chmod +x "$dir/gh"
  got=$(PATH="$dir:$PATH" release_merge_open_pr_number "$REPO" mikelane release-please--branches--main--components--handoff main 2>&1)
  [[ "$got" == 42 ]] || fail "got [$got]"
}

# changed_files <json>: the names release_merge_changed_files prints for the files API's JSON.
changed_files() { printf '%s' "$1" | release_merge_changed_files; }

test_changed_files_lists_each_name_and_the_old_name_of_a_rename() {
  local got
  got=$(changed_files '[{"filename":"a.md"},{"filename":"b.md","previous_filename":"c.md"}]')
  [[ "$got" == $'a.md\nb.md\nc.md' ]] || fail "got [$got]"
}

test_changed_files_reads_every_page_of_the_files_api() {
  local got
  got=$(changed_files '[{"filename":"a.md"}][{"filename":"b.md"}]')
  [[ "$got" == $'a.md\nb.md' ]] || fail "got [$got]"
}

# problems_for_names <json>: the gate's output for a PR whose files API returned the JSON.
problems_for_names() {
  local dir
  dir=$TEST_DIR
  changed_files "$1" >"$dir/files"
  write_pr "$dir/pr.json"
  release_merge_problems "$dir/pr.json" "$dir/files" "$CONFIG" "$REPO" main "$BOT" "$SHA"
}

test_a_file_name_with_a_trailing_newline_blocks_the_merge() {
  local got
  got=$(problems_for_names '[{"filename":"plugins/handoff/CHANGELOG.md\n"}]')
  [[ "$got" == '"plugins/handoff/CHANGELOG.md\n" is not a file a release PR changes' ]] || fail "got [$got]"
}

test_a_file_name_with_a_newline_cannot_pose_as_two_allowed_names() {
  local got
  got=$(problems_for_names '[{"filename":"plugins/handoff/CHANGELOG.md\n.release-please-manifest.json"}]')
  [[ "$got" == '"plugins/handoff/CHANGELOG.md\n.release-please-manifest.json" is not a file a release PR changes' ]] \
    || fail "got [$got]"
}

test_an_ordinary_file_list_from_the_files_api_has_no_problems() {
  local got
  got=$(problems_for_names '[{"filename":".release-please-manifest.json"},{"filename":"plugins/handoff/CHANGELOG.md"}]')
  [[ -z "$got" ]] || fail "got [$got]"
}

# stub_gh: a `gh` on PATH that answers the pull request list, the CI runs of a head commit and a
# single pull request from files in $TEST_DIR (pulls.json, runs-<sha>.json, pr-<n>.json). A head
# commit with no runs-<sha>.json has no CI run.
stub_gh() {
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    "dir=$TEST_DIR" \
    'path= ; for arg in "$@"; do [[ "$arg" == repos/* ]] && path=$arg; done' \
    'case "$path" in' \
    '  */actions/runs\?head_sha=*)' \
    '    sha=${path#*head_sha=}; sha=${sha%%&*}' \
    '    [[ "$path" == *event=pull_request* ]] || { echo "no event filter" >&2; exit 1; }' \
    '    echo "$GH_TOKEN" >"$dir/runs-token"' \
    '    [[ -e "$dir/runs-$sha.error" ]] && { echo "HTTP 403" >&2; exit 1; }' \
    '    if [[ -r "$dir/runs-$sha.json" ]]; then cat "$dir/runs-$sha.json"; else echo "{\"workflow_runs\":[]}"; fi ;;' \
    '  */pulls\?*) [[ -e "$dir/pulls.error" ]] && { echo "HTTP 500" >&2; exit 1; }; cat "$dir/pulls.json" ;;' \
    '  */pulls/*) cat "$dir/pr-${path##*/}.json" ;;' \
    '  *) echo "unexpected gh call: $*" >&2; exit 1 ;;' \
    'esac' >"$TEST_DIR/gh"
  chmod +x "$TEST_DIR/gh"
  PATH="$TEST_DIR:$PATH"
}

SHA_A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
SHA_B=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

# write_open_pr <number> <sha> [jq filter]: one entry of the open-pull-requests list.
open_pr() {
  jq -n --arg n "$1" --arg sha "$2" --arg repo "$REPO" '{
    number: ($n | tonumber), state: "open", base: {ref: "main"},
    head: {ref: "release-please--branches--main--components--handoff", sha: $sha, repo: {full_name: $repo}}}' \
    | jq -c "${3:-.}"
}

# write_pulls <entry>...: the pulls list the stub serves.
write_pulls() { printf '%s\n' "$@" | jq -s '.' >"$TEST_DIR/pulls.json"; }

# write_runs <sha> <run>...: the CI runs the stub serves for a head commit. A run is
# `<name> <status> <conclusion|null> <created_at> [path] [repo] [branch] [pr]`; the last four
# default to CI's workflow file, this repository, the release branch and pull request 111 into
# main. [pr] is the number of the pull request the run belongs to, or `none` for a run whose
# pull_requests array is empty.
write_runs() {
  local sha=$1 run
  shift
  for run in "$@"; do
    # shellcheck disable=SC2086
    set -- $run
    jq -n --arg name "$1" --arg status "$2" --arg conclusion "$3" --arg at "$4" \
      --arg path "${5:-.github/workflows/ci.yml}" --arg repo "${6:-$REPO}" \
      --arg branch "${7:-release-please--branches--main--components--handoff}" \
      --arg pr "${8:-111}" \
      '{name: $name, path: $path, status: $status, head_branch: $branch,
        head_repository: {full_name: $repo},
        pull_requests: (if $pr == "none" then [] else [{number: ($pr | tonumber), base: {ref: "main"}}] end),
        conclusion: (if $conclusion == "null" then null else $conclusion end), created_at: $at}'
  done | jq -s '{workflow_runs: .}' >"$TEST_DIR/runs-$sha.json"
}

sweep() { stub_gh; release_merge_sweep "$REPO" main; }

test_a_sweep_with_no_open_release_prs_selects_nothing() {
  local got
  write_pulls
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_selects_a_pr_whose_ci_succeeded_at_its_head() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z'
  got=$(sweep)
  [[ "$got" == "111 $SHA_A" ]] || fail "got [$got]"
}

test_a_sweep_skips_a_pr_whose_ci_failed_at_its_head() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI completed failure 2026-10-18T10:00:00Z'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_skips_a_pr_whose_ci_is_still_running_at_its_head() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI in_progress null 2026-10-18T10:00:00Z'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_skips_a_pr_with_no_ci_run_at_its_head() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_skips_a_pr_whose_ci_succeeded_only_at_an_older_sha() {
  local got
  write_pulls "$(open_pr 111 $SHA_B)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_counts_only_the_latest_ci_run_at_the_head() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z' 'CI completed failure 2026-10-18T11:00:00Z'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_accepts_a_rerun_that_succeeded_after_a_failure() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI completed failure 2026-10-18T10:00:00Z' 'CI completed success 2026-10-18T11:00:00Z'
  got=$(sweep)
  [[ "$got" == "111 $SHA_A" ]] || fail "got [$got]"
}

test_a_sweep_ignores_runs_of_other_workflows() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z' 'Lint completed failure 2026-10-18T11:00:00Z .github/workflows/lint.yml'
  got=$(sweep)
  [[ "$got" == "111 $SHA_A" ]] || fail "got [$got]"
}

test_a_sweep_ignores_a_successful_run_from_a_fork() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z .github/workflows/ci.yml someone/thrift'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_ignores_a_successful_run_from_a_differently_named_branch() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A "CI completed success 2026-10-18T10:00:00Z .github/workflows/ci.yml $REPO main"
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_ignores_a_successful_run_of_another_workflow_file_named_ci() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z .github/workflows/fake.yml'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_skips_a_pr_the_other_path_already_merged() {
  local got
  write_pulls "$(open_pr 111 $SHA_A '.state = "closed"')"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_skips_a_pr_from_a_branch_without_the_release_please_prefix() {
  local got
  write_pulls "$(open_pr 111 $SHA_A '.head.ref = "feature/x"')"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_skips_a_pr_from_a_fork() {
  local got
  write_pulls "$(open_pr 111 $SHA_A '.head.repo.full_name = "someone/thrift"')"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_selects_each_pr_whose_ci_passed_and_no_other() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)" "$(open_pr 112 $SHA_B)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z'
  write_runs $SHA_B 'CI completed failure 2026-10-18T10:00:00Z'
  got=$(sweep)
  [[ "$got" == "111 $SHA_A" ]] || fail "got [$got]"
}

test_the_ci_run_lookup_uses_the_runs_token_not_the_app_token() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z'
  (export GH_TOKEN=app-token RUNS_TOKEN=runs-token; sweep >/dev/null)
  got=$(<"$TEST_DIR/runs-token")
  [[ "$got" == runs-token ]] || fail "got [$got]"
}

test_the_merge_job_grants_its_token_actions_read_and_nothing_else() {
  local got
  got=$(awk '/^    permissions:/{f=1;next} f&&/^      /{print;next} f{exit}' "$REPO_ROOT/.github/workflows/release-merge.yml")
  [[ "$got" == '      actions: read' ]] || fail "got [$got]"
}

test_the_workflow_hands_the_sweep_the_workflow_token_as_the_runs_token() {
  grep -qF 'RUNS_TOKEN: ${{ github.token }}' "$REPO_ROOT/.github/workflows/release-merge.yml" \
    || fail 'RUNS_TOKEN is not the workflow token'
}

# sweep_fails: succeeds when the sweep exits non-zero, as the workflow runs it (pipefail on).
sweep_fails() { ! (set -o pipefail; sweep) >/dev/null 2>&1; }

test_a_sweep_fails_when_the_ci_run_lookup_fails_so_a_stuck_pr_is_not_hidden() {
  write_pulls "$(open_pr 111 $SHA_A)"
  : >"$TEST_DIR/runs-$SHA_A.error"
  sweep_fails || fail 'a failed CI run lookup was read as "no CI run"'
}

test_a_sweep_fails_when_the_pull_request_list_fails() {
  : >"$TEST_DIR/pulls.error"
  sweep_fails || fail 'a failed pull request list was read as "no open release PR"'
}

test_a_sweep_still_selects_a_pr_when_a_later_pr_lookup_fails() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)" "$(open_pr 112 $SHA_B)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z'
  : >"$TEST_DIR/runs-$SHA_B.error"
  got=$(sweep 2>/dev/null)
  [[ "$got" == "111 $SHA_A" ]] || fail "got [$got]"
}

test_a_sweep_reads_every_page_of_the_ci_runs() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z'
  jq -c . "$TEST_DIR/runs-$SHA_A.json" >"$TEST_DIR/page1"
  echo '{"workflow_runs":[]}' >>"$TEST_DIR/page1"
  mv "$TEST_DIR/page1" "$TEST_DIR/runs-$SHA_A.json"
  got=$(sweep)
  [[ "$got" == "111 $SHA_A" ]] || fail "got [$got]"
}

# lost_race <pr-json-filter>:release_merge_lost_race's status and output for PR 111 at SHA_A.
lost_race() {
  write_pr "$TEST_DIR/pr-111.json" "$1"
  stub_gh
  release_merge_lost_race "$REPO" 111 "$SHA"
}

test_a_failed_merge_of_a_pr_that_is_already_merged_is_a_lost_race() {
  lost_race '.state = "closed"' >/dev/null || fail 'treated a merged PR as a real failure'
}

test_a_failed_merge_of_a_pr_whose_head_moved_is_a_lost_race() {
  lost_race '.head.sha = "ffffffffffffffffffffffffffffffffffffffff"' >/dev/null || fail 'treated a moved head as a real failure'
}

test_a_failed_merge_of_an_open_pr_at_the_tested_head_is_not_a_lost_race() {
  lost_race . >/dev/null && fail 'hid a real merge failure'
  return 0
}

# merge_commands: the lines of the workflow that run `gh pr merge`. A comment, an echo or trailing
# text that merely mentions the command does not start with it, so it is not selected. A trailing
# comment on a merge line is stripped, so a flag named only in that comment does not count. Each
# line gets one trailing space, so a flag at the end of the line matches the ' --flag ' patterns.
merge_commands() {
  grep -E '^[[:space:]]*gh pr merge ' "$REPO_ROOT/.github/workflows/release-merge.yml" \
    | sed -e "s/[[:space:]]#.*$//" -e "s/$/ /"
}

test_the_workflow_runs_exactly_one_merge_command() {
  local got
  got=$(merge_commands | wc -l | tr -d ' ')
  [[ "$got" == 1 ]] || fail "got [$got]"
}

test_the_workflow_also_runs_when_release_please_completes() {
  grep -qE '^    workflows: \[CI, Release Please\]' "$REPO_ROOT/.github/workflows/release-merge.yml" \
    || fail 'the workflow_run trigger does not name Release Please'
}

test_the_workflow_runs_the_sweep_only_for_a_successful_release_please_push_to_main() {
  local got
  got=$(tr -d '\n' <"$REPO_ROOT/.github/workflows/release-merge.yml" | tr -s ' ')
  [[ "$got" == *"github.event.workflow_run.name == 'Release Please' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == github.event.repository.default_branch"* ]] \
    || fail 'the job condition does not pin the Release Please trigger to a push to main'
}

# A run that the job `if` skips still joins the concurrency group, and a newer pending run replaces
# an older pending one. CI's push to main completes with head_branch main, the branch the sweep
# also runs for, so a group without the workflow name lets that skipped run cancel a queued sweep.
test_the_concurrency_group_names_the_workflow_so_a_skipped_ci_push_run_cannot_cancel_a_queued_sweep() {
  local got
  got=$(grep -E '^  group: ' "$REPO_ROOT/.github/workflows/release-merge.yml")
  [[ "$got" == *'github.event.workflow_run.name'* ]] || fail "got [$got]"
}

test_the_merge_command_treats_a_lost_race_as_success() {
  local got
  got=$(merge_commands)
  [[ "$got" == *'|| release_merge_lost_race "$REPO" "$number" "$TESTED_SHA" '* ]] || fail "got [$got]"
}

test_the_merge_command_skips_the_ruleset_review_with_admin() {
  local got
  got=$(merge_commands)
  [[ "$got" == *' --admin '* ]] || fail "got [$got]"
}

test_the_merge_command_squashes() {
  local got
  got=$(merge_commands)
  [[ "$got" == *' --squash '* ]] || fail "got [$got]"
}

test_the_merge_command_does_not_read_the_sweep_loops_stdin() {
  local got
  got=$(merge_commands)
  [[ "$got" == *' </dev/null '* ]] || fail "got [$got]"
}

test_the_merge_command_pins_the_merge_to_the_commit_ci_tested() {
  local got
  got=$(merge_commands)
  [[ "$got" == *' --match-head-commit "$TESTED_SHA"'* ]] || fail "got [$got]"
}

# --- Adversarial QA (gate 3) findings. ---

# ci_run <id> <conclusion> <created_at> <pr-number> <pr-base>: one CI run object as the runs API
# returns it for a same-repo pull request, with its pull_requests entry.
ci_run() {
  jq -nc --argjson id "$1" --arg c "$2" --arg at "$3" --argjson n "$4" --arg base "$5" --arg repo "$REPO" '{
    id: $id, name: "CI", path: ".github/workflows/ci.yml", status: "completed", conclusion: $c,
    created_at: $at, head_branch: "release-please--branches--main--components--handoff",
    head_repository: {full_name: $repo},
    pull_requests: [{number: $n, base: {ref: $base}}]}'
}

# write_ci_runs <sha> <run>...: the runs the stub serves for <sha>, in the order given (the API
# lists the newest run first).
write_ci_runs() {
  local sha=$1
  shift
  printf '%s\n' "$@" | jq -s '{workflow_runs: .}' >"$TEST_DIR/runs-$sha.json"
}

# ci.yml runs on pull_request with no branch filter, and anyone who can read the repo can open a PR
# from this repo's release branch into some other base. That PR's CI run has the same head SHA,
# head branch, head repository and workflow file, but it tested a merge into another base. It must
# not stand in for the release PR's own CI run, which here failed.
test_a_sweep_ignores_a_successful_run_from_a_pr_of_the_same_branch_into_another_base() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_ci_runs $SHA_A \
    "$(ci_run 2 success 2026-10-18T11:00:00Z 999 old-feature)" \
    "$(ci_run 1 failure 2026-10-18T10:00:00Z 111 main)"
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

# created_at has one-second resolution. Two runs created in the same second tie, and sort_by keeps
# the API's newest-first order, so `last` picks the older run. The newer run failed.
test_a_sweep_counts_the_newer_of_two_ci_runs_created_in_the_same_second() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_ci_runs $SHA_A \
    "$(ci_run 2 failure 2026-10-18T10:00:00Z 111 main)" \
    "$(ci_run 1 success 2026-10-18T10:00:00Z 111 main)"
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

# A person converts the release PR to a draft to hold the release. The merge API refuses a draft,
# release_merge_lost_race sees an open PR at the tested head and fails, so with the sweep every
# push to main turns the job red until someone undrafts it. The gate should refuse it instead.
test_a_draft_pr_blocks_the_merge() {
  local got
  got=$(problems '.draft = true')
  [[ "$got" == *draft* ]] || fail "got [$got]"
}

test_a_pr_that_is_not_a_draft_has_no_draft_problem() {
  local got
  got=$(problems '.draft = false')
  [[ -z "$got" ]] || fail "got [$got]"
}

# A run with an empty pull_requests array names no pull request, so it cannot be tied to this one.
test_a_sweep_ignores_a_successful_run_with_no_pull_requests() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z .github/workflows/ci.yml mikelane/thrift release-please--branches--main--components--handoff none'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_ignores_a_successful_run_from_a_different_pr_number_into_main() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_ci_runs $SHA_A "$(ci_run 1 success 2026-10-18T10:00:00Z 999 main)"
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

run_tests "$@"
