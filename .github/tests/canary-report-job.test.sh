#!/usr/bin/env bash
# The report job: which logs become issues, the cap, the dedupe, the version and the issue creation.
# Usage: canary-report-job.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"

# ---------------------------------------------------------------------------------------------
# Which logs become issues
# ---------------------------------------------------------------------------------------------
test_live_run_opens_an_issue_titled_with_the_version_and_plugin() {
  add_failure_log handoff
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create --title Claude Code 2.1.300 breaks handoff --body-file' 1
  assert_gh_call_count 'api repos/o/r/contents/plugins?ref=abc123 ' 1
  assert_out_lacks 'dry run'
}
test_dry_run_prints_the_issue_instead_of_opening_it() {
  add_failure_log handoff 'tsc error TS2322'
  run_report true
  assert_exit_code 0
  assert_out_has 'dry run: would open an issue titled: Claude Code 2.1.300 breaks handoff'
  assert_out_has 'TS2322'
  assert_gh_call_count 'issue create' 0
}
test_dry_run_with_no_failure_logs_says_there_is_nothing_to_open() {
  run_report true
  assert_exit_code 0
  assert_out_has 'dry run: no failure logs, nothing to open'
}
test_live_run_with_no_failure_logs_opens_nothing_and_passes() {
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create' 0
}
test_issue_body_names_the_canary_and_links_the_run() {
  add_failure_log handoff
  run_report true
  assert_file_has "$TEST_DIR/issue-body.md" "The canary ran handoff's checks against Claude Code 2.1.300"
  assert_file_has "$TEST_DIR/issue-body.md" 'https://github.com/o/r/actions/runs/42'
}
test_log_with_a_bad_name_is_skipped_and_the_job_fails_but_a_good_log_is_opened() {
  add_failure_log handoff
  add_failure_log 'Bad Name'
  add_failure_log -lead
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 1
  assert_gh_call_count 'issue create --title Claude Code 2.1.300 breaks handoff ' 1
  assert_out_has 'Skipping an untrusted log: Bad\ Name'
  assert_out_has 'Skipping an untrusted log: -lead'
}
test_log_named_after_a_unicode_lookalike_is_skipped() {
  add_failure_log "hand$(printf '\xc3\xb6')ff"
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Skipping an untrusted log'
}
# The repository lists both names, so only the name pattern stands between them and an issue.
test_log_whose_name_breaks_the_name_pattern_is_skipped_even_when_the_repository_lists_it() {
  printf '%s\n' Upper -lead > "$GH_PLUGINS"
  add_failure_log Upper
  add_failure_log -lead
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Skipping an untrusted log: Upper'
  assert_out_has 'Skipping an untrusted log: -lead'
}
test_log_name_with_an_embedded_newline_is_skipped_and_cannot_start_a_workflow_command() {
  add_failure_log $'a\n::error::forged'
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  ! grep -q '^::error::' "$OUTPUT" || fail 'a forged workflow command starts a line of output'
}
test_log_name_that_only_matches_after_command_substitution_trims_a_newline_is_skipped() {
  add_failure_log $'handoff\n'
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Skipping an untrusted log'
}
test_log_for_a_plugin_missing_from_the_repository_is_skipped() {
  add_failure_log ghost
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Skipping an untrusted log: ghost'
}
test_log_named_after_a_prefix_of_a_real_plugin_is_skipped() {
  add_failure_log hand
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Skipping an untrusted log: hand'
}
test_symlinked_log_is_skipped() {
  echo secret > "$TEST_DIR/target"
  ln -s "$TEST_DIR/target" "$FAILURE_LOG_DIR/handoff.txt"
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Skipping an untrusted log: handoff'
}
test_log_that_is_a_directory_is_skipped() {
  mkdir "$FAILURE_LOG_DIR/handoff.txt"
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Skipping an untrusted log: handoff'
}
test_failure_to_list_the_repository_plugins_opens_nothing_and_fails() {
  add_failure_log handoff
  run_report false GH_API_FAIL=1
  assert_exit_code 1
  assert_out_has 'Failed to list the plugins in the repository, so no issue can be opened. Rerun the job.'
  assert_gh_call_count 'issue create' 0
}

