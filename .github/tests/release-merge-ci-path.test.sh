#!/usr/bin/env bash
# The CI-triggered path of release_merge_run against a stub `gh`: the triggering run must be the latest
# CI run, the gate checks its pr-record, and the merge failure reasons reach the annotations.
# Usage: release-merge-ci-path.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"
# shellcheck source=release-merge-stubs-lib.sh
source "$HARNESS_DIR/release-merge-stubs-lib.sh"
# shellcheck source=release-merge-step-lib.sh
source "$HARNESS_DIR/release-merge-step-lib.sh"

# The CI path merges the run that triggered it only when that run is the latest qualifying CI run
# at the head: a manual rerun of an older success after a newer failure must not merge, as the sweep
# would not.
test_a_ci_triggered_run_refuses_an_older_success_rerun_after_a_newer_failure() {
  stage_release_pr 111 "$SHA_A" handoff success
  write_runs "$SHA_A" \
    'CI completed failure 2026-10-18T11:00:00Z - - - 111 300' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 211'
  run_ci_path
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "::warning title=Release PR #111 not merged::the CI run 211 that triggered this merge is not the latest CI run at $SHA_A for this PR (latest: run 300)"
}

test_a_ci_triggered_run_refuses_when_a_newer_run_is_still_going() {
  stage_release_pr 111 "$SHA_A" handoff success
  write_runs "$SHA_A" \
    'CI in_progress null 2026-10-18T11:00:00Z - - - 111 300' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 211'
  run_ci_path
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "(latest: run 300)"
}

test_a_ci_triggered_run_names_both_run_ids_when_no_run_counts() {
  stage_release_pr 111 "$SHA_A" handoff success
  write_record 211 999@old-feature
  run_ci_path
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "the CI run 211 that triggered this merge is not the latest CI run at $SHA_A for this PR (latest: none)"
}

test_a_ci_triggered_run_fails_when_the_ci_runs_cannot_be_listed() {
  stage_release_pr 111 "$SHA_A" handoff success
  : >"$TEST_DIR/runs-$SHA_A.error"
  run_ci_path
  assert_exit_code 1
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "::error title=Release PR #111 not merged::cannot read the CI runs at $SHA_A"
}

test_a_ci_triggered_run_fails_when_the_latest_runs_record_cannot_be_downloaded() {
  stage_release_pr 111 "$SHA_A" handoff success
  : >"$TEST_DIR/record-5211.error"
  run_ci_path
  assert_exit_code 1
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "cannot read the CI runs at $SHA_A (cannot download the pr-record (artifact 5211) of CI run 211)"
}

# The gate checks the chosen run's own pr-record: a run whose record does not name this PR into main
# (a decoy from another base, issue #117) merges nothing. The CI path reaches the gate only for a run
# release_merge_triggering_run_is_latest accepts.
test_the_gate_refuses_a_run_whose_record_names_another_pr() {
  stage_release_pr 111 "$SHA_A" handoff success
  write_record 211 999@old-feature
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "::warning title=Release PR #111 (handoff) not merged::the CI run 211 has a pr-record naming {\"number\":999,\"base\":\"old-feature\"} (at $SHA_A)"
}

test_the_gate_refuses_a_run_with_no_record() {
  stage_release_pr 111 "$SHA_A" handoff success
  write_record 211 none
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "::warning title=Release PR #111 (handoff) not merged::the CI run 211 has no pr-record artifact (at $SHA_A)"
}

test_the_gate_refuses_a_run_with_an_unreadable_record() {
  stage_release_pr 111 "$SHA_A" handoff success
  write_record 211 corrupt
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "::warning title=Release PR #111 (handoff) not merged::the CI run 211 has an unreadable pr-record (at $SHA_A)"
}

# The record problem joins the gate's own problems rather than replacing them.
test_the_gate_lists_both_a_gate_problem_and_a_record_problem() {
  stage_release_pr 111 "$SHA_A" handoff success
  edit_pr 111 '.user.login = "someone"'
  write_record 211 none
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "- the CI run 211 has no pr-record artifact"
  assert_out_has "- the PR author is someone, not $BOT"
}

