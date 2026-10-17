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

# hermetic_env <command...>: drops the owner's settings that would steer the harness out of the
# test's own directories or change its timeouts and cleanup.
hermetic_env() { env -u XDG_CACHE_HOME -u LIVE_CWD -u LIVE_KEEP -u LIVE_TIMEOUT -u CLAUDE_CONFIG_DIR "$@"; }

# run_live <bash-snippet>: the snippet runs under `set -euo pipefail` with lib.sh sourced.
run_live() {
  write_live_stubs
  EXIT_CODE=0
  hermetic_env PATH="$TEST_DIR/bin:$JQ_DIR:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" LIVE_DIR="$LIVE_DIR" \
    "$BASH" --noprofile --norc -c 'set -euo pipefail; source "$LIVE_DIR/lib.sh"; '"$1" > "$OUTPUT" 2>&1 || EXIT_CODE=$?
}

# run_live_sh <args...>: runs live.sh itself against the stubs, with HOME and TMPDIR in the test.
run_live_sh() {
  write_live_stubs
  EXIT_CODE=0
  hermetic_env PATH="$TEST_DIR/bin:$JQ_DIR:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" \
    "$BASH" "$LIVE_DIR/live.sh" "$@" > "$OUTPUT" 2>&1 || EXIT_CODE=$?
}

assert_tmux_called() { assert_file_has "$TMUX_LOG" "$1"; }
assert_file_matches() { grep -qaE -- "$2" "$1" || { fail "${1#"$TEST_DIR"/} has no line matching: $2"; show_file "$1"; }; }
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
  assert_out_has '(status 1): false'
}

# bash 3.2 hands an EXIT trap $? = 0 after a `set -u` abort, so the status alone would read PASS.
test_an_unbound_variable_before_the_verdict_is_an_error_not_a_pass() {
  run_live 'live_init; echo "$LIVE_NOT_SET_ANYWHERE"'
  assert_exit_code 2
}

test_live_sh_exits_2_when_a_scenario_fails_before_live_init() {
  write_live_stubs
  local repo=$TEST_DIR/repo
  mkdir -p "$repo/scripts"
  cp -R "$LIVE_DIR" "$repo/scripts/live"
  mkdir -p "$repo/scripts/live/bare/scenarios"
  printf '%s\n' 'echo "$LIVE_NOT_SET_ANYWHERE"' 'scenario_run() { :; }' > "$repo/scripts/live/bare/scenarios/s.sh"
  mkdir -p "$repo/plugins/bare/.claude-plugin"
  EXIT_CODE=0
  hermetic_env PATH="$TEST_DIR/bin:$JQ_DIR:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" \
    "$BASH" "$repo/scripts/live/live.sh" bare s > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  assert_exit_code 2
}

test_a_failed_check_is_a_fail() {
  run_live 'live_init; check x detail false; live_verdict s'
  assert_exit_code 1
  assert_out_lacks 'before it reached a verdict'
}

test_a_run_directory_is_removed_after_a_pass() {
  run_live 'live_init; echo "RUN=$LIVE_RUN"; live_verdict s'
  assert_exit_code 0
  local run_dir
  run_dir=$(sed -n 's/^RUN=//p' "$OUTPUT")
  [[ -n "$run_dir" ]] || fail 'the snippet printed no run directory'
  assert_no_file "$run_dir"
}

test_a_wait_that_never_succeeds_ends_in_an_error() {
  run_live 'LIVE_TIMEOUT=1; live_init; wait_for "a thing that never happens" false'
  assert_exit_code 2
  assert_out_has 'timed out after 1s waiting for a thing that never happens'
  assert_out_has '(condition: false)'
}

test_a_timeout_that_is_not_a_whole_number_is_an_error() {
  run_live 'LIVE_TIMEOUT=soon; live_init'
  assert_exit_code 2
  assert_out_has 'LIVE_TIMEOUT must be a whole number'
}

