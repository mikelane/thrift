#!/usr/bin/env bash
# The extraction guard: a workflow change the harness does not model makes it exit 2.
# Usage: canary-extraction.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"

test_extraction_finds_the_report_step_in_the_real_workflow() {
  extract_report_step "$CI_YML" > "$TEST_DIR/out" 2>&1 || fail 'extraction failed'
  assert_file_has "$TEST_DIR/out" 'gh issue create'
}
test_extraction_fails_when_the_step_is_renamed() {
  sed 's/- name: Open an issue for each plugin/- name: Open issues for each plugin/' "$CI_YML" > "$TEST_DIR/ci.yml"
  extract_report_step "$TEST_DIR/ci.yml" > "$OUTPUT" 2>&1 && fail 'extraction passed on a renamed step'
  assert_out_has 'Could not extract the step'
  return 0
}
test_extraction_fails_when_the_step_name_appears_twice() {
  split_before_report_step "      - name: $REPORT_STEP"$'\n        run: |\n          gh issue create\n'
  extract_report_step "$TEST_DIR/ci.yml" > "$OUTPUT" 2>&1 && fail 'extraction passed with the step name in two places'
  assert_out_has 'appears 2 times'
  return 0
}
test_extraction_ignores_the_report_step_name_in_another_job() {
  { cat "$CI_YML"; printf '  decoy:\n    steps:\n      - name: %s\n        run: |\n          gh issue create\n' "$REPORT_STEP"; } > "$TEST_DIR/ci.yml"
  extract_report_step "$TEST_DIR/ci.yml" > "$OUTPUT" 2>&1 || fail 'extraction failed because another job has a step of the same name'
}
test_extraction_fails_when_the_workflow_is_re_indented() {
  sed 's/^/  /' "$CI_YML" > "$TEST_DIR/ci.yml"
  extract_report_step "$TEST_DIR/ci.yml" > "$OUTPUT" 2>&1 && fail 'extraction passed on a re-indented workflow'
  assert_out_has 'Could not extract the step'
  return 0
}
test_extraction_fails_when_the_run_block_is_replaced_by_a_uses_step() {
  sed 's/^        run: |$/        with: |/' "$CI_YML" > "$TEST_DIR/ci.yml"
  extract_report_step "$TEST_DIR/ci.yml" > "$OUTPUT" 2>&1 && fail 'extraction passed with no run block'
  assert_out_has 'has the key "with"'
  return 0
}
test_extraction_fails_when_the_report_step_gains_an_if_condition() {
  sed "s/^      - name: ${REPORT_STEP}\$/&\\
        if: false/" "$CI_YML" > "$TEST_DIR/ci.yml"
  grep -qxF '        if: false' "$TEST_DIR/ci.yml" || { fail 'the fixture did not add the if: line'; return; }
  extract_report_step "$TEST_DIR/ci.yml" > "$OUTPUT" 2>&1 && fail 'extraction passed on a step that never runs'
  assert_out_has 'has the key "if"'
  return 0
}
test_extraction_fails_when_the_report_step_loses_its_shell_key() {
  grep -vxF '        shell: bash' "$CI_YML" > "$TEST_DIR/ci.yml"
  extract_report_step "$TEST_DIR/ci.yml" > "$OUTPUT" 2>&1 && fail 'extraction passed with no shell key, so Actions would drop pipefail'
  assert_out_has 'lacks the key "shell"'
  return 0
}
test_extraction_fails_when_the_report_step_runs_under_another_shell() {
  sed 's/^        shell: bash$/        shell: sh/' "$CI_YML" > "$TEST_DIR/ci.yml"
  extract_report_step "$TEST_DIR/ci.yml" > "$OUTPUT" 2>&1 && fail 'extraction passed with shell: sh'
  assert_out_has 'has "shell" set to something other than "bash"'
  return 0
}
test_extraction_fails_when_a_key_follows_the_run_block() {
  # shellcheck disable=SC2016 # the sed pattern holds a literal $
  sed 's/^          exit "\$problems"$/&\
        continue-on-error: true/' "$CI_YML" > "$TEST_DIR/ci.yml"
  grep -qxF '        continue-on-error: true' "$TEST_DIR/ci.yml" || { fail 'the fixture did not add the key'; return; }
  extract_report_step "$TEST_DIR/ci.yml" > "$OUTPUT" 2>&1 && fail 'extraction passed with a key after the run block'
  assert_out_has 'has the key "continue-on-error"'
  return 0
}
test_extraction_keeps_a_whitespace_only_line_shorter_than_the_indentation() {
  extract_report_step "$CI_YML" > "$TEST_DIR/expected"
  awk '{ print } /^          failures="\$RUNNER_TEMP\/failures"$/ { getline; print "   " }' "$CI_YML" > "$TEST_DIR/ci.yml"
  grep -qx '   ' "$TEST_DIR/ci.yml" || { fail 'the fixture did not add the whitespace-only line'; return; }
  extract_report_step "$TEST_DIR/ci.yml" > "$TEST_DIR/out" 2>&1 || fail 'extraction failed on a short whitespace-only line'
  cmp -s "$TEST_DIR/out" "$TEST_DIR/expected" || fail 'the script extracted around the whitespace-only line differs from the original'
}
test_reading_a_report_step_setting_ignores_the_same_key_in_another_step() {
  sed "s/^          CLAUDE_CODE_VERSION: .*\$/&\\
          MAX_FENCE: 1/" "$CI_YML" > "$TEST_DIR/ci.yml"
  grep -qxF '          MAX_FENCE: 1' "$TEST_DIR/ci.yml" || { fail 'the fixture did not add the decoy'; return; }
  [[ "$(read_report_step_setting "$TEST_DIR/ci.yml" MAX_FENCE)" == "$MAX_FENCE" ]] || fail 'MAX_FENCE was read from another step'
}
test_harness_exits_2_when_the_workflow_it_is_pointed_at_lost_a_step() {
  sed 's/- name: Open an issue for each plugin/- name: Open issues for each plugin/' "$CI_YML" > "$TEST_DIR/ci.yml"
  EXIT_CODE=0
  CANARY_CI_YML="$TEST_DIR/ci.yml" "$BASH" "${BASH_SOURCE[0]}" nothing-matches > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  assert_exit_code 2
  assert_out_has 'Could not extract the step'
}
test_report_job_checks_out_nothing_and_keeps_its_script_inline() {
  local job
  job=$(job_lines report "$CI_YML")
  grep -qxF -- "      - name: $REPORT_STEP" <<< "$job" || { fail 'no report job holding the report step was found'; return; }
  [[ "$job" != *'actions/checkout'* ]] || fail 'the report job checks out the repository'
  [[ "$job" != *'scripts/'* ]] || fail 'the report job runs a script from the repository'
}

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
  grep -qxF -- "$1" "$TEST_DIR/ci.yml" || fail "the fixture did not add: $1"
}
# replace_report_job_line <old-prefix> <new-line>: writes $TEST_DIR/ci.yml with the first line that
# starts with the prefix, inside the report job, replaced. An empty new line drops it, and `\n` in it
# starts another line.
replace_report_job_line() {
  awk -v old="$1" -v new="$2" '
    /^  report:/ { inside = 1 }
    inside && !done && index($0, old) == 1 { done = 1; if (new != "") print new; next }
    { print }' "$CI_YML" > "$TEST_DIR/ci.yml"
  cmp -s "$CI_YML" "$TEST_DIR/ci.yml" && fail "the fixture changed nothing: $1"
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
  local at
  at=$(grep -nxF -- "      - name: $REPORT_STEP" "$CI_YML" | cut -d: -f1)
  { head -n "$at" "$CI_YML"; printf '%s\n' "$1"; tail -n "+$((at + 1))" "$CI_YML"; } > "$TEST_DIR/ci.yml"
  cmp -s "$CI_YML" "$TEST_DIR/ci.yml" && fail 'the fixture changed nothing'
  return 0
}
# split_before_report_step <text>: the text goes in just before the report step, so a job header in it
# ends the report job there and the step and everything after it belong to the new job.
split_before_report_step() {
  JOB_HEADER="$1" awk -v name="      - name: $REPORT_STEP" '$0 == name { printf "%s", ENVIRON["JOB_HEADER"] } { print }' "$CI_YML" > "$TEST_DIR/ci.yml"
  cmp -s "$CI_YML" "$TEST_DIR/ci.yml" && fail 'the fixture changed nothing'
  return 0
}
test_harness_exits_2_when_the_report_step_gains_a_hex_escaped_if_key() {
  add_raw_lines_after_report_step_name '        "\x69f": false'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
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
}
test_harness_exits_2_when_the_report_step_gains_an_explicit_if_key() {
  add_raw_lines_after_report_step_name $'        ? if\n        : false'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
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
}
test_harness_exits_2_when_the_report_step_moves_to_a_disabled_job_and_a_comment_keeps_its_name_in_report() {
  split_before_report_step "      # - name: $REPORT_STEP"$'\n      - run: true\n  open-issues:\n    if: false\n    runs-on: ubuntu-latest\n    steps:\n'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
}
test_report_job_check_fails_when_a_comment_is_the_only_mention_of_the_report_step() {
  split_before_report_step "      # - name: $REPORT_STEP"$'\n      - run: true\n  open-issues:\n    steps:\n'
  EXIT_CODE=0
  CANARY_CI_YML="$TEST_DIR/ci.yml" "$BASH" "${BASH_SOURCE[0]}" keeps_its_script_inline > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  assert_exit_code_nonzero
}

