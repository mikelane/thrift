#!/usr/bin/env bash
# release_merge_run against a stub `gh`: the sweep dispatch, the single-PR path, decoy and same-second CI
# runs, and the record temp files.
# Usage: release-merge-run.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"
# shellcheck source=release-merge-stubs-lib.sh
source "$HARNESS_DIR/release-merge-stubs-lib.sh"
# shellcheck source=release-merge-step-lib.sh
source "$HARNESS_DIR/release-merge-step-lib.sh"

test_a_sweep_run_with_no_candidate_says_so_and_succeeds() {
  write_pulls
  TRIGGER='Release Please' run_merge_step release_merge_run
  assert_exit_code 0
  assert_out_has "No open release PR has passed CI at its head. Nothing to merge."
}

test_a_sweep_run_merges_every_pr_whose_ci_passed_at_its_own_head() {
  stage_release_pr 111 "$SHA_A" handoff success
  stage_release_pr 112 "$SHA_B" meter success
  TRIGGER='Release Please' run_merge_step release_merge_run
  assert_exit_code 0
  assert_file_has "$TEST_DIR/merge-calls" "pr merge 111 --repo $REPO --admin --squash --match-head-commit $SHA_A"
  assert_file_has "$TEST_DIR/merge-calls" "pr merge 112 --repo $REPO --admin --squash --match-head-commit $SHA_B"
}

test_a_sweep_run_fails_when_a_ci_lookup_fails_but_still_merges_the_other_pr() {
  stage_release_pr 111 "$SHA_A" handoff success
  stage_release_pr 112 "$SHA_B" meter success
  : >"$TEST_DIR/runs-$SHA_B.error"
  TRIGGER='Release Please' run_merge_step release_merge_run
  assert_exit_code 1
  assert_file_has "$TEST_DIR/merge-calls" "pr merge 111 "
  assert_file_lacks "$TEST_DIR/merge-calls" "pr merge 112 "
  assert_out_has "Merged PR #111 at $SHA_A."
  assert_out_has "::error title=Release PR sweep failed::"
  assert_out_lacks "Nothing to merge"
}

test_a_sweep_run_fails_when_the_ci_lookup_fails_and_nothing_else_is_a_candidate() {
  stage_release_pr 111 "$SHA_A" handoff success
  : >"$TEST_DIR/runs-$SHA_A.error"
  TRIGGER='Release Please' run_merge_step release_merge_run
  assert_exit_code 1
  assert_out_has "::error title=Release PR #111 not merged::cannot read the CI runs at $SHA_A"
}

test_a_sweep_run_that_failed_reports_the_failure_instead_of_nothing_to_merge() {
  stage_release_pr 111 "$SHA_A" handoff success
  : >"$TEST_DIR/runs-$SHA_A.error"
  TRIGGER='Release Please' run_merge_step release_merge_run
  assert_exit_code 1
  assert_out_lacks "Nothing to merge"
  assert_out_has "::error title=Release PR sweep failed::"
}

test_a_sweep_run_goes_on_to_the_next_pr_and_fails_when_one_pr_cannot_be_fetched() {
  stage_release_pr 111 "$SHA_A" handoff success
  stage_release_pr 112 "$SHA_B" meter success
  rm "$TEST_DIR/pr-111.json"
  TRIGGER='Release Please' run_merge_step release_merge_run
  assert_exit_code 1
  assert_file_has "$TEST_DIR/merge-calls" "pr merge 112 "
  assert_out_has "::error title=Release PR #111 not merged::cannot fetch the PR"
}

# A sweep calls the merge step inside `||`, where set -e is off, so only an explicit return stops a
# failed problem check from reading as "no problems".
merge_step_with_a_failing_problem_check() {
  release_merge_problems() { return 1; }
  release_merge_run
}

test_a_sweep_run_does_not_merge_a_pr_whose_problem_check_fails() {
  stage_release_pr 111 "$SHA_A" handoff success
  TRIGGER='Release Please' run_merge_step merge_step_with_a_failing_problem_check
  assert_exit_code 1
  assert_no_file "$TEST_DIR/merge-calls"
}

test_a_run_triggered_by_a_workflow_that_only_contains_release_please_takes_the_single_pr_path() {
  write_pulls
  TRIGGER='Release Please Dry Run' BRANCH=$RELEASE_BRANCH CI_TESTED_SHA="$SHA_A" CI_RUN_ID=211 \
    run_merge_step release_merge_run
  assert_exit_code 0
  assert_out_has "No open PR from $RELEASE_BRANCH in $REPO. Nothing to merge."
}

test_a_sweep_run_stays_green_when_the_gate_refuses_a_pr() {
  stage_release_pr 111 "$SHA_A" handoff success
  edit_pr 111 '.user.login = "mikelane"'
  TRIGGER='Release Please' run_merge_step release_merge_run
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
}

# The pull request files API stops at 3000 files, so the files it listed may not be all the PR changes.
test_the_merge_step_does_not_merge_a_pr_that_changes_more_files_than_the_files_api_listed() {
  stage_release_pr 111 "$SHA_A" handoff success
  edit_pr 111 '.changed_files = 3001'
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_no_file "$TEST_DIR/merge-calls"
}