test_log_count_is_zero_before_the_debug_log_exists() {
  run_live 'live_init; echo "COUNT=$(log_count a x)"; live_verdict s'
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
  hermetic_env PATH="$TEST_DIR/bin:$JQ_DIR:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" LIVE_CWD=/dev/null/cwd \
    "$BASH" "$LIVE_DIR/live.sh" handoff held-prompt-box > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  assert_exit_code 2
}

test_busy_abandon_is_a_fail_when_the_old_transcript_has_no_compaction() {
  run_live 'source "$LIVE_DIR/handoff/common.sh"; source "$LIVE_DIR/handoff/scenarios/busy-abandon.sh"
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
  local repo=$TEST_DIR/repo session_cwd
  mkdir -p "$repo/scripts"
  cp -R "$LIVE_DIR" "$repo/scripts/live"
  make_plugin_fixture "$repo/plugins/handoff"
  git -C "$repo" init -q
  EXIT_CODE=0
  hermetic_env PATH="$TEST_DIR/bin:$JQ_DIR:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" \
    "$BASH" "$repo/scripts/live/live.sh" handoff held-prompt-box > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  session_cwd=$(sed -n 's/^new-session .* -c \([^ ]*\) .*/\1/p' "$TMUX_LOG")
  [[ -n "$session_cwd" ]] || fail 'tmux new-session was not called'
  ! git -C "$session_cwd" rev-parse --is-inside-work-tree > /dev/null 2>&1 || fail "sessions start inside a git work tree: $session_cwd"
}

# A home directory that is itself a git work tree (dotfiles kept in a repo at $HOME) puts the default
# working directory inside it.
test_live_sh_starts_sessions_outside_a_git_work_tree_at_home() {
  write_live_stubs
  local repo=$TEST_DIR/repo session_cwd
  mkdir -p "$repo/scripts"
  cp -R "$LIVE_DIR" "$repo/scripts/live"
  make_plugin_fixture "$repo/plugins/handoff"
  git -C "$TEST_DIR/home" init -q
  EXIT_CODE=0
  hermetic_env PATH="$TEST_DIR/bin:$JQ_DIR:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" \
    "$BASH" "$repo/scripts/live/live.sh" handoff held-prompt-box > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  session_cwd=$(sed -n 's/^new-session .* -c \([^ ]*\) .*/\1/p' "$TMUX_LOG")
  [[ -n "$session_cwd" ]] || return 0
  ! git -C "$session_cwd" rev-parse --is-inside-work-tree > /dev/null 2>&1 || fail "sessions start inside a git work tree: $session_cwd"
}

test_interrupt_kills_the_sessions() {
  run_live 'live_init; LIVE_SESSIONS=(live-4-a); kill -INT $$; sleep 5 & wait $!'
  assert_exit_code 130
  assert_tmux_called 'kill-session -t =live-4-a'
}

# Closing the terminal hangs up stderr too, so a write to it fails. The cleanup must still kill the
# sessions and keep the signal's status: set -e stays on inside the EXIT trap.
test_hangup_with_stderr_gone_still_kills_the_sessions() {
  run_live 'live_init; LIVE_SESSIONS=(live-7-a); LIVE_WAITING="a thing"; exec 2>&-; kill -HUP $$; sleep 5 & wait $!'
  assert_exit_code 129
  assert_tmux_called 'kill-session -t =live-7-a'
}

# `live.sh ... 2>&1 | tee run.log` then Ctrl-C: the INT reaches tee too, so the cleanup writes into a
# pipe with no reader.
test_interrupt_with_the_output_pipe_gone_still_kills_the_sessions() {
  run_live 'live_init; LIVE_SESSIONS=(live-8-a); LIVE_WAITING="a thing"; exec 2> >(:); sleep 1; kill -INT $$; sleep 5 & wait $!'
  assert_exit_code 130
  assert_tmux_called 'kill-session -t =live-8-a'
}

