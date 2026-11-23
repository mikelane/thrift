#!/usr/bin/env bash
# The merge step run against a stub `gh`: release_merge_pr_if_gate_passes (the gate, the warning
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
  assert_out_has "Merged PR #111 at $SHA_A."
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
  count=$(grep -c '^::warning title=Release PR #111 not merged::' "$OUTPUT")
  [[ "$count" == 2 ]] || fail "got $count warnings"
}

test_the_merge_step_escapes_percent_in_a_warning_annotation() {
  stage_release_pr 111 "$SHA_A" handoff success
  edit_pr 111 '.user.login = "100%25"'
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_has "::warning title=Release PR #111 not merged::the PR author is 100%2525, not $BOT"
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
  assert_out_has "::error title=Release PR #111 not merged::cannot fetch the PR"
}

test_the_merge_step_names_the_pr_in_an_error_when_the_changed_files_cannot_be_fetched() {
  stage_release_pr 111 "$SHA_A" handoff success
  rm "$TEST_DIR/files-111.json"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_has "::error title=Release PR #111 not merged::cannot fetch the changed files"
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
  assert_out_has "::error title=Release PR #111 not merged::the merge failed at $SHA_A"
}

test_the_merge_step_names_the_pr_in_an_error_when_the_changed_files_cannot_be_read() {
  stage_release_pr 111 "$SHA_A" handoff success
  echo 'not json' >"$TEST_DIR/files-111.json"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_out_has "::error title=Release PR #111 not merged::cannot read the changed files"
  assert_no_file "$TEST_DIR/merge-calls"
}

test_the_merge_step_names_the_pr_in_an_error_when_the_gate_cannot_be_checked() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step merge_step_with_a_failing_problem_check_for_pr_111
  assert_exit_code 1
  assert_out_has "::error title=Release PR #111 not merged::cannot check the gate"
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
  assert_out_has "::error title=Release PR #111 not merged::cannot check the gate"
  assert_out_lacks "Not merging PR"
  assert_no_file "$TEST_DIR/merge-calls"
}

test_the_merge_step_fails_without_merging_when_the_allowlist_cannot_be_read() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step with_config "$TEST_DIR/missing-config.json" release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_out_has "::error title=Release PR #111 not merged::cannot check the gate"
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

# with_failing_mktemp <prefix> <command>...: runs the command with a mktemp that fails for the
# template <prefix>.XXXXXX and makes every other temp file as usual. run_merge_step runs it in a
# subshell, so the stub does not outlive the test.
with_failing_mktemp() {
  FAILING_MKTEMP_PREFIX=$1
  shift
  mktemp() { [[ "$1" != */"$FAILING_MKTEMP_PREFIX".* ]] && command mktemp "$@"; }
  "$@"
}

# assert_temp_file_failure_stops_the_gate <prefix>: the gate stops at the mktemp for <prefix> with
# its own error, not at a later step reading an empty path.
assert_temp_file_failure_stops_the_gate() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step with_failing_mktemp "$1" release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_out_has "::error title=Release PR #111 not merged::cannot create a temp file"
  assert_out_lacks "cannot fetch"
  assert_out_lacks "cannot read the changed files"
  assert_no_file "$TEST_DIR/merge-calls"
}

test_the_merge_step_fails_and_names_the_pr_when_it_cannot_create_the_pr_temp_file() {
  assert_temp_file_failure_stops_the_gate pr
}

test_the_merge_step_fails_and_names_the_pr_when_it_cannot_create_the_files_temp_file() {
  assert_temp_file_failure_stops_the_gate files
}

test_the_merge_step_fails_and_names_the_pr_when_it_cannot_create_the_raw_temp_file() {
  assert_temp_file_failure_stops_the_gate raw
}

test_a_ci_triggered_run_merges_the_open_pr_from_the_triggering_branch_at_the_tested_commit() {
  stage_release_pr 111 "$SHA_A" handoff success
  TRIGGER=CI BRANCH=release-please--branches--main--components--handoff CI_TESTED_SHA="$SHA_A" CI_RUN_ID=211 \
    run_merge_step release_merge_run
  assert_exit_code 0
  assert_file_has "$TEST_DIR/merge-calls" "--match-head-commit $SHA_A"
}

# The gate checks the chosen run's own pr-record: a run whose record does not name this PR into main
# (a decoy from another base, issue #117) merges nothing. The CI path reaches the gate only for a run
# release_merge_triggering_run_is_latest accepts, so these call the gate directly.
run_ci_path() {
  TRIGGER=CI BRANCH=$RELEASE_BRANCH CI_TESTED_SHA="$SHA_A" CI_RUN_ID=${1:-211} run_merge_step release_merge_run
}

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

test_the_gate_refuses_a_run_whose_record_names_another_pr() {
  stage_release_pr 111 "$SHA_A" handoff success
  write_record 211 999@old-feature
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "::warning title=Release PR #111 not merged::the CI run 211 has a pr-record naming {\"number\":999,\"base\":\"old-feature\"} (at $SHA_A)"
}

test_the_gate_refuses_a_run_with_no_record() {
  stage_release_pr 111 "$SHA_A" handoff success
  write_record 211 none
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "::warning title=Release PR #111 not merged::the CI run 211 has no pr-record artifact (at $SHA_A)"
}

test_the_gate_refuses_a_run_with_an_unreadable_record() {
  stage_release_pr 111 "$SHA_A" handoff success
  write_record 211 corrupt
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "::warning title=Release PR #111 not merged::the CI run 211 has an unreadable pr-record (at $SHA_A)"
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
  assert_out_has "::error title=Release PR #111 not merged::cannot check the gate: cannot list the artifacts of CI run 211"
}

test_the_gate_fails_instead_of_refusing_when_the_record_download_fails() {
  stage_release_pr 111 "$SHA_A" handoff success
  : >"$TEST_DIR/record-5211.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "::error title=Release PR #111 not merged::cannot check the gate: cannot download the pr-record (artifact 5211) of CI run 211"
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
  TRIGGER=CI BRANCH=release-please--branches--main--components--handoff CI_TESTED_SHA="$SHA_A" CI_RUN_ID=211 \
    run_merge_step release_merge_run
  assert_exit_code 0
  assert_no_file "$TEST_DIR/merge-calls"
  assert_out_has "No open PR from release-please--branches--main--components--handoff in $REPO. Nothing to merge."
}

test_a_ci_triggered_run_fails_when_the_gate_cannot_fetch_the_pr() {
  stage_release_pr 111 "$SHA_A" handoff success
  rm "$TEST_DIR/pr-111.json"
  TRIGGER=CI BRANCH=release-please--branches--main--components--handoff CI_TESTED_SHA="$SHA_A" CI_RUN_ID=211 \
    run_merge_step release_merge_run
  assert_exit_code 1
  assert_no_file "$TEST_DIR/merge-calls"
}

test_the_merge_step_says_the_pr_state_could_not_be_read_when_the_lost_race_lookup_fails() {
  stage_release_pr 111 "$SHA_A" handoff success
  echo 'not json' >"$TEST_DIR/pr-after-failed-merge.json"
  : >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_has "or its state could not be read"
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

merge_step_with_a_failing_problem_check_for_pr_111() {
  release_merge_problems() { return 1; }
  release_merge_pr_if_gate_passes 111 "$SHA_A" 211
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
