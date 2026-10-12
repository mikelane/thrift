#!/usr/bin/env bash
# The report job: the log inside the issue body, and read errors while building it.
# Usage: canary-report-body.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"

# ---------------------------------------------------------------------------------------------
# The log inside the issue body
# ---------------------------------------------------------------------------------------------
test_plain_log_gets_a_three_backtick_fence() {
  add_failure_log handoff
  run_report true
  assert_fence_lines "$TEST_DIR/issue-body.md" '```' 2
}
test_log_with_a_three_backtick_line_gets_a_longer_fence() {
  printf 'error\n```\n@someone please look at #1\n' > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  assert_fence_lines "$TEST_DIR/issue-body.md" '````' 2
}
test_log_with_a_five_backtick_run_gets_a_six_backtick_fence() {
  printf 'a\n`````\n@someone\n' > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  assert_fence_lines "$TEST_DIR/issue-body.md" '``````' 2
}
test_log_with_tildes_does_not_need_a_longer_fence() {
  printf 'a\n~~~\nb\n' > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  assert_fence_lines "$TEST_DIR/issue-body.md" '```' 2
}
test_fence_holds_when_the_log_has_invalid_utf8() {
  printf 'error \xff\n```\n@someone [click](https://evil.example)\n' > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  assert_fence_lines "$TEST_DIR/issue-body.md" '````' 2
}
test_nul_bytes_are_stripped_from_the_body_and_the_fence_outgrows_the_log_backticks() {
  printf 'error \0\n```\n@someone\n' > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  assert_fence_lines "$TEST_DIR/issue-body.md" '````' 2
  [[ "$(tr -cd '\000' < "$TEST_DIR/issue-body.md" | wc -c | tr -d ' ')" == 0 ]] || fail 'the body still holds a NUL byte'
  assert_file_has "$TEST_DIR/issue-body.md" '@someone'
}
test_fence_holds_when_the_tail_cuts_a_multibyte_character() {
  # 3 + 59983 + 15 bytes: the 60000-byte tail starts on the second byte of the 3-byte character.
  { printf '\xe2\x9c\x93'; repeat_char a 59983; printf '\n```\n@someone\n'; } > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  assert_fence_lines "$TEST_DIR/issue-body.md" '````' 2
}
test_fence_closes_on_its_own_line_when_the_log_has_no_trailing_newline() {
  printf 'no newline at the end' > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  assert_fence_lines "$TEST_DIR/issue-body.md" '```' 2
  assert_file_has "$TEST_DIR/issue-body.md" 'no newline at the end'
}
test_log_with_a_backtick_run_one_short_of_the_limit_is_included_in_a_fence_of_the_limit() {
  { repeat_char a 59000; echo; repeat_backticks $((MAX_FENCE - 1)); echo; } > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  assert_file_lacks "$TEST_DIR/issue-body.md" 'withheld'
  assert_fence_lines "$TEST_DIR/issue-body.md" "$(repeat_backticks "$MAX_FENCE")" 2
  [[ "$(wc -c < "$TEST_DIR/issue-body.md")" -le 65536 ]] || fail 'the body is over 65536 characters'
}
test_log_with_a_backtick_run_at_the_limit_is_withheld_and_links_the_run() {
  { echo before; repeat_backticks "$MAX_FENCE"; echo; echo @someone; } > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  assert_file_has "$TEST_DIR/issue-body.md" 'withheld'
  assert_file_has "$TEST_DIR/issue-body.md" 'https://github.com/o/r/actions/runs/42'
  assert_file_lacks "$TEST_DIR/issue-body.md" '@someone'
}
test_eighty_kilobyte_plain_log_keeps_the_body_under_the_github_limit() {
  awk 'BEGIN { for (i = 0; i < 1300; i++) printf "line %d %s\n", i, "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }' > "$FAILURE_LOG_DIR/handoff.txt"
  [[ "$(wc -c < "$FAILURE_LOG_DIR/handoff.txt")" -ge 80000 ]] || fail 'the fixture is under 80 KB'
  run_report true
  [[ "$(wc -c < "$TEST_DIR/issue-body.md")" -le 65536 ]] || fail 'the body is over 65536 characters'
  assert_file_has "$TEST_DIR/issue-body.md" 'line 1299'
}
test_passing_test_lines_do_not_push_the_failing_test_out_of_the_tail() {
  { awk 'BEGIN { for (i = 0; i < 3000; i++) print "(pass) a test that passed" }'; echo '(fail) the test that broke'; } > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  assert_file_has "$TEST_DIR/issue-body.md" '(fail) the test that broke'
  assert_file_lacks "$TEST_DIR/issue-body.md" '(pass) '
}
test_untrusted_log_is_printed_between_stop_commands_markers() {
  printf 'boom\n::error::injected\n' > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  local start_line stop_token end_line injected_line
  start_line=$(grep -an '^::stop-commands::' "$OUTPUT" | head -n 1 | cut -d: -f1)
  stop_token=$(sed -n "${start_line:-0}p" "$OUTPUT" | sed 's/^::stop-commands:://')
  [[ "$stop_token" =~ ^[0-9a-f]{32}$ ]] || fail "the stop-commands token is not 32 hex characters: $stop_token"
  end_line=$(grep -anxF "::${stop_token}::" "$OUTPUT" | head -n 1 | cut -d: -f1)
  injected_line=$(grep -anxF '::error::injected' "$OUTPUT" | head -n 1 | cut -d: -f1)
  [[ -n "$start_line" && -n "$end_line" && -n "$injected_line" ]] || { fail 'a marker or the injected line is missing'; return; }
  { [[ "$start_line" -lt "$injected_line" ]] && [[ "$injected_line" -lt "$end_line" ]]; } || fail 'the log is not between the markers'
}
test_live_run_prints_no_untrusted_body() {
  printf 'boom\n::error::injected\n' > "$FAILURE_LOG_DIR/handoff.txt"
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create --title Claude Code 2.1.300 breaks handoff ' 1
  assert_out_lacks '::error::injected'
  assert_out_lacks '::stop-commands::'
}

