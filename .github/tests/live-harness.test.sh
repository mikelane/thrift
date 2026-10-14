#!/usr/bin/env bash
# scripts/live: the exit paths and guards of the tmux harness, against a stub `tmux` and `claude`.
# No real session starts. LIVE_UNDER_TEST points at another copy of scripts/live.
# Usage: live-harness.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"

LIVE_DIR=${LIVE_UNDER_TEST:-$REPO_ROOT/scripts/live}
JQ_DIR=$(dirname "$(command -v jq)")

write_live_stubs() {
  mkdir -p "$TEST_DIR/bin" "$TEST_DIR/tmp" "$TEST_DIR/home"
  TMUX_LOG=$TEST_DIR/tmux-calls
  : > "$TMUX_LOG"
  printf '#!/bin/sh\necho "$*" >> "%s"\nexit 1\n' "$TMUX_LOG" > "$TEST_DIR/bin/tmux"
  printf '#!/bin/sh\necho "2.1.999 (Claude Code)"\n' > "$TEST_DIR/bin/claude"
  chmod +x "$TEST_DIR/bin/tmux" "$TEST_DIR/bin/claude"
}

# run_live <bash-snippet>: the snippet runs under `set -euo pipefail` with lib.sh sourced.
run_live() {
  write_live_stubs
  EXIT_CODE=0
  env PATH="$TEST_DIR/bin:$JQ_DIR:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" LIVE_DIR="$LIVE_DIR" \
    "$BASH" --noprofile --norc -c 'set -euo pipefail; source "$LIVE_DIR/lib.sh"; '"$1" > "$OUTPUT" 2>&1 || EXIT_CODE=$?
}

assert_tmux_called() { assert_file_has "$TMUX_LOG" "$1"; }
assert_tmux_not_called() { assert_file_lacks "$TMUX_LOG" "$1"; }

test_cleanup_kills_each_own_session_by_exact_name_and_never_the_server() {
  run_live 'live_init; LIVE_SESSIONS=(live-1-a live-1-b); live_verdict x'
  assert_exit_code 0
  assert_tmux_called 'kill-session -t =live-1-a'
  assert_tmux_called 'kill-session -t =live-1-b'
  assert_tmux_not_called 'kill-server'
}

test_hangup_kills_the_sessions_and_keeps_the_run_directory() {
  run_live 'live_init; LIVE_SESSIONS=(live-2-a); kill -HUP $$; sleep 5 & wait $!'
  assert_exit_code 129
  assert_tmux_called 'kill-session -t =live-2-a'
  assert_out_has 'run directory kept'
}

test_terminate_kills_the_sessions() {
  run_live 'live_init; LIVE_SESSIONS=(live-3-a); kill -TERM $$; sleep 5 & wait $!'
  assert_exit_code 143
  assert_tmux_called 'kill-session -t =live-3-a'
}

test_a_command_that_fails_before_the_verdict_is_an_error_not_a_fail() {
  run_live 'live_init; false'
  assert_exit_code 2
  assert_out_has 'before it reached a verdict'
}

test_a_failed_check_is_a_fail() {
  run_live 'live_init; check x detail false; live_verdict s'
  assert_exit_code 1
  assert_out_lacks 'before it reached a verdict'
}

test_a_run_directory_is_removed_after_a_pass() {
  run_live 'live_init; echo "RUN=$LIVE_RUN"; live_verdict s'
  assert_exit_code 0
  local run
  run=$(sed -n 's/^RUN=//p' "$OUTPUT")
  [[ -n "$run" ]] || fail 'the snippet printed no run directory'
  assert_no_file "$run"
}

test_a_wait_that_never_succeeds_ends_in_an_error() {
  run_live 'LIVE_TIMEOUT=1; live_init; wait_for "a thing that never happens" false'
  assert_exit_code 2
  assert_out_has 'timed out after 1s waiting for a thing that never happens'
}

test_a_timeout_that_is_not_a_whole_number_is_an_error() {
  run_live 'LIVE_TIMEOUT=soon; live_init'
  assert_exit_code 2
  assert_out_has 'LIVE_TIMEOUT must be a whole number'
}