test_a_ci_triggered_run_reads_the_record_with_the_runs_token_not_the_app_token() {
  local artifacts_token zip_token
  stage_release_pr 111 "$SHA_A" handoff success
  GH_TOKEN=app-token RUNS_TOKEN=runs-tok run_ci_path
  artifacts_token=$(<"$TEST_DIR/artifacts-token")
  zip_token=$(<"$TEST_DIR/zip-token")
  [[ "$artifacts_token $zip_token" == "runs-tok runs-tok" ]] || fail "got [$artifacts_token $zip_token]"
}

# The sweep hands the gate the id of the run release_merge_ci_outcome chose: the newer run (888) has
# no record and is skipped, the older one (777) is chosen. Passing an empty id or the skipped run's
# would refuse the PR, so a merge shows the chosen id arrived.
test_a_sweep_run_passes_the_chosen_runs_id_to_the_gate() {
  stage_release_pr 111 "$SHA_A" handoff success
  write_runs "$SHA_A" \
    'CI completed success 2026-10-18T11:00:00Z - - - 111 888 none' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 777'
  TRIGGER='Release Please' run_merge_step release_merge_run
  assert_exit_code 0
  assert_file_has "$TEST_DIR/merge-calls" "pr merge 111 --repo $REPO --admin --squash --match-head-commit $SHA_A"
}

# A newer failed run whose record cannot be read may be this PR's, so the sweep must not hand the
# gate the older success.
test_a_sweep_run_does_not_merge_a_pr_whose_newer_failed_run_has_an_unreadable_record() {
  stage_release_pr 111 "$SHA_A" handoff success
  write_runs "$SHA_A" \
    'CI completed failure 2026-10-18T11:00:00Z - - - 111 2 corrupt' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 1'
  TRIGGER='Release Please' run_merge_step release_merge_run
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
}

# The sweep calls the merge step inside `||`, where set -e is off, so only the step's own
# `|| return 1` after the PR fetch stops it. A response of `[]` then the PR fails the parse check
# (#174); without that return the gate reads the PR's fields past the array and merges it.
test_a_sweep_run_does_not_merge_a_pr_whose_response_is_an_array_followed_by_the_pr() {
  stage_release_pr 111 "$SHA_A" handoff success
  { echo '[]'; jq . "$TEST_DIR/pr-111.json"; } >"$TEST_DIR/pr-stream.json"
  mv "$TEST_DIR/pr-stream.json" "$TEST_DIR/pr-111.json"
  TRIGGER='Release Please' run_merge_step release_merge_run
  assert_exit_code 1
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_line "::error title=Release PR #111 (handoff) not merged::cannot parse the PR (at $SHA_A)"
  assert_out_lacks "Merging PR #111"
}

test_the_merge_step_refuses_a_pr_whose_run_id_is_empty() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" ''
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "- the CI run is unknown (no run id)"
}

test_the_merge_step_fails_when_it_is_given_no_run_id() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A"
  assert_exit_code 1
  assert_no_file "$TEST_DIR/merge-calls"
}

test_the_gate_fails_instead_of_refusing_when_the_record_lookup_fails() {
  stage_release_pr 111 "$SHA_A" handoff success
  : >"$TEST_DIR/artifacts-211.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_line "::error title=Release PR #111 (handoff) not merged::cannot check the gate: cannot list the artifacts of CI run 211 (at $SHA_A)"
}

test_the_gate_fails_instead_of_refusing_when_the_record_download_fails() {
  stage_release_pr 111 "$SHA_A" handoff success
  : >"$TEST_DIR/record-5211.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_line "::error title=Release PR #111 (handoff) not merged::cannot check the gate: cannot download the pr-record (artifact 5211) of CI run 211 (at $SHA_A)"
}

test_a_ci_triggered_run_refuses_when_the_triggering_run_id_is_unknown() {
  stage_release_pr 111 "$SHA_A" handoff success
  TRIGGER=CI BRANCH=$RELEASE_BRANCH CI_TESTED_SHA="$SHA_A" CI_RUN_ID='' run_merge_step release_merge_run
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "the CI run (unknown) that triggered this merge is not the latest CI run at $SHA_A for this PR (latest: run 211)"
}