# ---------------------------------------------------------------------------------------------
# Read errors and large listings
# ---------------------------------------------------------------------------------------------
# run_report_with_failing_grep <pattern> <dry_run>: a grep given exactly that pattern exits 2, as
# on a read error. Every other grep runs normally.
run_report_with_failing_grep() {
  mkdir -p "$TEST_DIR/bin"
  # shellcheck disable=SC2016 # the wrapper's $@ and $arg expand when the wrapper runs
  printf '#!/usr/bin/env bash\nfor arg in "$@"; do [[ "$arg" != "$GREP_FAIL_PATTERN" ]] || { echo "grep: read error" >&2; exit 2; }; done\nexec %q "$@"\n' \
    "$(command -v grep)" > "$TEST_DIR/bin/grep"
  chmod +x "$TEST_DIR/bin/grep"
  run_report "$2" PATH="$TEST_DIR/bin:$STUBS:$PATH" GREP_FAIL_PATTERN="$1"
}
test_read_error_while_dropping_passing_lines_skips_the_plugin_and_fails_the_job() {
  add_failure_log handoff
  run_report_with_failing_grep '^(pass) ' false
  assert_exit_code 1
  assert_out_has 'Failed to read the log for handoff; not opening an issue.'
  assert_gh_call_count 'issue create' 0
}
test_read_error_while_measuring_backtick_runs_skips_the_plugin_and_fails_the_job() {
  add_failure_log handoff
  run_report_with_failing_grep '`*' false
  assert_exit_code 1
  assert_out_has 'Failed to read the log for handoff; not opening an issue.'
  assert_gh_call_count 'issue create' 0
}
test_read_error_on_a_log_does_not_stop_the_job_before_the_next_log() {
  add_failure_log a
  add_failure_log b
  run_report_with_failing_grep '`*' false
  assert_exit_code 1
  assert_out_has 'Failed to read the log for a;'
  assert_out_has 'Failed to read the log for b;'
}
test_plugin_is_found_among_a_listing_larger_than_a_pipe_buffer() {
  local i
  for i in $(seq 1 20000); do echo "zz-plugin-$i"; done > "$GH_PLUGINS"
  echo handoff >> "$GH_PLUGINS"
  add_failure_log handoff
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create' 1
}

run_tests "$@"
