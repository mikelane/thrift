#!/usr/bin/env bash
# The entry point, canary-report.sh, run over a scratch directory of stand-in test files.
# Usage: canary-entry-point.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"

# stand_in_harness <file> <body>: a scratch harness directory holding the entry point and one test file.
stand_in_harness() {
  SCRATCH_HARNESS=$TEST_DIR/harness
  mkdir -p "$SCRATCH_HARNESS"
  cp "$HARNESS_DIR/canary-report.sh" "$SCRATCH_HARNESS/canary-report.sh"
  printf '%s\n' "$2" > "$SCRATCH_HARNESS/$1"
}

run_entry_point() {
  EXIT_CODE=0
  "$BASH" "$SCRATCH_HARNESS/canary-report.sh" "$@" > "$OUTPUT" 2>&1 || EXIT_CODE=$?
}

test_entry_point_fails_when_a_test_file_exits_4_without_a_name_fragment() {
  stand_in_harness a.test.sh 'exit 4'
  printf '%s\n' 'echo "1 of 1 passed"' > "$SCRATCH_HARNESS/b.test.sh"
  run_entry_point
  assert_exit_code_nonzero
}
test_entry_point_fails_when_a_test_file_exits_non_zero_without_printing() {
  stand_in_harness a.test.sh 'exit 1'
  run_entry_point
  assert_exit_code_nonzero
}
test_entry_point_fails_when_no_test_file_exists() {
  stand_in_harness a.sh 'true'
  run_entry_point
  assert_exit_code 2
}
test_entry_point_passes_a_name_fragment_with_a_space_through_unsplit() {
  stand_in_harness a.test.sh 'echo "args:[$*] n=$#"; echo "1 of 1 passed"'
  run_entry_point 'two words'
  assert_exit_code 0
  assert_out_has 'args:[two words] n=1'
}
test_entry_point_fails_when_no_test_matches_the_name_fragment() {
  stand_in_harness a.test.sh 'exit 4'
  run_entry_point nothing-matches
  assert_exit_code 1
}

test_entry_point_fails_when_a_test_file_runs_no_tests() {
  stand_in_harness a.test.sh 'true'
  run_entry_point
  assert_exit_code_nonzero
  assert_out_has 'a.test.sh ran no tests'
}
test_entry_point_fails_when_a_test_file_runs_no_tests_under_a_name_fragment() {
  stand_in_harness a.test.sh 'true'
  run_entry_point nothing-matches
  assert_exit_code_nonzero
  assert_out_has 'a.test.sh ran no tests'
}
test_entry_point_passes_a_test_file_that_reports_its_tests() {
  stand_in_harness a.test.sh 'echo "3 of 3 passed"'
  run_entry_point
  assert_exit_code 0
}
test_entry_point_fails_when_a_test_file_reports_no_tests_run() {
  stand_in_harness a.test.sh 'echo "0 of 0 passed"'
  run_entry_point
  assert_exit_code_nonzero
}

run_tests "$@"
