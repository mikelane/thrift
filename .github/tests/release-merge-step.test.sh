#!/usr/bin/env bash
# The merge step run against a stub `gh`: release_merge_merge_if_gate_passes (the gate, the warning
# annotations, the merge) and release_merge_run (the sweep and single-PR dispatch).
# Usage: release-merge-step.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"
# shellcheck source=release-merge-stubs-lib.sh
source "$HARNESS_DIR/release-merge-stubs-lib.sh"

# run_merge_step <command>...: runs a lib function the way the workflow step does (set -euo
# pipefail, the step's variables), leaving its output in $OUTPUT and its status in $EXIT_CODE.
run_merge_step() {
  mkdir -p "$TEST_DIR/work"
  stub_gh
  (
    set -euo pipefail
    BASE=main BOT_LOGIN=$BOT OWNER=mikelane work_dir=$TEST_DIR/work RELEASE_MERGE_CONFIG=$CONFIG "$@"
  ) >"$OUTPUT" 2>&1
  # shellcheck disable=SC2034 # read by assert_exit_code in canary-report-lib.sh
  EXIT_CODE=$?
}

test_the_merge_step_squash_merges_a_pr_that_passes_the_gate_pinned_to_the_tested_commit() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step release_merge_merge_if_gate_passes 111 "$SHA_A"
  assert_exit_code 0
  assert_file_has "$TEST_DIR/merge-calls" "pr merge 111 --repo $REPO --admin --squash --match-head-commit $SHA_A"
  assert_out_has "Merging PR #111 at $SHA_A."
}

test_the_merge_step_logs_each_reason_and_returns_success_without_merging_a_pr_the_gate_refuses() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step release_merge_merge_if_gate_passes 111 "$SHA_B"
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "Not merging PR #111:"
  assert_out_has "- the PR head is $SHA_A but CI tested $SHA_B"
}

test_the_merge_step_writes_one_warning_annotation_per_reason() {
  local count
  stage_release_pr 111 "$SHA_A" handoff success
  edit_pr 111 '.state = "closed" | .draft = true'
  run_merge_step release_merge_merge_if_gate_passes 111 "$SHA_A"
  count=$(grep -c '^::warning title=Release PR #111 not merged::' "$OUTPUT")
  [[ "$count" == 2 ]] || fail "got $count warnings"
}

test_the_merge_step_escapes_percent_in_a_warning_annotation() {
  stage_release_pr 111 "$SHA_A" handoff success
  edit_pr 111 '.user.login = "100%25"'
  run_merge_step release_merge_merge_if_gate_passes 111 "$SHA_A"
  assert_out_has "::warning title=Release PR #111 not merged::the PR author is 100%2525, not $BOT"
}

test_the_merge_step_starts_each_logged_reason_with_a_dash_so_pr_text_is_no_workflow_command() {
  local command_lines
  stage_release_pr 111 "$SHA_A" handoff success
  edit_pr 111 '.user.login = "::error::x"'
  run_merge_step release_merge_merge_if_gate_passes 111 "$SHA_A"
  command_lines=$(grep -c '^::error::' "$OUTPUT")
  [[ "$command_lines" == 0 ]] || fail "$command_lines line(s) of output start a workflow command"
  assert_out_has "- the PR author is ::error::x, not $BOT"
}

test_the_merge_step_fails_when_the_pr_cannot_be_fetched() {
  stage_release_pr 111 "$SHA_A" handoff success
  rm "$TEST_DIR/pr-111.json"
  run_merge_step release_merge_merge_if_gate_passes 111 "$SHA_A"
  assert_exit_code 1
  assert_no_file "$TEST_DIR/merge-calls"
}

test_the_merge_step_fails_when_the_changed_files_cannot_be_fetched() {
  stage_release_pr 111 "$SHA_A" handoff success
  rm "$TEST_DIR/files-111.json"
  run_merge_step release_merge_merge_if_gate_passes 111 "$SHA_A"
  assert_exit_code 1
  assert_no_file "$TEST_DIR/merge-calls"
}

