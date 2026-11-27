#!/usr/bin/env bash
# Issue #215: a lib sibling that fails to load stops the merge step before the gate, on bash 3.2 and 5: a
# missing or unreadable one with an error annotation naming it, any other failure with none.
# Usage: release-merge-sibling-load.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"
# shellcheck source=release-merge-stubs-lib.sh
source "$HARNESS_DIR/release-merge-stubs-lib.sh"
# shellcheck source=release-merge-step-lib.sh
source "$HARNESS_DIR/release-merge-step-lib.sh"

# copy_lib_with_failing_sibling <sibling> <contents>: a copy of the lib in $TEST_DIR/lib whose <sibling>
# fails to load: absent when <contents> is "missing", otherwise a file holding <contents>.
copy_lib_with_failing_sibling() {
  local sibling=$1 contents=$2
  mkdir -p "$TEST_DIR/lib"
  cp "$RELEASE_MERGE_LIB" "$(dirname "$RELEASE_MERGE_LIB")"/release-merge-ci-lookup.sh \
    "$(dirname "$RELEASE_MERGE_LIB")"/release-merge-failure.sh "$TEST_DIR/lib/"
  rm "$TEST_DIR/lib/$sibling"
  [[ "$contents" == missing ]] || printf '%s\n' "$contents" >"$TEST_DIR/lib/$sibling"
}

# source_lib_copy: sources the copied lib the way the workflow step does, then reaches the gate.
source_lib_copy() {
  "$BASH" -c 'set -euo pipefail; source "$1"; echo sourcing-finished' _ "$TEST_DIR/lib/release-merge-lib.sh" >"$OUTPUT" 2>&1
  # shellcheck disable=SC2034 # read by assert_exit_code in canary-report-lib.sh
  EXIT_CODE=$?
}

test_a_missing_failure_sibling_writes_an_error_annotation_naming_the_file() {
  copy_lib_with_failing_sibling release-merge-failure.sh missing
  source_lib_copy || true
  assert_exit_code 1
  assert_out_has "::error title=Release merge failed::cannot load $TEST_DIR/lib/release-merge-failure.sh: missing or unreadable (is it in the merge job's sparse checkout?)"
  assert_out_lacks "sourcing-finished"
}

test_a_missing_ci_lookup_sibling_writes_an_error_annotation_naming_the_file() {
  copy_lib_with_failing_sibling release-merge-ci-lookup.sh missing
  source_lib_copy || true
  assert_exit_code 1
  assert_out_has "::error title=Release merge failed::cannot load $TEST_DIR/lib/release-merge-ci-lookup.sh: missing or unreadable (is it in the merge job's sparse checkout?)"
  assert_out_lacks "sourcing-finished"
}

# A sibling the step cannot read is reported like one that is absent, and the gate never runs.
test_an_unreadable_sibling_writes_an_error_annotation_naming_the_file() {
  copy_lib_with_failing_sibling release-merge-ci-lookup.sh 'true'
  chmod 000 "$TEST_DIR/lib/release-merge-ci-lookup.sh"
  source_lib_copy || true
  assert_exit_code 1
  assert_out_has "::error title=Release merge failed::cannot load $TEST_DIR/lib/release-merge-ci-lookup.sh: missing or unreadable (is it in the merge job's sparse checkout?)"
  assert_out_lacks "sourcing-finished"
}

# Like the self-location line, a missing sibling must stop the source with a non-zero status when the
# lib is sourced without set -e, not go on to define the gate without the sibling's functions.
test_a_missing_sibling_stops_sourcing_the_lib_without_set_e() {
  copy_lib_with_failing_sibling release-merge-ci-lookup.sh missing
  "$BASH" -c 'source "$1"; printf "status=%s\n" "$?"' _ "$TEST_DIR/lib/release-merge-lib.sh" >"$OUTPUT" 2>&1
  assert_out_has "::error title=Release merge failed::cannot load $TEST_DIR/lib/release-merge-ci-lookup.sh: missing or unreadable (is it in the merge job's sparse checkout?)"
  assert_out_has "status=1"
}

test_a_sibling_that_fails_while_loading_stops_the_step_without_an_annotation() {
  copy_lib_with_failing_sibling release-merge-ci-lookup.sh 'return 1'
  source_lib_copy || true
  assert_exit_code 1
  assert_out_lacks "::error title=Release merge failed"
  assert_out_lacks "sourcing-finished"
}

# A sibling that fails while loading gets no annotation, on any bash, but the step must stop before the gate.
test_a_sibling_with_a_syntax_error_stops_the_step_before_the_gate() {
  copy_lib_with_failing_sibling release-merge-ci-lookup.sh 'if then'
  source_lib_copy || true
  assert_exit_code_nonzero
  assert_out_lacks "sourcing-finished"
}

test_a_sibling_whose_top_level_command_fails_stops_the_step_before_the_gate() {
  copy_lib_with_failing_sibling release-merge-ci-lookup.sh 'false'
  source_lib_copy || true
  assert_exit_code_nonzero
  assert_out_lacks "sourcing-finished"
}

# `source ... || x` and `[[ -r ]] && source` suspend set -e inside the sourced file on bash 5, so a
# failing command that is not the sibling's last would be ignored and source would return 0.
test_a_sibling_whose_earlier_top_level_command_fails_stops_the_step_before_the_gate() {
  copy_lib_with_failing_sibling release-merge-ci-lookup.sh $'false\ntrue'
  source_lib_copy || true
  assert_exit_code_nonzero
  assert_out_lacks "sourcing-finished"
}

run_tests "$@"
