#!/usr/bin/env bash
# The gate and the merge of one release PR against a stub `gh`: release_merge_pr_if_gate_passes (the
# warning and error annotations, the merge, the lost race, the temp files).
# Usage: release-merge-step.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"
# shellcheck source=release-merge-stubs-lib.sh
source "$HARNESS_DIR/release-merge-stubs-lib.sh"
# shellcheck source=release-merge-step-lib.sh
source "$HARNESS_DIR/release-merge-step-lib.sh"

test_the_merge_step_squash_merges_a_pr_that_passes_the_gate_pinned_to_the_tested_commit() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 0
  assert_file_has "$TEST_DIR/merge-calls" "pr merge 111 --repo $REPO --admin --squash --match-head-commit $SHA_A"
  assert_out_has "Merging PR #111 at $SHA_A."
}

test_the_merge_step_logs_each_reason_and_returns_success_without_merging_a_pr_the_gate_refuses() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_B" 211
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "Not merging PR #111 at $SHA_B:"
  assert_out_has "- the PR head is $SHA_A but CI tested $SHA_B"
}

test_the_merge_step_puts_the_tested_commit_in_each_warning_annotation() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_B" 211
  assert_out_has "but CI tested $SHA_B (at $SHA_B)"
}

test_the_merge_step_logs_a_merged_line_after_a_successful_merge() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_line "Merged PR #111 at $SHA_A."
}

test_the_merge_step_emits_a_notice_annotation_after_a_successful_merge() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_line "::notice title=Release PR #111 (handoff) merged::Merged PR #111 at $SHA_A."
}

test_the_merge_step_emits_a_notice_annotation_when_the_pr_was_closed_without_merging() {
  stage_release_pr 111 "$SHA_A" handoff success
  jq '.state = "closed" | .merged = false' "$TEST_DIR/pr-111.json" \
    >"$TEST_DIR/pr-after-failed-merge.json"
  : >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 0
  assert_out_line "::notice title=Release PR #111 (handoff) not merged::PR #111 was closed without being merged."
}

test_the_merge_step_emits_no_notice_when_another_run_merged_the_pr_first() {
  stage_release_pr 111 "$SHA_A" handoff success
  jq '.state = "closed" | .merged = true' "$TEST_DIR/pr-111.json" >"$TEST_DIR/pr-after-failed-merge.json"
  : >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 0
  assert_out_line "PR #111 is closed: another run merged it first."
  assert_out_lacks "::notice"
}

test_the_merge_step_keeps_the_gh_stderr_in_the_log_when_another_run_merged_the_pr_first() {
  stage_release_pr 111 "$SHA_A" handoff success
  jq '.state = "closed" | .merged = true' "$TEST_DIR/pr-111.json" >"$TEST_DIR/pr-after-failed-merge.json"
  echo 'GraphQL: Pull Request is already merged' >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 0
  assert_out_line "GraphQL: Pull Request is already merged"
}

test_the_merge_step_emits_no_notice_when_the_merge_fails() {
  stage_release_pr 111 "$SHA_A" handoff success
  : >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_out_lacks "::notice"
}

test_the_merge_step_emits_no_notice_when_the_gate_refuses() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_B" 211
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_lacks "::notice"
}

test_the_merge_step_does_not_log_a_merged_line_when_the_merge_fails() {
  stage_release_pr 111 "$SHA_A" handoff success
  : >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_lacks "Merged PR"
}

test_the_merge_step_writes_one_warning_annotation_per_reason() {
  local count
  stage_release_pr 111 "$SHA_A" handoff success
  edit_pr 111 '.state = "closed" | .draft = true'
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  count=$(grep -c '^::warning title=Release PR #111 (handoff) not merged::' "$OUTPUT")
  [[ "$count" == 2 ]] || fail "got $count warnings"
}

# A combined release PR refused for a stray plugin file gets a warning naming that file (#207, #215).
test_the_merge_step_names_the_stray_file_in_the_warning_for_a_combined_pr() {
  stage_release_pr 111 "$SHA_A" handoff success
  edit_pr 111 '.head.ref = "release-please--branches--main" | .changed_files = 2'
  echo '[{"filename":"plugins/handoff/CHANGELOG.md"},{"filename":"plugins/reread/hooks/register.tsx"}]' \
    >"$TEST_DIR/files-111.json"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_has "::warning title=Release PR #111 (handoff%2C reread) not merged::plugins/reread/hooks/register.tsx is not a file a release PR changes (at $SHA_A)"
}

test_the_merge_step_escapes_percent_in_a_warning_annotation() {
  stage_release_pr 111 "$SHA_A" handoff success
  edit_pr 111 '.user.login = "100%25"'
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_has "::warning title=Release PR #111 (handoff) not merged::the PR author is 100%2525, not $BOT"
}

