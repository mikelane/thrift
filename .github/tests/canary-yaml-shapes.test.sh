#!/usr/bin/env bash
# The YAML-shape guards: a key the harness cannot read, a value that continues onto a deeper line,
# a stray line at an indent that is no key of its block, and the job boundaries those keys sit in.
# Usage: canary-yaml-shapes.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"
# ---------------------------------------------------------------------------------------------
# Keys written in other YAML forms, and the report job's own condition
# ---------------------------------------------------------------------------------------------
run_harness_against() { # run_harness_against <ci.yml>
  EXIT_CODE=0
  CANARY_CI_YML="$1" "$BASH" "${BASH_SOURCE[0]}" nothing-matches > "$OUTPUT" 2>&1 || EXIT_CODE=$?
}
# add_line_after_report_step_name <line>: writes $TEST_DIR/ci.yml with the line under the step's name.
add_line_after_report_step_name() {
  awk -v name="      - name: $REPORT_STEP" -v line="$1" '{ print } $0 == name { print line }' "$CI_YML" > "$TEST_DIR/ci.yml"
  grep -qxF -- "$1" "$TEST_DIR/ci.yml" || fail "fixture anchor not found: - name: $REPORT_STEP"
}
# replace_report_job_line <old-prefix> <new-line>: writes $TEST_DIR/ci.yml with the first line that
# starts with the prefix, inside the report job, replaced. An empty new line drops it, and `\n` in it
# starts another line.
replace_report_job_line() {
  awk -v old="$1" -v new="$2" '
    /^  report:/ { is_in_report_job = 1 }
    is_in_report_job && !did_replace && index($0, old) == 1 { did_replace = 1; if (new != "") print new; next }
    { print }' "$CI_YML" > "$TEST_DIR/ci.yml"
  cmp -s "$CI_YML" "$TEST_DIR/ci.yml" && fail "fixture anchor not found: $1"
  return 0
}
test_harness_exits_2_when_the_report_step_gains_a_double_quoted_if_key() {
  add_line_after_report_step_name '        "if": false'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'has the key "if"'
}
test_harness_exits_2_when_the_report_step_gains_a_single_quoted_if_key() {
  add_line_after_report_step_name "        'if': false"
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'has the key "if"'
}
test_harness_exits_2_when_the_report_step_gains_an_if_key_with_a_space_before_the_colon() {
  add_line_after_report_step_name '        if : false'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'has the key "if"'
}
test_harness_exits_2_when_the_report_step_runs_under_another_shell_written_with_a_spaced_key() {
  sed 's/^        shell: bash$/        shell : sh/' "$CI_YML" > "$TEST_DIR/ci.yml"
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'has "shell" set to something other than "bash"'
}
test_harness_accepts_the_report_step_shell_key_written_with_quotes() {
  sed 's/^        shell: bash$/        "shell": bash/' "$CI_YML" > "$TEST_DIR/ci.yml"
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 4 # extraction passed, and the filter matched no test
}
test_harness_exits_2_when_the_report_job_condition_is_changed() {
  replace_report_job_line '    if: ' '    if: false'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has "The job 'report'"
  assert_out_has 'has "if" set to something other than'
}
test_harness_exits_2_when_the_report_job_condition_is_removed() {
  replace_report_job_line '    if: ' ''
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has "The job 'report'"
  assert_out_has 'has no "if" key'
}
test_harness_exits_2_when_the_report_job_condition_is_changed_and_written_with_quotes() {
  replace_report_job_line '    if: ' '    "if": false'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'has "if" set to something other than'
}
test_harness_exits_2_when_the_report_job_gains_a_second_condition() {
  replace_report_job_line '    if: ' "$(grep -m1 '^    if: ' "$CI_YML")\n    \"if\": false"
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'has "if" more than once'
}

test_harness_exits_2_when_the_report_job_loses_its_condition_to_a_following_job_with_an_underscore_name() {
  replace_report_job_line '    if: ' ''
  printf '  _next:\n%s\n' "$(grep -m1 '^    if: ' "$CI_YML")" >> "$TEST_DIR/ci.yml"
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'has no "if" key'
}
test_harness_exits_2_when_the_report_job_loses_its_condition_to_a_following_job_with_a_quoted_name() {
  replace_report_job_line '    if: ' ''
  printf '  "next":\n%s\n' "$(grep -m1 '^    if: ' "$CI_YML")" >> "$TEST_DIR/ci.yml"
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'has no "if" key'
}