test_the_merge_step_does_not_merge_when_the_files_fetch_fails_even_without_pipefail() {
  stage_release_pr 111 "$SHA_A" handoff success
  rm "$TEST_DIR/files-111.json"
  stub_gh
  mkdir -p "$TEST_DIR/work"
  # canary-report-lib.sh sets pipefail for every test; turn it off so this runs without it.
  (set +o pipefail; set -eu; BASE=main BOT_LOGIN=$BOT work_dir=$TEST_DIR/work RELEASE_MERGE_CONFIG=$CONFIG release_merge_merge_if_gate_passes 111 "$SHA_A") >"$OUTPUT" 2>&1
  # shellcheck disable=SC2034 # read by assert_exit_code in canary-report-lib.sh
  EXIT_CODE=$?
  assert_exit_code 1
  assert_no_file "$TEST_DIR/merge-calls"
}

test_the_merge_step_treats_a_failed_merge_of_a_pr_that_is_gone_as_a_lost_race() {
  stage_release_pr 111 "$SHA_A" handoff success
  jq '.state = "closed"' "$TEST_DIR/pr-111.json" >"$TEST_DIR/pr-after-failed-merge.json"
  : >"$TEST_DIR/merge.error"
  run_merge_step release_merge_merge_if_gate_passes 111 "$SHA_A"
  assert_exit_code 0
  assert_out_has "PR #111 is closed: another run merged it first."
}

test_the_merge_step_fails_when_the_merge_fails_and_the_pr_is_still_open_at_the_tested_commit() {
  stage_release_pr 111 "$SHA_A" handoff success
  : >"$TEST_DIR/merge.error"
  run_merge_step release_merge_merge_if_gate_passes 111 "$SHA_A"
  assert_exit_code 1
  assert_file_has "$TEST_DIR/merge-calls" "pr merge 111 --repo $REPO --admin --squash --match-head-commit $SHA_A"
}

test_the_merge_step_leaves_no_temp_files_after_a_merge() {
  local left
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step release_merge_merge_if_gate_passes 111 "$SHA_A"
  assert_file_has "$TEST_DIR/merge-calls" "pr merge 111 "
  left=$(ls "$TEST_DIR/work")
  [[ -z "$left" ]] || fail "left [$left]"
}

test_a_ci_triggered_run_merges_the_open_pr_from_the_triggering_branch_at_the_tested_commit() {
  stage_release_pr 111 "$SHA_A" handoff success
  TRIGGER=CI BRANCH=release-please--branches--main--components--handoff CI_TESTED_SHA="$SHA_A" \
    run_merge_step release_merge_run
  assert_exit_code 0
  assert_file_has "$TEST_DIR/merge-calls" "--match-head-commit $SHA_A"
}

test_a_ci_triggered_run_with_no_open_pr_from_the_branch_merges_nothing_and_succeeds() {
  write_pulls
  TRIGGER=CI BRANCH=release-please--branches--main--components--handoff CI_TESTED_SHA="$SHA_A" \
    run_merge_step release_merge_run
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "No open PR from release-please--branches--main--components--handoff in $REPO. Nothing to merge."
}

test_a_ci_triggered_run_fails_when_the_gate_cannot_fetch_the_pr() {
  stage_release_pr 111 "$SHA_A" handoff success
  rm "$TEST_DIR/pr-111.json"
  TRIGGER=CI BRANCH=release-please--branches--main--components--handoff CI_TESTED_SHA="$SHA_A" \
    run_merge_step release_merge_run
  assert_exit_code 1
  assert_no_file "$TEST_DIR/merge-calls"
}

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
}

test_a_sweep_run_fails_when_the_ci_lookup_fails_and_nothing_else_is_a_candidate() {
  stage_release_pr 111 "$SHA_A" handoff success
  : >"$TEST_DIR/runs-$SHA_A.error"
  TRIGGER='Release Please' run_merge_step release_merge_run
  assert_exit_code 1
  assert_out_has "Cannot read the CI runs of PR #111 at $SHA_A;"
  assert_out_has "No open release PR has passed CI at its head. Nothing to merge."
}

test_a_sweep_run_goes_on_to_the_next_pr_and_fails_when_one_pr_cannot_be_fetched() {
  stage_release_pr 111 "$SHA_A" handoff success
  stage_release_pr 112 "$SHA_B" meter success
  rm "$TEST_DIR/pr-111.json"
  TRIGGER='Release Please' run_merge_step release_merge_run
  assert_exit_code 1
  assert_file_has "$TEST_DIR/merge-calls" "pr merge 112 "
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
  TRIGGER='Release Please Dry Run' BRANCH=$RELEASE_BRANCH CI_TESTED_SHA="$SHA_A" \
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

run_tests "$@"