test_log_count_is_zero_before_the_debug_log_exists() {
  run_live 'live_init; echo "COUNT=$(log_count a x)"'
  assert_exit_code 0
  assert_out_has 'COUNT=0'
}

test_ts_before_orders_timestamps_and_refuses_empty_ones() {
  run_live 'live_init
    ts_before 2026-10-14T05:00:00.100Z 2026-10-14T05:00:00.900Z
    ! ts_before 2026-10-14T05:00:00.900Z 2026-10-14T05:00:00.100Z
    ! ts_before 2026-10-14T05:00:00.100Z 2026-10-14T05:00:00.100Z
    ! ts_before "" 2026-10-14T05:00:00.100Z
    ! ts_before 2026-10-14T05:00:00.100Z ""
    live_verdict s'
  assert_exit_code 0
}

test_busy_abandon_waits_for_the_reason_not_for_any_none_record() {
  local scenario=$LIVE_DIR/handoff/scenarios/busy-abandon.sh
  assert_file_lacks "$scenario" 'record_exists none'
  run_live 'source "$LIVE_DIR/handoff/scenarios/busy-abandon.sh"
    live_init
    printf "%s\n" "{\"action\":\"none\",\"trigger_values\":{\"point\":\"turn-end\"}}" > "$LIVE_DECISIONS"
    ! record_has_reason background_busy
    printf "%s\n" "{\"action\":\"none\",\"trigger_values\":{\"reason\":\"background_busy\"}}" >> "$LIVE_DECISIONS"
    record_has_reason background_busy
    live_verdict s'
  assert_exit_code 0
}

test_live_sh_exits_2_for_a_plugin_dir_that_does_not_exist() {
  EXIT_CODE=0
  env PATH="/usr/bin:/bin" "$BASH" "$LIVE_DIR/live.sh" handoff held-prompt-box --plugin-dir "$TEST_DIR/nowhere" > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  assert_exit_code 2
  assert_out_has 'is not a directory'
}

test_live_sh_exits_2_for_a_name_that_is_not_a_slug() {
  EXIT_CODE=0
  env PATH="/usr/bin:/bin" "$BASH" "$LIVE_DIR/live.sh" 'handoff' 'x;touch pwned' > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  assert_exit_code 2
  assert_no_file "$PWD/pwned"
}

make_plugin_fixture() { # make_plugin_fixture <dir> [omit-constant]
  mkdir -p "$1/.claude-plugin" "$1/hooks"
  echo '{"userConfig":{"handoffContextTokens":{"min":80000}}}' > "$1/.claude-plugin/plugin.json"
  echo "export const TESTED_THROUGH = '2.1.1'" > "$1/hooks/engine-version.ts"
  echo 'const MIN_THRESHOLD = 80_000' > "$1/hooks/signals.ts"
  [[ "${2:-}" != omit-threshold ]] || echo 'const OTHER = 1' > "$1/hooks/signals.ts"
}

test_handoff_prepare_patches_the_copy_and_leaves_the_source_alone() {
  make_plugin_fixture "$TEST_DIR/src"
  run_live 'source "$LIVE_DIR/handoff/common.sh"
    live_init; LIVE_PLUGIN_SOURCE='"$TEST_DIR"'/src; handoff_prepare "{}"
    cat "$LIVE_RUN/plugin/hooks/engine-version.ts" "$LIVE_RUN/plugin/hooks/signals.ts"
    jq -c .userConfig "$LIVE_RUN/plugin/.claude-plugin/plugin.json"
    live_verdict s'
  assert_exit_code 0
  assert_out_has "TESTED_THROUGH = '2.1.999'"
  assert_out_has 'MIN_THRESHOLD = 1_000'
  assert_out_has '"min":1000'
  assert_file_has "$TEST_DIR/src/hooks/signals.ts" '80_000'
}

test_handoff_prepare_is_an_error_when_a_constant_it_patches_is_gone() {
  make_plugin_fixture "$TEST_DIR/src" omit-threshold
  run_live 'source "$LIVE_DIR/handoff/common.sh"
    live_init; LIVE_PLUGIN_SOURCE='"$TEST_DIR"'/src; handoff_prepare "{}"'
  assert_exit_code 2
  assert_out_has "no line starting 'const MIN_THRESHOLD = '"
}