# ---------------------------------------------------------------------------------------------
# A plain scalar continues onto deeper-indented lines, so no key line may be followed by one
# ---------------------------------------------------------------------------------------------
# add_line_after <exact line> <text>: writes $TEST_DIR/ci.yml with the text, byte for byte, after the
# first line of ci.yml that equals the given line.
add_line_after() {
  local at
  at=$(grep -nxF -- "$1" "$CI_YML" | head -n 1 | cut -d: -f1)
  [[ -n "$at" ]] || { fail "no line: $1"; return; }
  { head -n "$at" "$CI_YML"; printf '%s\n' "$2"; tail -n "+$((at + 1))" "$CI_YML"; } > "$TEST_DIR/ci.yml"
}
# move_report_env_after_run <extra>: the report step's env block moves to just after the step's run
# block (key order does not matter in YAML), followed by the extra text.
move_report_env_after_run() {
  EXTRA="$1" awk -v name="      - name: $REPORT_STEP" '
    function flush() { printf "%s%s", env, ENVIRON["EXTRA"]; inside = 0 }
    $0 == name { inside = 1; print; next }
    inside && $0 == "        env:" { in_env = 1 }
    inside && in_env && $0 == "        shell: bash" { in_env = 0 }
    in_env { env = env $0 "\n"; next }
    inside && in_run && $0 !~ /^ *$/ && substr($0, 1, 10) != "          " { flush() }
    inside && $0 == "        run: |" { in_run = 1 }
    { print }
    END { if (inside) flush() }' "$CI_YML" > "$TEST_DIR/ci.yml"
}
test_harness_exits_2_when_the_report_step_shell_continues_onto_the_next_line() {
  add_line_after '        shell: bash' '          --noprofile --norc {0}'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'continues the value of the key above it'
}
test_harness_exits_2_when_the_record_step_condition_continues_onto_the_next_line() {
  add_line_after "        if: always() && (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') && matrix.channel == 'latest'" \
    '          && github.run_attempt == 99'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'continues the value of the key above it'
}
test_harness_exits_2_when_a_step_key_the_harness_only_allows_continues_onto_the_next_line() {
  add_line_after '        run: scripts/check.sh' '          --extra'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'continues the value of the key above it'
}
test_harness_exits_2_when_the_report_job_condition_continues_onto_the_next_line() {
  add_line_after "    if: $REPORT_JOB_IF" '      && false'
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
  add_line_after '        shell: bash' $'\n          # note'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 4 # extraction passed, and the filter matched no test
}
test_harness_accepts_a_mapping_under_an_empty_key() {
  add_line_after '        env:' '          EXTRA_SETTING: 1'
  assert_file_has "$TEST_DIR/ci.yml" 'EXTRA_SETTING: 1'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 4 # extraction passed, and the filter matched no test
}
# run_tests_against_copy <ci.yml> <fragment>: the tests whose name has the fragment, against the copy.
run_tests_against_copy() {
  EXIT_CODE=0
  CANARY_CI_YML="$1" "$BASH" "${BASH_SOURCE[0]}" "$2" > "$OUTPUT" 2>&1 || EXIT_CODE=$?
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
test_harness_exits_2_when_a_quoted_env_value_continues_at_a_shallow_indent_and_hides_a_step_key() {
  add_line_after '        shell: bash' '   "'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'is indented less than a'
}
test_harness_exits_2_when_a_line_at_indent_5_sits_between_the_report_step_keys() {
  add_line_after '        shell: bash' '     x"'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'is indented less than a step key'
}
test_harness_exits_2_when_a_line_at_indent_7_sits_between_the_report_step_keys() {
  add_line_after '        shell: bash' '       x"'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'is indented less than a step key'
}
test_harness_exits_2_when_a_line_at_indent_1_sits_between_the_report_job_keys() {
  add_line_after '    name: open canary issues' ' x"'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'is indented less than a job key'
}
test_harness_exits_2_when_a_line_at_indent_3_sits_between_the_report_job_keys() {
  add_line_after '    name: open canary issues' '   x"'
  run_harness_against "$TEST_DIR/ci.yml"
  assert_exit_code 2
  assert_out_has 'is indented less than a job key'
}

run_tests "$@"