test_the_merge_step_does_not_merge_a_pr_that_changes_files_when_the_files_api_listed_none() {
  stage_release_pr 111 "$SHA_A" handoff success
  edit_pr 111 '.changed_files = 1'
  echo '[]' >"$TEST_DIR/files-111.json"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_no_file "$TEST_DIR/merge-calls"
}

test_a_ci_triggered_run_merges_when_a_newer_successful_decoy_names_another_pr() {
  stage_release_pr 111 "$SHA_A" handoff success
  write_runs "$SHA_A" \
    'CI completed success 2026-10-18T11:00:00Z - - - 111 300 999@old-feature' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 211'
  run_ci_path
  assert_exit_code 0
  assert_file_has "$TEST_DIR/merge-calls" "pr merge 111 --repo $REPO --admin --squash --match-head-commit $SHA_A"
}

test_a_ci_triggered_run_merges_when_a_newer_failed_decoy_names_another_pr() {
  stage_release_pr 111 "$SHA_A" handoff success
  write_runs "$SHA_A" \
    'CI completed failure 2026-10-18T11:00:00Z - - - 111 300 999@old-feature' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 211'
  run_ci_path
  assert_exit_code 0
  assert_file_has "$TEST_DIR/merge-calls" "pr merge 111 --repo $REPO --admin --squash --match-head-commit $SHA_A"
}

test_a_ci_triggered_run_merges_over_a_failed_run_created_in_the_same_second_with_a_lower_id() {
  stage_release_pr 111 "$SHA_A" handoff success
  write_runs "$SHA_A" \
    'CI completed failure 2026-10-18T10:00:00Z - - - 111 210' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 211'
  run_ci_path
  assert_exit_code 0
  assert_file_has "$TEST_DIR/merge-calls" "pr merge 111"
}

test_a_ci_triggered_run_refuses_a_failed_run_created_in_the_same_second_with_a_higher_id() {
  stage_release_pr 111 "$SHA_A" handoff success
  write_runs "$SHA_A" \
    'CI completed failure 2026-10-18T10:00:00Z - - - 111 212' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 211'
  run_ci_path
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "(latest: run 212)"
}

test_a_ci_triggered_run_refuses_an_older_success_when_a_newer_success_exists() {
  stage_release_pr 111 "$SHA_A" handoff success
  write_runs "$SHA_A" \
    'CI completed success 2026-10-18T11:00:00Z - - - 111 300' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 211'
  run_ci_path
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "(latest: run 300)"
}

test_a_ci_triggered_run_refuses_a_run_id_written_with_a_leading_zero() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_ci_path 0211
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
}

test_a_ci_triggered_run_holds_for_a_newer_running_run_with_an_unreadable_record() {
  stage_release_pr 111 "$SHA_A" handoff success
  write_runs "$SHA_A" \
    'CI in_progress null 2026-10-18T11:00:00Z - - - 111 300 corrupt' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 211'
  run_ci_path
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "(latest: run 300)"
}

# step_with_failing_mktemp <n> <trigger>: release_merge_run as the workflow step runs it, with the
# n-th mktemp call failing, so the record check cannot make its temp file.
step_with_failing_mktemp() {
  mkdir -p "$TEST_DIR/work"
  echo 0 >"$TEST_DIR/mktemp-calls"
  FAILING_MKTEMP_CALL=$1
  run_merge_step with_nth_mktemp_failing env_step "$2"
}

with_nth_mktemp_failing() {
  mktemp() {
    local n; n=$(( $(<"$TEST_DIR/mktemp-calls") + 1 )); echo "$n" >"$TEST_DIR/mktemp-calls"
    [[ "$n" != "$FAILING_MKTEMP_CALL" ]] || return 1
    command mktemp "$@"
  }
  "$@"
}

env_step() {
  TRIGGER=$1 BRANCH=$RELEASE_BRANCH CI_TESTED_SHA="$SHA_A" CI_RUN_ID=211 release_merge_run
}

test_a_ci_triggered_run_fails_without_merging_when_the_record_temp_file_cannot_be_made() {
  stage_release_pr 111 "$SHA_A" handoff success
  step_with_failing_mktemp 2 CI
  assert_exit_code 1
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "cannot create a temp file for the pr-record of CI run 211"
}

test_a_sweep_run_fails_without_merging_when_the_record_temp_file_cannot_be_made() {
  stage_release_pr 111 "$SHA_A" handoff success
  step_with_failing_mktemp 2 'Release Please'
  assert_exit_code 1
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "cannot create a temp file for the pr-record of CI run 211"
}

test_a_ci_triggered_run_merges_when_no_temp_file_fails() {
  stage_release_pr 111 "$SHA_A" handoff success
  step_with_failing_mktemp 999 CI
  assert_exit_code 0
  assert_file_has "$TEST_DIR/merge-calls" "pr merge 111 "
}

run_tests "$@"