# ---------------------------------------------------------------------------------------------
# The cap and the dedupe
# ---------------------------------------------------------------------------------------------
test_cap_opens_the_maximum_and_fails_naming_the_rest() {
  local i
  for i in 1 2 3 4 5 6 7 8; do add_failure_log "p$i" x; done
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' "$MAX_ISSUES"
  assert_out_has "Opened $MAX_ISSUES issues, the cap; $((8 - MAX_ISSUES)) more failing plugins were left unopened"
}
test_dry_run_cap_says_would_open() {
  local i
  for i in 1 2 3 4 5 6 7 8; do add_failure_log "p$i" x; done
  run_report true
  assert_exit_code 1
  assert_out_has "Would open $MAX_ISSUES issues, the cap; $((8 - MAX_ISSUES)) more failing plugins were left unopened"
  assert_gh_call_count 'issue create' 0
}
test_bad_name_and_cap_together_fail_and_still_open_the_maximum() {
  local i
  for i in 1 2 3 4 5 6 7; do add_failure_log "p$i" x; done
  add_failure_log BAD x
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' "$MAX_ISSUES"
  assert_out_has 'Skipping an untrusted log: BAD'
  assert_out_has "Opened $MAX_ISSUES issues, the cap; $((7 - MAX_ISSUES)) more failing plugins were left unopened"
}
test_open_issue_whose_title_merely_contains_the_canary_title_does_not_block_a_new_one() {
  add_failure_log handoff
  echo 'Re: Claude Code 2.1.300 breaks handoff badly' >> "$GH_OPEN_TITLES"
  echo 'Claude Code 2.1.300 breaks handoff-extras' >> "$GH_OPEN_TITLES"
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create' 1
}
test_open_issue_for_another_version_does_not_block_a_new_one() {
  add_failure_log handoff
  echo 'Claude Code 2.1.299 breaks handoff' >> "$GH_OPEN_TITLES"
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create --title Claude Code 2.1.300 breaks handoff ' 1
}
test_failure_to_list_issues_skips_that_plugin_and_fails() {
  add_failure_log handoff
  run_report false GH_LIST_FAIL=1
  assert_exit_code 1
  assert_out_has 'Failed to list issues for Claude Code 2.1.300 breaks handoff'
  assert_gh_call_count 'issue create' 0
}

test_cap_count_after_a_failed_creation_counts_only_the_issues_that_opened() {
  local plugin
  for plugin in a b c d; do add_failure_log "$plugin" x; done
  echo 'Claude Code 2.1.300 breaks a' > "$GH_FAIL_CREATE_TITLES"
  run_report false MAX_ISSUES=2
  assert_out_has 'Opened 2 issues, the cap; 1 more failing plugins were left unopened: d'
}
test_failed_issue_creation_does_not_use_up_the_cap() {
  local plugin
  for plugin in a b c; do add_failure_log "$plugin" x; done
  echo 'Claude Code 2.1.300 breaks a' > "$GH_FAIL_CREATE_TITLES"
  run_report false MAX_ISSUES=2
  assert_exit_code 1
  assert_gh_call_count 'issue create --title Claude Code 2.1.300 breaks b' 1
  assert_gh_call_count 'issue create --title Claude Code 2.1.300 breaks c' 1
  assert_out_lacks 'left unopened'
}

test_dedupe_finds_an_open_issue_beyond_the_first_page_of_results() {
  local i
  for i in $(seq 1 40); do echo "Unrelated issue $i" >> "$GH_OPEN_TITLES"; done
  add_failure_log handoff
  mark_issue_open handoff
  run_report false
  assert_gh_call_count 'issue create' 0
}
test_dedupe_reads_the_issue_listing_and_not_the_lagging_search_index() {
  add_failure_log handoff
  mark_issue_open handoff
  run_report false
  assert_gh_call_count 'issue create' 0
  ! grep -q -- '--search' "$GH_CALLS" || fail 'the dedupe queried the search index'
}
test_dedupe_runs_before_the_cap_so_an_open_issue_is_not_counted_as_left_unopened() {
  local plugin
  for plugin in a b c d e f; do add_failure_log "$plugin" x; done
  mark_issue_open f
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create' 5
  assert_out_lacks 'left unopened'
}
test_dry_run_reports_an_issue_that_is_already_open() {
  add_failure_log handoff
  mark_issue_open handoff
  run_report true
  assert_exit_code 0
  assert_out_has 'dry run: issue already open for Claude Code 2.1.300 breaks handoff'
}
test_open_issue_with_the_exact_title_is_not_opened_again() {
  add_failure_log handoff
  mark_issue_open handoff
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Issue already open for Claude Code 2.1.300 breaks handoff; not opening another.'
}