test_a_ci_triggered_run_with_no_open_pr_from_the_branch_merges_nothing_and_succeeds() {
  write_pulls
  TRIGGER=CI BRANCH=release-please--branches--main CI_TESTED_SHA="$SHA_A" CI_RUN_ID=211 \
    run_merge_step release_merge_run
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "No open PR from release-please--branches--main in $REPO. Nothing to merge."
}

test_a_ci_triggered_run_fails_when_the_gate_cannot_fetch_the_pr() {
  stage_release_pr 111 "$SHA_A" handoff success
  rm "$TEST_DIR/pr-111.json"
  TRIGGER=CI BRANCH=release-please--branches--main CI_TESTED_SHA="$SHA_A" CI_RUN_ID=211 \
    run_merge_step release_merge_run
  assert_exit_code 1
  assert_no_file "$TEST_DIR/merge-calls"
}

test_the_merge_step_says_the_pr_state_could_not_be_read_when_the_lost_race_lookup_fails() {
  stage_release_pr 111 "$SHA_A" handoff success
  echo 'not json' >"$TEST_DIR/pr-after-failed-merge.json"
  : >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_has "and the PR's state could not be read"
}

# A failed merge's error annotation says which cause it was: gh's own reason on one line, and
# whether the PR is still open at the tested commit or its state could not be read.
test_the_merge_step_puts_the_gh_reason_in_the_error_when_the_merge_fails_and_the_pr_is_still_open() {
  stage_release_pr 111 "$SHA_A" handoff success
  echo 'GraphQL: Pull Request is not mergeable (mergePullRequest)' >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_out_line "::error title=Release PR #111 (handoff) not merged::the merge command failed at $SHA_A and the PR is still open at that commit: GraphQL: Pull Request is not mergeable (mergePullRequest)"
  assert_out_lacks "state could not be read"
}

test_the_merge_step_keeps_the_gh_stderr_in_the_log_when_the_merge_fails() {
  stage_release_pr 111 "$SHA_A" handoff success
  echo 'GraphQL: Pull Request is not mergeable (mergePullRequest)' >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_out_line "GraphQL: Pull Request is not mergeable (mergePullRequest)"
}

test_the_merge_step_says_the_state_could_not_be_read_and_gives_the_gh_reason_when_the_lost_race_lookup_fails() {
  stage_release_pr 111 "$SHA_A" handoff success
  echo 'not json' >"$TEST_DIR/pr-after-failed-merge.json"
  echo 'HTTP 405: merge conflict' >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_out_line "::error title=Release PR #111 (handoff) not merged::the merge command failed at $SHA_A and the PR's state could not be read: HTTP 405: merge conflict"
  assert_out_lacks "still open"
}

test_the_merge_step_keeps_one_line_of_the_gh_reason_and_escapes_it_in_the_error() {
  stage_release_pr 111 "$SHA_A" handoff success
  printf '  100%% conflicting\r\nsecond line\n\n' >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_out_line "::error title=Release PR #111 (handoff) not merged::the merge command failed at $SHA_A and the PR is still open at that commit: 100%25 conflicting"
  assert_out_line_count "::error" 1
  assert_out_line_count "second line" 1
}

test_the_merge_step_names_the_cause_when_gh_gives_no_reason() {
  stage_release_pr 111 "$SHA_A" handoff success
  printf '\n  \n' >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_out_line "::error title=Release PR #111 (handoff) not merged::the merge command failed at $SHA_A and the PR is still open at that commit"
}

test_the_merge_step_leaves_no_temp_files_after_a_failed_merge() {
  local left
  stage_release_pr 111 "$SHA_A" handoff success
  : >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  left=$(ls "$TEST_DIR/work")
  [[ -z "$left" ]] || fail "left [$left]"
}

test_the_merge_step_still_merges_when_the_stderr_temp_file_cannot_be_made() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step with_failing_mktemp merge-stderr release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 0
  assert_file_has "$TEST_DIR/merge-calls" "pr merge 111 "
  assert_out_line "Merged PR #111 at $SHA_A."
}