# A second Ctrl-C while the cleanup shows the panes of an interrupted wait.
test_a_second_interrupt_during_cleanup_still_kills_the_sessions() {
  run_live 'live_init; LIVE_SESSIONS=(live-9-a); LIVE_NAMES=(a); LIVE_WAITING="a thing"
    pane() { kill -INT $$; echo screen; }
    kill -INT $$; sleep 5 & wait $!'
  assert_exit_code 130
  assert_tmux_called 'kill-session -t =live-9-a'
}

# A run directory that cannot be removed in full (here a read-only subdirectory; live, a session
# still writing as it is killed) does not turn a PASS into exit 1.
test_a_pass_stays_a_pass_when_the_run_directory_cannot_be_removed() {
  run_live 'live_init; echo "RUN=$LIVE_RUN"; mkdir "$LIVE_RUN/locked"; touch "$LIVE_RUN/locked/f"; chmod 500 "$LIVE_RUN/locked"
    check x detail true; live_verdict s'
  chmod -R u+w "$TEST_DIR/tmp"
  assert_exit_code 0
  assert_out_has 'PASS s (1 checks)'
}

# Ctrl-\ sends SIGQUIT to the foreground job. bash 3.2 dies of it without running the EXIT trap.
test_quit_kills_the_sessions() {
  run_live 'live_init; LIVE_SESSIONS=(live-10-a); kill -QUIT $$; sleep 5 & wait $!'
  assert_exit_code 131
  assert_tmux_called 'kill-session -t =live-10-a'
}

# Ctrl-C while `tmux new-session` runs: the server has made the session, but the INT trap exits before
# live_start records it, so the cleanup does not know to kill it.
test_interrupt_while_tmux_starts_a_session_still_kills_it() {
  run_live 'live_init; LIVE_CWD=$TMPDIR
    tmux() { echo "$*" >> "$TMPDIR/../tmux-calls"; [[ "$1" != new-session ]] || kill -INT $$; return 0; }
    live_start a'
  assert_exit_code 130
  assert_tmux_called 'kill-session -t =live-'
}

# With SIGPIPE ignored (as under an agent's shell), `live.sh ... | head` that closes the pipe just as
# the verdict prints makes printf fail after LIVE_VERDICT_REACHED=1: every check passed, yet it exits 1.
test_a_verdict_that_cannot_be_printed_is_not_a_fail_when_every_check_passed() {
  run_live 'trap "" PIPE; live_init; check x detail true; exec > >(:); sleep 1; live_verdict s'
  [[ "$EXIT_CODE" -ne 1 ]] || fail "exit 1 (FAIL) with every check passing; output: $(cat "$OUTPUT")"
}

# In a terminal SIGPIPE has its default action. `live.sh ... | grep -q PASS` (or `| head`) closes the
# pipe at its first match, the next line the harness prints kills it, and bash runs no EXIT trap for
# a signal it does not catch: the claude sessions keep running. perl restores the default the test
# runner may have inherited as ignored, which bash cannot undo itself.
test_a_closed_stdout_pipe_still_kills_the_sessions() {
  write_live_stubs
  EXIT_CODE=0
  hermetic_env PATH="$TEST_DIR/bin:$JQ_DIR:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" LIVE_DIR="$LIVE_DIR" \
    perl -e '$SIG{PIPE} = "DEFAULT"; exec @ARGV or die' "$BASH" --noprofile --norc -c 'set -euo pipefail; source "$LIVE_DIR/lib.sh"
      live_init; LIVE_SESSIONS=(live-11-a); exec > >(:); sleep 1; check x detail true; live_verdict s' > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  assert_tmux_called 'kill-session -t =live-11-a'
}

