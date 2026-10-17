#!/usr/bin/env bash
# The entry point, canary-report.sh, run over a scratch directory of stand-in test files.
# Usage: canary-entry-point.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck disable=SC2034 # EXIT_CODE is read by assert_exit_code in canary-report-lib.sh
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"

# make_scratch_harness <file> <body>: a scratch harness directory holding the entry point and one test file.
make_scratch_harness() {
  SCRATCH_HARNESS=$TEST_DIR/harness
  mkdir -p "$SCRATCH_HARNESS"
  cp "$HARNESS_DIR/canary-report.sh" "$SCRATCH_HARNESS/canary-report.sh"
  printf '%s\n' "$2" > "$SCRATCH_HARNESS/$1"
}

run_entry_point() {
  EXIT_CODE=0
  "$BASH" "$SCRATCH_HARNESS/canary-report.sh" "$@" > "$OUTPUT" 2>&1 || EXIT_CODE=$?
}

test_a_test_cannot_read_the_list_of_test_names() {
  if { read -r -u 3 _; } 2> /dev/null; then fail 'the test read a name from fd 3'; fi
}
test_entry_point_fails_when_a_test_file_exits_4_without_a_name_fragment() {
  make_scratch_harness a.test.sh 'exit 4'
  printf '%s\n' 'echo "1 of 1 passed"' > "$SCRATCH_HARNESS/b.test.sh"
  run_entry_point
  assert_exit_code 4
  assert_out_has 'a.test.sh exited 4'
}
test_entry_point_fails_when_a_test_file_exits_non_zero_without_printing() {
  make_scratch_harness a.test.sh 'exit 1'
  run_entry_point
  assert_exit_code 1
  assert_out_has 'a.test.sh failed with exit status 1'
}
test_entry_point_fails_when_no_test_file_exists() {
  make_scratch_harness a.sh 'true'
  run_entry_point
  assert_exit_code 2
  assert_out_has 'No *.test.sh file found'
}
test_entry_point_passes_when_a_name_fragment_matches_tests_in_only_one_file() {
  make_scratch_harness a.test.sh 'exit 4'
  printf '%s\n' 'echo "1 of 1 passed"' > "$SCRATCH_HARNESS/b.test.sh"
  run_entry_point some-fragment
  assert_exit_code 0
  assert_out_lacks 'No tests ran'
}
test_entry_point_exits_with_the_highest_status_of_its_failing_test_files() {
  # Neither the first nor the last status is the highest, so only a maximum gives 2.
  make_scratch_harness a.test.sh 'exit 1'
  printf '%s\n' 'exit 2' > "$SCRATCH_HARNESS/b.test.sh"
  printf '%s\n' 'exit 1' > "$SCRATCH_HARNESS/c.test.sh"
  run_entry_point
  assert_exit_code 2
}
test_entry_point_passes_a_name_fragment_with_a_space_through_unsplit() {
  make_scratch_harness a.test.sh 'echo "args:[$*] n=$#"; echo "1 of 1 passed"'
  run_entry_point 'two words'
  assert_exit_code 0
  assert_out_has 'args:[two words] n=1'
}
test_entry_point_fails_when_no_test_matches_the_name_fragment() {
  make_scratch_harness a.test.sh 'exit 4'
  run_entry_point nothing-matches
  assert_exit_code 1
  assert_out_has "No tests ran. No test name contains 'nothing-matches'."
}

test_entry_point_fails_when_a_test_file_runs_no_tests() {
  make_scratch_harness a.test.sh 'true'
  run_entry_point
  assert_exit_code 1
  assert_out_has 'a.test.sh ran no tests'
}
test_entry_point_fails_when_a_test_file_runs_no_tests_under_a_name_fragment() {
  make_scratch_harness a.test.sh 'true'
  run_entry_point nothing-matches
  assert_exit_code 1
  assert_out_has 'a.test.sh ran no tests'
}
test_entry_point_passes_a_test_file_that_reports_its_tests() {
  make_scratch_harness a.test.sh 'echo "3 of 3 passed"'
  run_entry_point
  assert_exit_code 0
}
test_entry_point_fails_when_a_test_file_reports_no_tests_run() {
  make_scratch_harness a.test.sh 'echo "0 of 0 passed"'
  run_entry_point
  assert_exit_code 1
  assert_out_has 'a.test.sh ran no tests'
}

# Every test file honors the name fragment: a file that ignores it runs all its tests under a fragment
# meant for another file, and the entry point cannot tell (#78).
# Three live-harness tests run the session command under dash. Without it, a test file stops at the
# prerequisite check with a message naming dash, not with three failures of status 127.
test_a_test_file_exits_2_and_names_dash_when_dash_is_not_on_path() {
  mkdir -p "$TEST_DIR/no-dash"
  ln -s "$(command -v dirname)" "$(command -v jq)" "$(command -v openssl)" "$TEST_DIR/no-dash/"
  EXIT_CODE=0
  PATH=$TEST_DIR/no-dash "$BASH" "$HARNESS_DIR/trim-output.test.sh" > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  assert_exit_code 2
  assert_out_has 'The harness needs dash on PATH'
}

# The real entry point over the real test files: any file that runs a test makes it exit 0, not 1.
test_entry_point_runs_no_test_file_for_a_name_fragment_that_matches_no_test() {
  EXIT_CODE=0
  "$BASH" "$HARNESS_DIR/canary-report.sh" zzz-matches-no-test-anywhere > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  assert_exit_code 1
  assert_out_has 'No tests ran'
  assert_out_lacks 'PASS '
}

run_tests "$@"