test_the_merge_step_names_the_cause_without_the_gh_reason_when_the_stderr_temp_file_cannot_be_made() {
  stage_release_pr 111 "$SHA_A" handoff success
  echo 'GraphQL: Pull Request is not mergeable (mergePullRequest)' >"$TEST_DIR/merge.error"
  run_merge_step with_failing_mktemp merge-stderr release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_file_has "$TEST_DIR/merge-calls" "pr merge 111 "
  assert_out_line "::error title=Release PR #111 (handoff) not merged::the merge command failed at $SHA_A and the PR is still open at that commit"
}

test_the_merge_step_keeps_the_gates_stderr_in_the_log_when_a_gate_lookup_fails() {
  stage_release_pr 111 "$SHA_A" handoff success
  : >"$TEST_DIR/pulls.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_line "HTTP 500"
  assert_out_line "cannot list the open PRs from release-please--branches--main"
}

test_the_merge_step_leaves_no_temp_files_after_a_failed_gate_lookup() {
  local left
  stage_release_pr 111 "$SHA_A" handoff success
  : >"$TEST_DIR/pulls.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  left=$(find "$TEST_DIR/work" -name 'gate-stderr.*')
  [[ -z "$left" ]] || fail "left [$left]"
}

test_the_merge_step_still_merges_when_the_gate_stderr_temp_file_cannot_be_made() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step with_failing_mktemp gate-stderr release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 0
  assert_file_has "$TEST_DIR/merge-calls" "pr merge 111 "
}

test_the_merge_step_still_refuses_when_the_gate_stderr_temp_file_cannot_be_made() {
  stage_release_pr 111 "$SHA_A" handoff success
  edit_pr 111 '.draft = true'
  run_merge_step with_failing_mktemp gate-stderr release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 0
  assert_out_line "::warning title=Release PR #111 (handoff) not merged::the PR is a draft (at $SHA_A)"
  assert_no_file "$TEST_DIR/merge-calls"
}

test_the_merge_step_names_no_cause_when_the_gate_stderr_temp_file_cannot_be_made() {
  stage_release_pr 111 "$SHA_A" handoff success
  : >"$TEST_DIR/pulls.error"
  run_merge_step with_failing_mktemp gate-stderr release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_out_line "::error title=Release PR #111 (handoff) not merged::cannot check the gate (at $SHA_A)"
  assert_no_file "$TEST_DIR/merge-calls"
}

test_a_ci_triggered_run_escapes_percent_in_the_branch_of_the_lookup_error() {
  rm -f "$TEST_DIR/pulls.json"
  stub_gh
  mkdir -p "$TEST_DIR/work"
  (BASE=main BOT_LOGIN=$BOT OWNER=mikelane work_dir=$TEST_DIR/work TRIGGER=CI \
    BRANCH='release-please--%0A' \
    CI_TESTED_SHA="$SHA_A" release_merge_run) >"$OUTPUT" 2>&1 || true
  assert_out_has "cannot look up the open PR from release-please--%250A in"
}

# Run without set -e, as a caller that does not set it would: only an explicit check on the lookup
# stops a failed one from reading as "no open PR".
test_a_ci_triggered_run_fails_when_the_pr_lookup_fails_even_without_set_e() {
  rm -f "$TEST_DIR/pulls.json"
  stub_gh
  mkdir -p "$TEST_DIR/work"
  (set +e; BASE=main BOT_LOGIN=$BOT OWNER=mikelane work_dir=$TEST_DIR/work TRIGGER=CI \
    BRANCH=$RELEASE_BRANCH \
    CI_TESTED_SHA="$SHA_A" release_merge_run) >"$OUTPUT" 2>&1
  # shellcheck disable=SC2034 # read by assert_exit_code in canary-report-lib.sh
  EXIT_CODE=$?
  assert_exit_code 1
  assert_out_lacks "Nothing to merge"
  assert_out_has \
    "::error title=Release merge failed::cannot look up the open PR from $RELEASE_BRANCH"
}


run_tests "$@"