# A second Ctrl-\ while the cleanup shows the panes of an interrupted wait.
test_a_second_quit_during_cleanup_still_kills_the_sessions() {
  run_live 'live_init; LIVE_SESSIONS=(live-12-a); LIVE_NAMES=(a); LIVE_WAITING="a thing"
    pane() { kill -QUIT $$; echo screen; }
    kill -QUIT $$; sleep 5 & wait $!'
  assert_exit_code 131
  assert_tmux_called 'kill-session -t =live-12-a'
}

test_a_run_directory_is_kept_after_a_pass_when_keep_is_set() {
  run_live 'LIVE_KEEP=1; live_init; echo "RUN=$LIVE_RUN"; live_verdict s'
  assert_exit_code 0
  assert_out_has 'run directory kept'
  assert_file_exists "$(sed -n 's/^RUN=//p' "$OUTPUT")"
}

test_a_run_directory_is_kept_after_a_fail() {
  run_live 'live_init; check x detail false; live_verdict s'
  assert_exit_code 1
  assert_out_has 'run directory kept'
}

test_a_passing_check_is_a_pass() {
  run_live 'live_init; check x detail true; live_verdict s'
  assert_exit_code 0
  assert_out_has 'PASS  x'
  assert_out_has 'PASS s (1 checks)'
}

test_a_missing_tool_is_an_error() {
  # jq's directory is on PATH and may hold a real tmux, so the stub alone cannot be removed.
  run_live 'PATH=$TMPDIR/no-tools; live_require'
  assert_exit_code 2
  assert_out_has "'tmux' is not installed"
}

test_live_start_is_an_error_when_tmux_cannot_start_the_session() {
  run_live 'LIVE_RUN=$TMPDIR; LIVE_THRIFT_HOME=$TMPDIR; LIVE_CWD=$TMPDIR; LIVE_NAMES=(); live_start a'
  assert_exit_code 2
  assert_out_has 'tmux could not start session'
}

test_live_start_isolates_the_session_from_the_owners_settings_memory_and_session() {
  run_live 'LIVE_RUN=$TMPDIR; LIVE_THRIFT_HOME=$TMPDIR; LIVE_CWD=$TMPDIR; LIVE_NAMES=(); live_start a'
  assert_tmux_called '--setting-sources project'
  assert_tmux_called 'CLAUDE_CODE_DISABLE_AUTO_MEMORY=1'
  assert_tmux_called 'CLAUDE_CODE_DISABLE_CLAUDE_MDS=1'
  assert_tmux_called '--append-system-prompt'
  assert_tmux_called "THRIFT_HOME=$TEST_DIR/tmp"
  assert_tmux_called "--debug-file $TEST_DIR/tmp/debug-a.log"
}

test_start_dialogs_cleared_is_an_error_when_the_session_exited() {
  run_live 'live_init; start_dialogs_cleared a'
  assert_exit_code 2
  assert_out_has 'exited at start-up'
}

test_start_dialogs_cleared_answers_the_claude_md_imports_dialog_and_keeps_waiting() {
  run_live 'live_init; tmux() { command tmux "$@" || true; }
    pane() { echo "Allow external CLAUDE.md file imports"; }
    ! start_dialogs_cleared a
    live_verdict s'
  assert_exit_code 0
  assert_tmux_called 'send-keys -t =live-'
  assert_tmux_called '-a: Enter'
}

test_start_dialogs_cleared_is_an_error_on_a_dialog_it_will_not_answer() {
  run_live 'live_init; LIVE_CWD=$TMPDIR; tmux() { command tmux "$@" || true; }
    pane() { printf "%s\n" "Do you trust the files in this folder?" "Enter to confirm"; }
    start_dialogs_cleared a'
  assert_exit_code 2
  assert_out_has 'will not answer'
  assert_tmux_not_called 'send-keys'
}

test_start_dialogs_cleared_succeeds_once_the_prompt_box_is_up() {
  run_live 'live_init; tmux() { command tmux "$@" || true; }
    pane() { printf "%s\n" "──────" "❯ " "──────"; }
    start_dialogs_cleared a
    live_verdict s'
  assert_exit_code 0
}

