#!/usr/bin/env bash
# scripts/live: the exit paths of the tmux harness (cleanup, signals, verdicts, waits and run-directory
# handling), against a stub `tmux` and `claude`. No real session starts.
# Usage: live-harness-lifecycle.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=live-harness-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/live-harness-lib.sh"

test_cleanup_kills_each_own_session_by_exact_name_and_never_the_server() {
  run_live 'live_init; LIVE_SESSIONS=(live-1-a live-1-b); check ok detail true; live_verdict x'
  assert_exit_code 0
  assert_tmux_called 'kill-session -t =live-1-a'
  assert_tmux_called 'kill-session -t =live-1-b'
  assert_tmux_not_called 'kill-server'
}

# claude writes its debug log while it shuts down, after kill-session returns. A cleanup that removes
# the run directory at once has it made again a second later, with the logs in it, after a PASS.
# The stand-in for claude is not a child of the harness, as a session's process is not.
test_cleanup_waits_for_each_session_process_to_exit_before_it_removes_the_run_directory() {
  run_live 'live_init
    session_process=$(sh -c "sleep 1; mkdir -p \"\$1\"; : > \"\$1/debug-a.log\"" sh "$LIVE_RUN" >/dev/null 2>&1 & echo $!)
    tmux() { [[ "$1" != display-message ]] || echo "$session_process"; }
    LIVE_SESSIONS=(live-1-a); check ok detail true; live_verdict s'
  sleep 2
  assert_exit_code 0
  [[ -z "$(find "$TEST_DIR/tmp" -maxdepth 1 -name 'live.*')" ]] || fail 'the run directory came back after a PASS'
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

test_a_failed_check_is_a_fail() {
  run_live 'live_init; check x detail false; live_verdict s'
  assert_exit_code 1
  assert_out_lacks 'before it reached a verdict'
}

test_a_run_directory_is_removed_after_a_pass() {
  run_live 'live_init; echo "RUN=$LIVE_RUN"; check ok detail true; live_verdict s'
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

test_a_kept_run_directory_stays_inside_the_test_tmpdir() {
  run_live 'live_init; echo "RUN=$LIVE_RUN"; false'
  assert_exit_code 2
  assert_out_has "RUN=$TEST_DIR/tmp/"
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
  run_live 'LIVE_KEEP=1; live_init; echo "RUN=$LIVE_RUN"; check ok detail true; live_verdict s'
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
  assert_out_has "trap -- '' SIGPIPE"
}

test_a_scenario_that_ran_no_checks_is_an_error_not_a_pass() {
  run_live 'live_init; live_verdict s'
  assert_exit_code 2
  assert_out_has 'ran no checks'
  assert_out_lacks 'PASS s'
}

# live_note_error runs in command substitutions, possibly before live_init made the run directory.
test_noting_an_error_before_the_run_directory_exists_writes_nothing() {
  run_live 'live_note_error "too early"; echo "STATUS=$?"; ls -A "$TMPDIR"'
  assert_exit_code 0
  assert_out_has 'STATUS=0'
  assert_out_lacks 'could not record a harness error'
  assert_out_lacks 'harness-error'
}

test_a_noted_error_with_no_message_is_still_an_error_that_names_a_failed_helper() {
  run_live 'live_init; live_note_error ""; check x detail true; live_verdict s'
  assert_exit_code 2
  assert_out_has 'ERROR: a harness helper failed'
  assert_out_lacks 'PASS s'
}

# rm is a function here so the test sees whether the cleanup tried to remove session-env-* at all.
test_the_cleanup_removes_no_session_env_files_when_there_is_no_run_directory() {
  run_live 'rm() { echo "RM:$*"; }; LIVE_VERDICT_REACHED=1; trap live_cleanup EXIT'
  assert_exit_code 0
  assert_out_lacks 'RM:'
}

test_the_cleanup_removes_the_session_env_files_of_the_run_directory() {
  run_live 'rm() { echo "RM:$*"; }; LIVE_RUN=/run/x; LIVE_VERDICT_REACHED=1; trap live_cleanup EXIT'
  assert_exit_code 0
  assert_out_has 'RM:-f -- /run/x/session-env-*'
}

run_tests "$@"
