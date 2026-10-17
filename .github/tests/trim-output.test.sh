#!/usr/bin/env bash
# scripts/live/trim-output.sh: what it keeps and what it rewrites in a run's output.
# Usage: trim-output.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck disable=SC2034 # EXIT_CODE is read by assert_exit_code in canary-report-lib.sh
# shellcheck source=live-harness-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/live-harness-lib.sh"

# trim_with_home <home> <line...>: runs trim-output.sh on the lines with HOME set to <home>.
trim_with_home() {
  local home=$1
  shift
  EXIT_CODE=0
  printf '%s\n' "$@" | HOME="$home" "$BASH" "$LIVE_DIR/trim-output.sh" > "$OUTPUT" 2>&1 || EXIT_CODE=$?
}

test_trim_output_replaces_the_home_directory_and_session_ids() {
  trim_with_home "$TEST_DIR/home" "run $TEST_DIR/home/.cache/x and $TEST_DIR/home" \
    'session 0a1b2c3d-4e5f-6789-abcd-ef0123456789 and 0A1B2C3D-4E5F-6789-ABCD-EF0123456789' \
    'PASS held-prompt-box (3 checks)'
  assert_exit_code 0
  assert_out_has 'run ~/.cache/x and ~'
  assert_out_has 'session <session-id> and <session-id>'
  assert_out_has 'PASS held-prompt-box (3 checks)'
  assert_out_lacks "$TEST_DIR/home"
}

test_trim_output_leaves_other_text_alone_when_home_has_sed_special_characters() {
  trim_with_home '/a.b&c' '/a.b&c/x /aXb&c'
  assert_exit_code 0
  # shellcheck disable=SC2088 # a literal ~ is what trim-output writes
  assert_out_has '~/x /aXb&c'
}

# A home of /Users/mike must not turn /Users/mikelane into ~lane.
test_trim_output_leaves_a_longer_name_that_starts_with_the_home_directory() {
  trim_with_home '/Users/mike' '/Users/mikelane/x and /Users/mike/y and /Users/mike'
  assert_exit_code 0
  assert_out_has '/Users/mikelane/x and ~/y and ~'
}

test_trim_output_takes_a_home_directory_with_a_trailing_slash() {
  trim_with_home '/h/x/' '/h/x/foo and /h/x'
  assert_exit_code 0
  # shellcheck disable=SC2088 # a literal ~ is what trim-output writes
  assert_out_has '~/foo and ~'
}

# awk -v reads escape sequences, so a backslash in the home directory would not match itself.
test_trim_output_takes_a_home_directory_with_a_backslash() {
  trim_with_home '/a\tb' '/a\tb/x'
  assert_exit_code 0
  # shellcheck disable=SC2088 # a literal ~ is what trim-output writes
  assert_out_has '~/x'
}

test_trim_output_replaces_only_session_ids_when_home_is_empty() {
  trim_with_home '' '/home/u/x 0a1b2c3d-4e5f-6789-abcd-ef0123456789'
  assert_exit_code 0
  assert_out_has '/home/u/x <session-id>'
}

# GNU cut -c splits a multibyte character; a BSD sed in a UTF-8 locale then stops at that byte and
# drops every line after it, the verdict included.
test_trim_output_keeps_every_line_after_a_byte_that_is_not_utf8() {
  local home=$TEST_DIR/home
  EXIT_CODE=0
  printf '%s\n' $'split \xc3' "$home/x" 'PASS held-prompt-box (3 checks)' \
    | LC_ALL=en_US.UTF-8 HOME="$home" "$BASH" "$LIVE_DIR/trim-output.sh" > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  assert_exit_code 0
  # shellcheck disable=SC2088 # a literal ~ is what trim-output writes
  assert_out_has '~/x'
  assert_out_has 'PASS held-prompt-box (3 checks)'
}

run_tests "$@"