# ---------------------------------------------------------------------------------------------
# The marker and the version
# ---------------------------------------------------------------------------------------------
test_missing_checked_marker_fails_with_a_message_even_when_there_are_no_logs() {
  rm "$FAILURE_LOG_DIR/checked"
  run_report true
  assert_exit_code 1
  assert_out_has 'did not reach the plugin checks'
}
test_missing_checked_marker_still_opens_the_issues_it_has_logs_for_and_fails() {
  rm "$FAILURE_LOG_DIR/checked"
  add_failure_log handoff
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 1
}
test_empty_version_opens_nothing_and_fails() {
  : > "$FAILURE_LOG_DIR/claude-version"
  add_failure_log handoff
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Unexpected Claude Code version'
}
test_version_file_holding_a_second_line_opens_nothing_and_fails() {
  printf '2.1.300\nevil' > "$FAILURE_LOG_DIR/claude-version"
  add_failure_log handoff
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Unexpected Claude Code version'
}
test_missing_version_file_opens_nothing_and_fails() {
  rm "$FAILURE_LOG_DIR/claude-version"
  add_failure_log handoff
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Unexpected Claude Code version'
}
test_version_with_a_suffix_is_rejected() {
  echo '2.1.300-beta' > "$FAILURE_LOG_DIR/claude-version"
  run_report true
  assert_exit_code 1
  assert_out_has 'Unexpected Claude Code version'
}
test_version_with_one_component_is_accepted() {
  echo 3 > "$FAILURE_LOG_DIR/claude-version"
  add_failure_log handoff
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create --title Claude Code 3 breaks handoff' 1
}
# %q does not escape ':', so a version that starts with '::' is safe only because the text before
# it on the same line keeps the runner from reading the line as a workflow command.
test_invalid_version_is_printed_after_a_text_prefix_so_it_cannot_start_a_workflow_command() {
  printf '::error::forged\n::warning::forged' > "$FAILURE_LOG_DIR/claude-version"
  run_report true
  assert_exit_code 1
  assert_out_has 'Unexpected Claude Code version: '
  ! grep -q '^::' "$OUTPUT" || fail 'a line of output starts with ::'
  assert_out_has 'Canary summary: mode=dry-run version='
}

test_invalid_version_dry_run_does_not_claim_there_were_no_failure_logs() {
  echo 'Claude Code 2.1.300' > "$FAILURE_LOG_DIR/claude-version"
  add_failure_log handoff
  run_report true
  assert_exit_code 1
  assert_out_has 'failing_logs=1'
  assert_out_lacks 'no failure logs'
}
test_invalid_version_run_says_how_many_failing_logs_it_left_unopened() {
  echo bad > "$FAILURE_LOG_DIR/claude-version"
  add_failure_log handoff
  add_failure_log a
  run_report false
  assert_exit_code 1
  assert_out_has 'Opening no issues for 2 failing logs because the version is invalid.'
}

# ---------------------------------------------------------------------------------------------
# Creating issues
# ---------------------------------------------------------------------------------------------
test_failed_issue_creation_is_reported_and_fails_the_job() {
  add_failure_log handoff
  echo 'Claude Code 2.1.300 breaks handoff' > "$GH_FAIL_CREATE_TITLES"
  run_report false
  assert_exit_code 1
  assert_out_has 'Failed to create an issue for Claude Code 2.1.300 breaks handoff'
}

test_all_pass_log_still_opens_an_issue_as_the_ci_yml_comment_promises() {
  add_failure_log handoff '(pass) every line passed'
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create --title Claude Code 2.1.300 breaks handoff' 1
}
test_empty_log_still_opens_an_issue() {
  : > "$FAILURE_LOG_DIR/handoff.txt"
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create --title Claude Code 2.1.300 breaks handoff' 1
}

run_tests "$@"