test_box_text_prints_the_box_between_the_last_two_rules_without_the_glyph() {
  run_live 'live_init
    pane() { printf "%s\n" "──────" "❯ old" "──────" "output" "──────" "❯ hello there" "──────" "footer"; }
    echo "BOX=[$(box_text a)]"
    live_verdict s'
  assert_exit_code 0
  assert_out_has 'BOX=[hello there]'
}

test_record_count_is_zero_before_the_decision_log_exists() {
  run_live 'live_init; echo "COUNT=$(record_count none)"; ! record_exists none; live_verdict s'
  assert_exit_code 0
  assert_out_has 'COUNT=0'
}

test_live_sh_list_prints_each_plugin_and_scenario() {
  run_live_sh --list
  assert_exit_code 0
  assert_out_has 'handoff busy-abandon'
  assert_out_has 'handoff held-prompt-box'
}

test_live_sh_exits_2_with_usage_for_fewer_than_two_arguments() {
  run_live_sh handoff
  assert_exit_code 2
  assert_out_has 'Usage:'
}

test_live_sh_exits_2_with_usage_for_a_plugin_dir_with_no_value() {
  run_live_sh handoff held-prompt-box --plugin-dir
  assert_exit_code 2
  assert_out_has 'Usage:'
}

test_live_sh_exits_2_with_usage_for_an_unknown_option() {
  run_live_sh handoff held-prompt-box --bogus
  assert_exit_code 2
  assert_out_has 'Usage:'
}

test_live_sh_accepts_keep_as_an_option() {
  run_live_sh handoff held-prompt-box --keep --plugin-dir "$TEST_DIR/nowhere"
  assert_exit_code 2
  assert_out_has 'is not a directory'
  assert_out_lacks 'Usage:'
}

test_live_sh_exits_2_for_a_scenario_that_does_not_exist() {
  run_live_sh handoff nope
  assert_exit_code 2
  assert_out_has "No scenario 'nope' for plugin 'handoff'"
  assert_out_has 'handoff held-prompt-box'
}

test_live_sh_exits_2_for_a_plugin_dir_that_is_not_a_plugin() {
  mkdir -p "$TEST_DIR/plain"
  run_live_sh handoff held-prompt-box --plugin-dir "$TEST_DIR/plain"
  assert_exit_code 2
  assert_out_has 'is not a plugin directory'
}

test_live_sh_runs_a_plugin_that_has_scenarios_but_no_common_sh() {
  write_live_stubs
  local repo=$TEST_DIR/repo
  mkdir -p "$repo/scripts/live/bare/scenarios"
  cp "$LIVE_DIR/live.sh" "$LIVE_DIR/lib.sh" "$repo/scripts/live/"
  printf '%s\n' 'scenario_run() { check "scenario ran" "no" true; }' > "$repo/scripts/live/bare/scenarios/only.sh"
  make_plugin_fixture "$repo/plugins/bare"
  EXIT_CODE=0
  hermetic_env PATH="$TEST_DIR/bin:$JQ_DIR:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" \
    "$BASH" "$repo/scripts/live/live.sh" bare only > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  assert_exit_code 0
  assert_out_has 'PASS bare/only (1 checks)'
}

# `-t name` falls back to a prefix or window-name match when the session is gone, so every target is
# exact. A pane target needs the trailing colon: tmux 3.8 answers "can't find pane: =name" without it.
test_the_pane_is_captured_from_the_exact_session() {
  run_live 'live_init; pane a || true'
  assert_tmux_called 'capture-pane -p -J -t =live-'
  assert_file_matches "$TMUX_LOG" '-t =live-[^ :]*-a:$'
}

test_keys_are_sent_to_the_exact_session() {
  run_live 'live_init; press a Enter || true'
  assert_file_matches "$TMUX_LOG" '^send-keys -t =live-[^ :]*-a: Enter$'
}