test_the_merge_step_starts_each_logged_reason_with_a_dash_so_pr_text_is_no_workflow_command() {
  local command_lines
  stage_release_pr 111 "$SHA_A" handoff success
  edit_pr 111 '.user.login = "::error::x"'
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  command_lines=$(grep -c '^::error::' "$OUTPUT")
  [[ "$command_lines" == 0 ]] || fail "$command_lines line(s) of output start a workflow command"
  assert_out_has "- the PR author is ::error::x, not $BOT"
}

test_the_merge_step_fails_when_the_pr_cannot_be_fetched() {
  stage_release_pr 111 "$SHA_A" handoff success
  rm "$TEST_DIR/pr-111.json"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_no_file "$TEST_DIR/merge-calls"
}

test_the_merge_step_names_the_pr_in_an_error_when_it_cannot_be_fetched() {
  stage_release_pr 111 "$SHA_A" handoff success
  rm "$TEST_DIR/pr-111.json"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_line "::error title=Release PR #111 not merged::cannot fetch the PR (at $SHA_A)"
}

test_the_merge_step_names_the_pr_in_an_error_when_the_changed_files_cannot_be_fetched() {
  stage_release_pr 111 "$SHA_A" handoff success
  rm "$TEST_DIR/files-111.json"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_line "::error title=Release PR #111 not merged::cannot fetch the changed files (at $SHA_A)"
}

test_the_merge_step_fails_when_the_changed_files_cannot_be_fetched() {
  stage_release_pr 111 "$SHA_A" handoff success
  rm "$TEST_DIR/files-111.json"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_no_file "$TEST_DIR/merge-calls"
}

test_the_merge_step_does_not_merge_when_the_files_fetch_fails_even_without_pipefail() {
  stage_release_pr 111 "$SHA_A" handoff success
  rm "$TEST_DIR/files-111.json"
  stub_gh
  mkdir -p "$TEST_DIR/work"
  # canary-report-lib.sh sets pipefail for every test; turn it off so this runs without it.
  (set +o pipefail; set -eu; BASE=main BOT_LOGIN=$BOT work_dir=$TEST_DIR/work RELEASE_MERGE_CONFIG=$CONFIG release_merge_pr_if_gate_passes 111 "$SHA_A" 211) >"$OUTPUT" 2>&1
  # shellcheck disable=SC2034 # read by assert_exit_code in canary-report-lib.sh
  EXIT_CODE=$?
  assert_exit_code 1
  assert_no_file "$TEST_DIR/merge-calls"
}

test_the_merge_step_treats_a_failed_merge_of_a_pr_that_is_gone_as_a_lost_race() {
  stage_release_pr 111 "$SHA_A" handoff success
  jq '.state = "closed" | .merged = true' "$TEST_DIR/pr-111.json" \
    >"$TEST_DIR/pr-after-failed-merge.json"
  : >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 0
  assert_out_has "PR #111 is closed: another run merged it first."
}

test_the_merge_step_fails_when_the_merge_fails_and_the_pr_is_still_open_at_the_tested_commit() {
  stage_release_pr 111 "$SHA_A" handoff success
  : >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_file_has "$TEST_DIR/merge-calls" "pr merge 111 --repo $REPO --admin --squash --match-head-commit $SHA_A"
}

test_the_merge_step_closes_a_failed_merge_with_an_error_annotation_naming_the_pr() {
  stage_release_pr 111 "$SHA_A" handoff success
  : >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_has "::error title=Release PR #111 (handoff) not merged::the merge command failed at $SHA_A"
}

# A pr.json that is not one JSON object is an unreadable fetch, like a files response that is not
# JSON: one error annotation, a failed job, no refusal reasons built from empty fields, no merge.
assert_unparseable_pr_fails_with_one_error() {
  stage_release_pr 111 "$SHA_A" handoff success
  printf '%s' "$1" >"$TEST_DIR/pr-111.json"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_out_line "::error title=Release PR #111 (handoff) not merged::cannot parse the PR (at $SHA_A)"
  assert_out_line_count "::error" 1
  assert_out_lacks "::warning"
  assert_out_lacks "not open"
  assert_no_file "$TEST_DIR/merge-calls"
}

test_the_merge_step_fails_with_one_error_when_the_pr_is_not_json() {
  assert_unparseable_pr_fails_with_one_error 'not json'
}

test_the_merge_step_fails_with_one_error_when_the_pr_is_empty() {
  assert_unparseable_pr_fails_with_one_error ''
}

test_the_merge_step_fails_with_one_error_when_the_pr_is_json_null() {
  assert_unparseable_pr_fails_with_one_error 'null'
}

test_the_merge_step_fails_with_one_error_when_the_pr_is_a_json_array() {
  assert_unparseable_pr_fails_with_one_error '[]'
}

test_the_merge_step_names_the_pr_in_an_error_when_the_changed_files_cannot_be_read() {
  stage_release_pr 111 "$SHA_A" handoff success
  echo 'not json' >"$TEST_DIR/files-111.json"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_out_line "::error title=Release PR #111 not merged::cannot read the changed files (at $SHA_A)"
  assert_no_file "$TEST_DIR/merge-calls"
}