test_harness_accepts_the_last_step_of_a_job_followed_by_a_job_with_an_underscore_name_and_deep_keys() {
  cp "$CI_YML" "$TEST_DIR/ci.yml"
  printf '  _next:\n    strategy:\n      matrix:\n        channel: x\n' >> "$TEST_DIR/ci.yml"
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 4 # extraction passed, and the filter matched no test
}

# ---------------------------------------------------------------------------------------------
# The report step must sit in the report job, and every key line must be readable
# ---------------------------------------------------------------------------------------------
# add_raw_lines_after_report_step_name <text>: the text goes in byte for byte. awk -v and ENVIRON
# both decode escapes such as \u0066 on macOS awk, so neither carries it.
add_raw_lines_after_report_step_name() {
  local line_number
  line_number=$(grep -nxF -- "      - name: $REPORT_STEP" "$CI_YML" | cut -d: -f1)
  [[ -n "$line_number" ]] || { fail "fixture anchor not found: - name: $REPORT_STEP"; return; }
  { head -n "$line_number" "$CI_YML"; printf '%s\n' "$1"; tail -n "+$((line_number + 1))" "$CI_YML"; } > "$TEST_DIR/ci.yml"
  cmp -s "$CI_YML" "$TEST_DIR/ci.yml" && fail 'the fixture changed nothing'
  return 0
}
test_harness_exits_2_when_the_report_step_gains_a_hex_escaped_if_key() {
  add_raw_lines_after_report_step_name '        "\x69f": false'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'cannot read as a plain key'
}
test_harness_exits_2_when_the_report_step_gains_a_unicode_escaped_if_key() {
  add_raw_lines_after_report_step_name '        "i\u0066": false'
  assert_file_has "$TEST_DIR/ci.yml" '\u0066'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'cannot read as a plain key'
}
test_harness_exits_2_when_the_report_step_gains_an_if_key_with_a_tab_before_the_colon() {
  add_raw_lines_after_report_step_name "        if$(printf '\t'): false"
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'cannot read as a plain key'
}
test_harness_exits_2_when_the_report_step_gains_an_explicit_if_key() {
  add_raw_lines_after_report_step_name $'        ? if\n        : false'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'cannot read as a plain key'
}
test_harness_accepts_a_comment_and_a_blank_line_at_the_report_step_key_indentation() {
  add_raw_lines_after_report_step_name $'        # note\n        '
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 4 # extraction passed, and the filter matched no test
}
test_harness_exits_2_when_the_report_step_moves_to_a_disabled_job_with_an_underscore_name_after_report() {
  split_before_report_step $'  _open-issues:\n    if: false\n    runs-on: ubuntu-latest\n    steps:\n'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'Could not extract the step'
}
test_harness_exits_2_when_the_report_step_moves_to_a_disabled_job_and_a_comment_keeps_its_name_in_report() {
  split_before_report_step "      # - name: $REPORT_STEP"$'\n      - run: true\n  open-issues:\n    if: false\n    runs-on: ubuntu-latest\n    steps:\n'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'Could not extract the step'
}