test_typed_text_goes_to_the_exact_session() {
  run_live 'live_init; LIVE_TIMEOUT=1; type_text a hello || true'
  assert_file_matches "$TMUX_LOG" '^send-keys -t =live-[^ :]*-a: -l -- hello$'
}

test_no_tmux_target_in_the_harness_is_a_bare_session_name() {
  ! grep -rnE -- '-t "?\$\(session_of' "$LIVE_DIR" || fail 'a tmux target is built without the exact-match prefix'
}

# A capture bigger than the pipe buffer used to make `pane | grep -q` die of SIGPIPE inside the pane
# function, and pipefail then read a real match as "no match".
test_pane_has_finds_a_match_in_a_capture_larger_than_the_pipe_buffer() {
  run_live 'live_init
    pane() { echo needle; head -c 400000 /dev/zero | tr "\\0" x; echo; }
    for _ in 1 2 3 4 5 6 7 8 9 10; do pane_has a needle; done
    check x detail true; live_verdict s'
  assert_exit_code 0
}

test_pane_has_is_false_when_the_pane_cannot_be_read() {
  run_live 'live_init; pane() { return 1; }
    ! pane_has a anything
    check x detail true; live_verdict s'
  assert_exit_code 0
}

test_box_shows_finds_the_typed_text_in_a_large_box() {
  run_live 'live_init
    box_text() { echo "hello there"; head -c 400000 /dev/zero | tr "\\0" x; echo; }
    for _ in 1 2 3 4 5 6 7 8 9 10; do box_shows a "hello there"; done
    check x detail true; live_verdict s'
  assert_exit_code 0
}

# live_claude_command is what the tmux server runs through sh. These tests run it as tmux would, with
# a stub claude that prints its own path and environment.
write_env_dumping_claude() { # write_env_dumping_claude <path>
  mkdir -p "$(dirname "$1")"
  printf '#!/bin/sh\necho "BIN=$0"\nenv\n' > "$1"
  chmod +x "$1"
}

run_claude_command() { # run_claude_command <env assignments...> -- <bash-snippet>
  local assignments=()
  while [[ "$1" != -- ]]; do assignments+=("$1"); shift; done
  shift
  EXIT_CODE=0
  hermetic_env PATH="$TEST_DIR/bin:$JQ_DIR:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" LIVE_DIR="$LIVE_DIR" ${assignments[@]+"${assignments[@]}"} \
    "$BASH" --noprofile --norc -c 'set -euo pipefail; source "$LIVE_DIR/lib.sh"; '"$1" > "$OUTPUT" 2>&1 || EXIT_CODE=$?
}

test_the_session_command_drops_the_claude_variables_it_inherited() {
  write_live_stubs
  write_env_dumping_claude "$TEST_DIR/bin/claude"
  run_claude_command CLAUDE_PID=4242 CLAUDE_EFFORT=high CLAUDE_CODE_EXECPATH=/x CLAUDE_CODE_VERSION=9 CLAUDECODE=1 CLAUDE_CODE_SESSION_ID=abc -- \
    'LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR; sh -c "$(live_claude_command a)"'
  assert_exit_code 0
  assert_out_has 'BIN='
  assert_out_lacks 'CLAUDE_PID='
  assert_out_lacks 'CLAUDE_EFFORT='
  assert_out_lacks 'CLAUDE_CODE_EXECPATH='
  assert_out_lacks 'CLAUDE_CODE_VERSION='
  assert_out_lacks 'CLAUDECODE='
  assert_out_lacks 'CLAUDE_CODE_SESSION_ID='
}

