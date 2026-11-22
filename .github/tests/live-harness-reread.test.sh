#!/usr/bin/env bash
# scripts/live/reread: the helpers in common.sh, against the stub `tmux` and `claude` (the stub
# claude reports 2.1.999). No real session starts.
# Usage: live-harness-reread.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck disable=SC2034 # EXIT_CODE is read by assert_exit_code in canary-report-lib.sh
# shellcheck source=live-harness-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/live-harness-lib.sh"

run_reread() { run_live 'source "$LIVE_DIR/reread/common.sh"; '"$1"; }

# A judgment's own return status, printed as STATUS=<n>.
status_of() { printf 'status=0; %s || status=$?; echo "STATUS=$status"' "$1"; }
assert_status() { assert_file_matches "$OUTPUT" "^STATUS=$1\$"; }

record() { # record <mode> <effective_mode> <engine_version> <action>
  printf '{"component":"reread","mode":"%s","action":"%s","engine_version":"%s",' "$1" "$4" "$3"
  printf '"trigger_values":{"effective_mode":"%s"}}\n' "$2"
}

test_reread_prepare_copies_the_plugin_and_sets_read_mode_in_the_settings_file() {
  mkdir -p "$TEST_DIR/src/.claude-plugin" "$TEST_DIR/src/hooks" "$TEST_DIR/src/types"
  echo '{"name":"reread"}' > "$TEST_DIR/src/.claude-plugin/plugin.json"
  echo 'const TESTED_PARTS = [2, 1, 311]' > "$TEST_DIR/src/hooks/engine-version.ts"
  echo 'export {}' > "$TEST_DIR/src/types/index.d.ts"
  run_reread 'live_init; LIVE_PLUGIN_SOURCE='"$TEST_DIR"'/src; reread_prepare ask
    cat "$LIVE_RUN/plugin/hooks/engine-version.ts"
    jq -c ".pluginConfigs" "$LIVE_RUN/settings.json"
    check ok detail true; live_verdict s'
  assert_exit_code 0
  assert_file_matches "$OUTPUT" 'TESTED_PARTS = \[2, 1, 311\]'
  assert_out_has '{"reread@inline":{"options":{"readMode":"ask"}}}'
}

test_reread_make_probe_files_writes_lf_crlf_and_bom_files() {
  run_reread 'reread_make_probe_files "$TMPDIR/probe"
    wc -l < "$TMPDIR/probe/probe.txt"
    grep -c $'"'"'\r$'"'"' "$TMPDIR/probe/crlf.txt"
    head -c 3 "$TMPDIR/probe/bom.txt" | od -An -tx1 | tr -d " "
    wc -l < "$TMPDIR/probe/bom.txt"'
  assert_exit_code 0
  assert_file_matches "$OUTPUT" '^ *80$'
  assert_file_matches "$OUTPUT" '^30$'
  assert_file_matches "$OUTPUT" '^efbbbf$'
  assert_file_matches "$OUTPUT" '^ *30$'
}

test_reread_read_prompt_names_the_path_and_the_reason_for_the_repeat() {
  run_reread 'reread_read_prompt /work/a.ts ", again after an edit"'
  assert_exit_code 0
  assert_file_matches "$OUTPUT" '^Call the Read tool on /work/a\.ts, again after an edit\. Reply with only: done$'
}

test_reread_show_step_records_prints_none_when_the_step_wrote_no_record() {
  run_reread 'live_init; : > "$LIVE_DECISIONS"; REREAD_BASELINE=$(decision_lines); show_step_records "empty"; check ok detail true; live_verdict s'
  assert_exit_code 0
  assert_out_has 'decision records of the step: empty'
  assert_out_has '(none)'
}

test_reread_show_step_records_prints_the_records_after_the_baseline() {
  run_reread 'live_init; { '"$(declare -f record)"'
    record active ask 2.1.999 dedupe; } > "$LIVE_DECISIONS"
    REREAD_BASELINE=$(decision_lines)
    record active ask 2.1.999 pass >> "$LIVE_DECISIONS"
    show_step_records "one"; check ok detail true; live_verdict s'
  assert_exit_code 0
  assert_out_has '"action":"pass"'
  assert_out_lacks '"action":"dedupe"'
  assert_out_lacks '(none)'
}

test_reread_all_records_are_active_ask_succeeds_for_active_ask_records_of_the_engine() {
  run_reread 'live_init; { '"$(declare -f record)"'
    record active ask 2.1.999 dedupe; record active ask 2.1.999 pass; } > "$LIVE_DECISIONS"
    '"$(status_of reread_all_records_are_active_ask)"
  assert_status 0
}

test_reread_all_records_are_active_ask_fails_for_a_shadow_record_held_at_off() {
  run_reread 'live_init; { '"$(declare -f record)"'
    record active ask 2.1.999 pass; record shadow off 2.1.999 none; } > "$LIVE_DECISIONS"
    '"$(status_of reread_all_records_are_active_ask)"
  assert_status 1
}

test_reread_all_records_are_active_ask_fails_for_another_engine_version() {
  run_reread 'live_init; { '"$(declare -f record)"'
    record active ask 2.1.311 pass; } > "$LIVE_DECISIONS"
    '"$(status_of reread_all_records_are_active_ask)"
  assert_status 1
}

test_reread_all_records_are_active_ask_fails_when_the_log_is_missing() {
  run_reread 'live_init; '"$(status_of reread_all_records_are_active_ask)"
  assert_status 1
}

test_reread_step_has_reads_only_the_records_after_the_baseline() {
  run_reread 'live_init; { '"$(declare -f record)"'
    record active ask 2.1.999 dedupe; } > "$LIVE_DECISIONS"
    REREAD_BASELINE=$(decision_lines)
    record active ask 2.1.999 pass >> "$LIVE_DECISIONS"
    '"$(status_of "reread_step_has '.action == \"pass\"'")"'
    '"$(status_of "reread_step_has '.action == \"dedupe\"'")"
  assert_file_matches "$OUTPUT" '^STATUS=0$'
  assert_file_matches "$OUTPUT" '^STATUS=1$'
}

test_reread_pane_lacks_succeeds_when_the_screen_has_no_match() {
  run_reread 'pane() { echo "all clear"; }; '"$(status_of 'reread_pane_lacks a "has not been read"')"
  assert_status 0
}

test_reread_pane_lacks_fails_when_the_screen_has_a_match() {
  run_reread 'pane() { echo "File has not been read yet"; }; '"$(status_of 'reread_pane_lacks a "has not been read"')"
  assert_status 1
}

test_reread_pane_lacks_fails_when_the_pane_cannot_be_read() {
  run_reread "$(status_of 'reread_pane_lacks a "has not been read"')"
  assert_status 1
}

test_reread_step_raises_an_error_when_the_log_is_unreadable_before_the_prompt_is_typed() {
  run_reread 'live_init
    mkdir "$(debug_log_of c1)"
    submit() { echo "TYPED $2"; }; wait_for() { :; }
    reread_step c1 "read the file"
    check done none true; live_verdict s'
  assert_exit_code 2
  assert_out_has 'could not be read'
  assert_out_lacks 'TYPED read the file'
}

run_tests "$@"