merge_step_with_a_failing_problem_check_for_pr_111() {
  release_merge_problems() { return 1; }
  release_merge_pr_if_gate_passes 111 "$SHA_A" 211
}

test_the_merge_step_names_the_pr_in_an_error_when_the_gate_cannot_be_checked() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step merge_step_with_a_failing_problem_check_for_pr_111
  assert_exit_code 1
  assert_out_line "::error title=Release PR #111 (handoff) not merged::cannot check the gate (at $SHA_A)"
  assert_no_file "$TEST_DIR/merge-calls"
}

# with_config <path> <command>...: runs the command with the allowlist read from <path>.
with_config() {
  RELEASE_MERGE_CONFIG=$1
  shift
  "$@"
}

# The next two run the real gate: a lookup that fails inside it must fail the step (the job turns
# red) and still not merge, not read as a refusal that leaves the job green.
test_the_merge_step_fails_without_merging_when_the_open_prs_cannot_be_listed() {
  stage_release_pr 111 "$SHA_A" handoff success
  : >"$TEST_DIR/pulls.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_out_line "::error title=Release PR #111 (handoff) not merged::cannot check the gate: cannot list the open PRs from release-please--branches--main (at $SHA_A)"
  assert_out_lacks "Not merging PR"
  assert_no_file "$TEST_DIR/merge-calls"
}

test_the_merge_step_fails_without_merging_when_the_allowlist_cannot_be_read() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step with_config "$TEST_DIR/missing-config.json" release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_out_line "::error title=Release PR #111 (handoff) not merged::cannot check the gate: cannot read the allowlist from $TEST_DIR/missing-config.json (at $SHA_A)"
  assert_out_lacks "Not merging PR"
  assert_no_file "$TEST_DIR/merge-calls"
}

test_the_merge_step_does_not_log_a_merged_line_after_a_lost_race() {
  stage_release_pr 111 "$SHA_A" handoff success
  jq '.state = "closed" | .merged = true' "$TEST_DIR/pr-111.json" \
    >"$TEST_DIR/pr-after-failed-merge.json"
  : >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_lacks "Merged PR"
  assert_out_has "PR #111 is closed: another run merged it first."
}

test_the_merge_step_stays_green_and_says_so_when_the_pr_was_closed_without_merging() {
  stage_release_pr 111 "$SHA_A" handoff success
  jq '.state = "closed" | .merged = false' "$TEST_DIR/pr-111.json" \
    >"$TEST_DIR/pr-after-failed-merge.json"
  : >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 0
  assert_out_has "PR #111 was closed without being merged."
  assert_out_lacks "Merged PR"
}

test_the_merge_step_does_not_log_an_error_annotation_after_a_successful_merge() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_lacks "::error"
}

test_the_merge_step_does_not_log_an_error_annotation_when_the_gate_refuses_a_pr() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_B" 211
  assert_out_lacks "::error"
}

test_the_merge_step_escapes_percent_signs_in_an_error_annotation() {
  run_merge_step release_merge_fail 111 '100% broken'
  assert_exit_code 1
  assert_out_has "::error title=Release PR #111 not merged::100%25 broken"
}

test_the_merge_step_leaves_no_temp_files_after_a_merge() {
  local left
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_file_has "$TEST_DIR/merge-calls" "pr merge 111 "
  left=$(ls "$TEST_DIR/work")
  [[ -z "$left" ]] || fail "left [$left]"
}

# assert_temp_file_failure_stops_the_gate <prefix> <what>: the gate stops at the mktemp for <prefix>
# with an error naming <what> and the tested commit, not at a later step reading an empty path.
assert_temp_file_failure_stops_the_gate() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step with_failing_mktemp "$1" release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_out_line "::error title=Release PR #111 not merged::cannot create a temp file for $2 (at $SHA_A)"
  assert_out_lacks "cannot fetch"
  assert_out_lacks "cannot read the changed files"
  assert_no_file "$TEST_DIR/merge-calls"
}

test_the_merge_step_fails_and_names_the_pr_when_it_cannot_create_the_pr_temp_file() {
  assert_temp_file_failure_stops_the_gate pr 'the PR'
}

test_the_merge_step_fails_and_names_the_pr_when_it_cannot_create_the_files_temp_file() {
  assert_temp_file_failure_stops_the_gate files 'the changed file names'
}

test_the_merge_step_fails_and_names_the_pr_when_it_cannot_create_the_raw_temp_file() {
  assert_temp_file_failure_stops_the_gate raw 'the files API response'
}

test_a_ci_triggered_run_merges_the_open_pr_from_the_triggering_branch_at_the_tested_commit() {
  stage_release_pr 111 "$SHA_A" handoff success
  TRIGGER=CI BRANCH=release-please--branches--main CI_TESTED_SHA="$SHA_A" CI_RUN_ID=211 \
    run_merge_step release_merge_run
  assert_exit_code 0
  assert_file_has "$TEST_DIR/merge-calls" "--match-head-commit $SHA_A"
}


run_tests "$@"
