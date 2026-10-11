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
  { cat "$CI_YML"; printf '  decoy:\n    steps:\n      - name: %s\n        run: |\n          gh issue create\n' "$REPORT_STEP"; } > "$TEST_DIR/ci.yml"
  extract_report_step "$TEST_DIR/ci.yml" > "$OUTPUT" 2>&1 && fail 'extraction passed with the step name in two places'
  assert_out_has 'appears 2 times'
  return 0
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
  job=$(awk '/^  report:/{f=1;next} f&&/^  [A-Za-z]/{exit} f' "$CI_YML")
  [[ "$job" == *"- name: $REPORT_STEP"* ]] || { fail 'no report job holding the report step was found'; return; }
  [[ "$job" != *'actions/checkout'* ]] || fail 'the report job checks out the repository'
  [[ "$job" != *'scripts/'* ]] || fail 'the report job runs a script from the repository'
}

run_tests "$@"