test_live_sh_exits_2_when_it_cannot_make_its_working_directory() {
  write_live_stubs
  EXIT_CODE=0
  env PATH="$TEST_DIR/bin:$JQ_DIR:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" LIVE_CWD=/dev/null/cwd \
    "$BASH" "$LIVE_DIR/live.sh" handoff held-prompt-box > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  assert_exit_code 2
}

test_busy_abandon_is_a_fail_when_the_old_transcript_has_no_compaction() {
  run_live 'source "$LIVE_DIR/handoff/scenarios/busy-abandon.sh"
    set -uo pipefail
    CLAUDE_CONFIG_DIR=$HOME/.claude
    live_init
    mkdir -p "$CLAUDE_CONFIG_DIR/projects/p"
    echo "{\"type\":\"user\"}" > "$CLAUDE_CONFIG_DIR/projects/p/old.jsonl"
    transcript_summary old
    check "compacted" "no marker" transcript_is_compacted old
    live_verdict s'
  assert_exit_code 1
  assert_out_has 'FAIL  compacted'
}

# Every engine-facing helper is a no-op, so only the scenario's own control flow runs: the plugin
# cleared instead of abandoning, which is the misbehavior the scenario's checks exist to report.
test_busy_abandon_is_a_fail_when_the_handoff_clears_instead_of_stopping() {
  run_live 'source "$LIVE_DIR/handoff/common.sh"; source "$LIVE_DIR/handoff/scenarios/busy-abandon.sh"
    live_init
    handoff_prepare() { :; }; handoff_start() { :; }; live_start() { :; }; say_apple() { :; }
    submit() { :; }; type_text() { :; }; press() { :; }; pane_has() { :; }; log_has() { :; }
    turns_done_above() { :; }; show_pane() { :; }; show_box() { :; }; show_log() { :; }; box_text() { :; }
    printf "%s\n" "{\"action\":\"cleared\",\"session_id\":\"old\",\"trigger_values\":{}}" > "$LIVE_DECISIONS"
    LIVE_TIMEOUT=1
    scenario_run
    live_verdict s'
  assert_exit_code 1
  assert_out_has 'FAIL  the handoff did not clear'
}

test_box_is_empty_fails_when_the_screen_shows_no_prompt_box() {
  run_live 'source "$LIVE_DIR/handoff/scenarios/held-prompt-box.sh"
    live_init
    pane() { printf "%s\n" "Do you want to proceed?" "> 1. Yes" "  2. No"; }
    check "box empty" "no box" box_is_empty a
    live_verdict s'
  assert_exit_code 1
  assert_out_has 'FAIL  box empty'
}

test_a_kept_run_directory_stays_inside_the_test_tmpdir() {
  run_live 'live_init; echo "RUN=$LIVE_RUN"; false'
  assert_exit_code 2
  assert_out_has "RUN=$TEST_DIR/tmp/"
}

test_live_start_sets_the_permission_mode_instead_of_inheriting_the_owners() {
  run_live 'LIVE_RUN=$TMPDIR; LIVE_THRIFT_HOME=$TMPDIR; LIVE_CWD=$TMPDIR; LIVE_NAMES=(); live_start a'
  assert_tmux_called 'new-session'
  assert_tmux_called '--permission-mode'
}

test_live_sh_starts_sessions_outside_any_git_work_tree() {
  write_live_stubs
  local repo=$TEST_DIR/repo cwd
  mkdir -p "$repo/scripts"
  cp -R "$LIVE_DIR" "$repo/scripts/live"
  make_plugin_fixture "$repo/plugins/handoff"
  git -C "$repo" init -q
  EXIT_CODE=0
  env PATH="$TEST_DIR/bin:$JQ_DIR:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" \
    "$BASH" "$repo/scripts/live/live.sh" handoff held-prompt-box > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  cwd=$(sed -n 's/^new-session .* -c \([^ ]*\) .*/\1/p' "$TMUX_LOG")
  [[ -n "$cwd" ]] || fail 'tmux new-session was not called'
  ! git -C "$cwd" rev-parse --is-inside-work-tree > /dev/null 2>&1 || fail "sessions start inside a git work tree: $cwd"
}

run_tests "$@"