test_the_session_command_keeps_the_login_and_the_variables_the_harness_sets() {
  write_live_stubs
  write_env_dumping_claude "$TEST_DIR/bin/claude"
  run_claude_command CLAUDE_CONFIG_DIR=/cfg CLAUDE_CODE_OAUTH_TOKEN=tok CLAUDE_CODE_USE_BEDROCK=1 CLAUDE_PID=1 -- \
    'LIVE_THRIFT_HOME=/thrift-home; LIVE_RUN=$TMPDIR; sh -c "$(live_claude_command a)"'
  assert_exit_code 0
  assert_out_has 'CLAUDE_CONFIG_DIR=/cfg'
  assert_out_has 'CLAUDE_CODE_OAUTH_TOKEN=tok'
  assert_out_has 'CLAUDE_CODE_USE_BEDROCK=1'
  assert_out_has 'THRIFT_HOME=/thrift-home'
  assert_out_has 'CLAUDE_CODE_DISABLE_AUTO_MEMORY=1'
  assert_out_has 'CLAUDE_CODE_DISABLE_CLAUDE_MDS=1'
}

# A tmux server that was already running hands new sessions its own environment, so a bare `claude`
# in the command can be another binary than the one live_require checked.
test_the_session_command_runs_the_claude_that_live_require_checked() {
  write_env_dumping_claude "$TEST_DIR/checked/claude"
  write_live_stubs
  write_env_dumping_claude "$TEST_DIR/bin/claude"
  run_claude_command -- \
    'LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR; PATH='"$TEST_DIR"'/checked:$PATH live_require
     PATH=$TMPDIR/server-path:/usr/bin:/bin sh -c "$(live_claude_command a)"'
  assert_exit_code 0
  assert_out_has "BIN=$TEST_DIR/checked/claude"
}

test_the_session_command_passes_the_path_the_harness_checked() {
  write_live_stubs
  write_env_dumping_claude "$TEST_DIR/bin/claude"
  run_claude_command -- \
    'LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR; live_require
     PATH=/usr/bin:/bin sh -c "$(live_claude_command a)"'
  assert_exit_code 0
  assert_out_has "PATH=$TEST_DIR/bin:"
}

# A recycled pid plus a session an earlier `kill -9` left behind would have the same name; a random
# part of the name keeps this run's sessions apart from every other run's.
test_session_names_carry_a_random_part_that_differs_between_runs() {
  run_live 'echo "NAME=$(session_of a)"'
  local first
  first=$(sed -n 's/^NAME=//p' "$OUTPUT")
  run_live 'echo "NAME=$(session_of a)"'
  [[ "$first" =~ ^live-[0-9]+-[0-9a-f]{6,}-a$ ]] || fail "unexpected session name: $first"
  [[ "$first" != "$(sed -n 's/^NAME=//p' "$OUTPUT")" ]] || fail "two runs made the same session name: $first"
}

test_the_session_name_is_stable_within_a_run() {
  run_live 'first=$(session_of a); second=$(session_of a); [[ "$first" == "$second" ]]; check x detail true; live_verdict s'
  assert_exit_code 0
}

test_cleanup_never_lists_sessions_to_find_some_to_kill() {
  run_live 'live_init; LIVE_SESSIONS=(live-1-a); check x detail true; live_verdict s'
  assert_exit_code 0
  assert_tmux_called 'kill-session -t =live-1-a'
  assert_tmux_not_called 'list-sessions'
  assert_tmux_not_called 'kill-server'
}

# A signal that arrives between the trap firing and the cleanup's first line must not cut it short.
test_signals_are_ignored_by_the_time_the_cleanup_starts() {
  run_live 'live_init; live_cleanup() { trap -p INT TERM HUP PIPE QUIT; exit 130; }; kill -INT $$; sleep 5 & wait $!'
  assert_exit_code 130
  assert_out_has "trap -- '' SIGINT"
  assert_out_has "trap -- '' SIGTERM"
  assert_out_has "trap -- '' SIGHUP"
  assert_out_has "trap -- '' SIGQUIT"
}

run_tests "$@"