# ---------------------------------------------------------------------------------------------
# A plain scalar continues onto deeper-indented lines, so no key line may be followed by one
# ---------------------------------------------------------------------------------------------
# add_line_after <job> <exact line> <text>: writes $TEST_DIR/ci.yml with the text, byte for byte, after
# the first line of the job that equals the given line. Anchor on a line the harness pins.
add_line_after() {
  local line_number
  line_number=$(awk -v header="  $1:" -v want="$2" '
    $0 == header { is_in_job = 1 }
    is_in_job && $0 != header && /^  [^ #]/ { is_in_job = 0 }
    is_in_job && $0 == want { print NR; exit }' "$CI_YML")
  [[ -n "$line_number" ]] || { fail "fixture anchor not found: $2"; return; }
  { head -n "$line_number" "$CI_YML"; printf '%s\n' "$3"; tail -n "+$((line_number + 1))" "$CI_YML"; } > "$TEST_DIR/ci.yml"
}
# move_report_env_after_run <extra>: the report step's env block moves to just after the step's run
# block (key order does not matter in YAML), followed by the extra text.
move_report_env_after_run() {
  EXTRA="$1" awk -v name="      - name: $REPORT_STEP" '
    function print_env_block() { printf "%s%s", env_block, ENVIRON["EXTRA"]; is_in_step = 0 }
    $0 == name { is_in_step = 1; print; next }
    is_in_step && $0 == "        env:" { is_in_env = 1 }
    is_in_step && is_in_env && $0 == "        shell: bash" { is_in_env = 0 }
    is_in_env { env_block = env_block $0 "\n"; next }
    is_in_step && is_in_run && $0 !~ /^ *$/ && substr($0, 1, 10) != "          " { print_env_block() }
    is_in_step && $0 == "        run: |" { is_in_run = 1 }
    { print }
    END { if (is_in_step) print_env_block() }' "$CI_YML" > "$TEST_DIR/ci.yml"
}
test_harness_exits_2_when_the_report_step_shell_continues_onto_the_next_line() {
  add_line_after report '        shell: bash' '          --noprofile --norc {0}'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'continues the value of the key above it'
}
test_harness_exits_2_when_the_record_step_condition_continues_onto_the_next_line() {
  add_line_after check "        if: ${RECORD_SPEC#+if=}" \
    '          && github.run_attempt == 99'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'continues the value of the key above it'
}
test_harness_exits_2_when_a_step_key_the_harness_only_allows_continues_onto_the_next_line() {
  add_line_after check '        run: scripts/check.sh' '          --extra'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'continues the value of the key above it'
}
test_harness_exits_2_when_the_report_job_condition_continues_onto_the_next_line() {
  add_line_after report "    if: $REPORT_JOB_IF" '      && false'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'continues the value of the key above it'
}
test_harness_exits_2_when_a_quoted_env_value_continuing_at_column_0_hides_an_if_key() {
  move_report_env_after_run $'          NOTE: "a\nb"\n        if: false\n'
  assert_file_has "$TEST_DIR/ci.yml" 'b"'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'is not a key line'
}
test_harness_accepts_a_comment_and_a_blank_line_between_a_key_and_the_next_key() {
  add_line_after report '        shell: bash' $'\n          # note'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 4 # extraction passed, and the filter matched no test
}
test_harness_accepts_a_mapping_under_an_empty_key() {
  # The report step's own env, not the first `env:` in ci.yml, which is a step the harness never reads.
  replace_report_job_line '        env:' '        env:\n          EXTRA_SETTING: 1'
  assert_file_has "$TEST_DIR/ci.yml" 'EXTRA_SETTING: 1'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 4 # extraction passed, and the filter matched no test
}
# run_tests_against_copy <ci.yml> <fragment>: the tests in every test file whose name has the fragment, against the copy.
run_tests_against_copy() {
  EXIT_CODE=0
  CANARY_CI_YML="$1" "$BASH" "$HARNESS_DIR/canary-report.sh" "$2" > "$OUTPUT" 2>&1 || EXIT_CODE=$?
}
test_a_job_after_report_leaves_the_fixtures_working() {
  # A plain new job after `report`. The fixtures that rewrite the report step are built from this
  # copy, so one that assumed `report` is the last job would put its lines in the new job.
  { cat "$CI_YML"; printf '\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n'; } > "$TEST_DIR/ci.yml"
  run_tests_against_copy "$TEST_DIR/ci.yml" exits_2
  assert_exit_code 0
  run_tests_against_copy "$TEST_DIR/ci.yml" accepts
  assert_exit_code 0
  run_tests_against_copy "$TEST_DIR/ci.yml" extraction_
  assert_exit_code 0
}
test_edits_to_report_job_lines_the_harness_does_not_pin_leave_the_fixtures_working() {
  # `needs` as a list, a new display name and a new timeout are all valid edits to ci.yml.
  sed -e 's/^    needs: check$/    needs: [check]/' -e 's/^    name: open canary issues$/    name: open the canary issues/' \
    -e 's/^    timeout-minutes: 5$/    timeout-minutes: 7/' "$CI_YML" > "$TEST_DIR/ci.yml"
  assert_file_has "$TEST_DIR/ci.yml" 'needs: [check]'
  assert_file_has "$TEST_DIR/ci.yml" 'name: open the canary issues'
  assert_file_has "$TEST_DIR/ci.yml" 'timeout-minutes: 7'
  run_tests_against_copy "$TEST_DIR/ci.yml" exits_2
  assert_exit_code 0
  run_tests_against_copy "$TEST_DIR/ci.yml" accepts
  assert_exit_code 0
  run_tests_against_copy "$TEST_DIR/ci.yml" extraction_
  assert_exit_code 0
}
test_harness_exits_2_when_a_quoted_env_value_continues_at_a_shallow_indent_and_hides_a_step_key() {
  # YAML reads `NOTE` as "a shell: bash", so Actions sees no shell key while the harness reads one.
  awk -v fence="          MAX_FENCE: $MAX_FENCE" '
    { print }
    $0 == fence { print "          NOTE: \"a" }
    $0 == "        shell: bash" { print "   \"" }' "$CI_YML" > "$TEST_DIR/ci.yml"
  assert_file_has "$TEST_DIR/ci.yml" 'NOTE: "a'
  [[ "$(grep -cx '   "' "$TEST_DIR/ci.yml")" == 1 ]] || fail 'the fixture did not close the quote at indent 3'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'is indented less than a' # indent 3 is under a job key too, and the job is read first
}
test_harness_exits_2_when_a_line_at_indent_4_that_is_not_a_job_key_sits_between_the_report_step_keys() {
  add_line_after report '        shell: bash' '    x"'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'is indented less than a step key'
}
test_harness_exits_2_when_a_line_at_indent_6_that_is_not_a_step_sits_between_the_report_step_keys() {
  add_line_after report '        shell: bash' '      x"'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'is indented less than a step key'
}
test_harness_exits_2_when_a_line_at_indent_5_sits_between_the_report_step_keys() {
  add_line_after report '        shell: bash' '     x"'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'is indented less than a step key'
}
test_harness_exits_2_when_a_line_at_indent_7_sits_between_the_report_step_keys() {
  add_line_after report '        shell: bash' '       x"'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'is indented less than a step key'
}
test_harness_exits_2_when_a_line_at_indent_1_sits_between_the_report_job_keys() {
  add_line_after report "    if: $REPORT_JOB_IF" ' x"'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'is indented less than a job key'
}
test_harness_exits_2_when_a_line_at_indent_3_sits_between_the_report_job_keys() {
  add_line_after report "    if: $REPORT_JOB_IF" '   x"'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'is indented less than a job key'
}
test_harness_exits_2_when_a_line_at_indent_2_that_is_not_a_job_id_sits_between_the_report_job_keys() {
  add_line_after report "    if: $REPORT_JOB_IF" '  x"'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has "The job 'report'"
  assert_out_has 'is not a key line'
}
test_harness_accepts_a_comment_at_column_0_inside_the_report_job() {
  add_line_after report "    if: $REPORT_JOB_IF" '# a comment at column 0'
  assert_file_has "$TEST_DIR/ci.yml" '# a comment at column 0'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 4 # the job did not end at the comment, so its condition and steps were still read
}
test_harness_accepts_a_comment_at_column_2_inside_the_report_job() {
  add_line_after report "    if: $REPORT_JOB_IF" '  # a comment at column 2'
  assert_file_has "$TEST_DIR/ci.yml" '# a comment at column 2'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 4 # the job did not end at the comment, so its condition and steps were still read
}
test_harness_exits_2_when_a_report_job_key_other_than_its_condition_continues_onto_the_next_line() {
  add_line_after report '  report:' $'    probe: value\n      more'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'continues the value of the key above it'
}

# ---------------------------------------------------------------------------------------------
# A job key after the report step's steps ends the step, so its lines are not the step's
# ---------------------------------------------------------------------------------------------
test_extraction_ignores_a_job_key_with_a_mapping_after_the_report_step() {
  extract_report_step "$CI_YML" > "$TEST_DIR/expected"
  { cat "$CI_YML"; printf "    outputs:\n      done: 'yes'\n"; } > "$TEST_DIR/ci.yml"
  extract_report_step "$TEST_DIR/ci.yml" > "$TEST_DIR/out" 2>&1 || fail 'extraction failed on a job key with a mapping after the steps'
  cmp -s "$TEST_DIR/out" "$TEST_DIR/expected" || fail 'the script changed when a job key followed the report step'
}
test_extraction_ignores_a_job_key_with_a_nested_mapping_after_the_report_step() {
  extract_report_step "$CI_YML" > "$TEST_DIR/expected"
  { cat "$CI_YML"; printf '    defaults:\n      run:\n        working-directory: .\n'; } > "$TEST_DIR/ci.yml"
  extract_report_step "$TEST_DIR/ci.yml" > "$TEST_DIR/out" 2>&1 || fail 'extraction failed on a job key with a nested mapping after the steps'
  cmp -s "$TEST_DIR/out" "$TEST_DIR/expected" || fail 'the script changed when a nested job key followed the report step'
}

run_tests "$@"
