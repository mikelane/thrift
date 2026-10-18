#!/usr/bin/env bash
# scripts/live: how a session starts (live_start, the start-up dialogs) and the command and environment
# tmux runs it with, against a stub `tmux` and `claude`. No real session starts.
# Usage: live-harness-session.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck disable=SC2034 # EXIT_CODE is read by assert_exit_code in canary-report-lib.sh
# shellcheck source=live-harness-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/live-harness-lib.sh"

test_live_start_sets_the_permission_mode_instead_of_inheriting_the_owners() {
  run_live 'LIVE_RUN=$TMPDIR; LIVE_THRIFT_HOME=$TMPDIR; LIVE_CWD=$TMPDIR; LIVE_NAMES=(); live_start a'
  assert_tmux_called 'new-session'
  assert_tmux_called '--permission-mode'
}

test_live_start_is_an_error_when_tmux_cannot_start_the_session() {
  run_live 'LIVE_RUN=$TMPDIR; LIVE_THRIFT_HOME=$TMPDIR; LIVE_CWD=$TMPDIR; LIVE_NAMES=(); live_start a'
  assert_exit_code 2
  assert_out_has 'tmux could not start session'
}

test_live_start_isolates_the_session_from_the_owners_settings_memory_and_session() {
  run_live 'LIVE_RUN=$TMPDIR; LIVE_THRIFT_HOME=$TMPDIR; LIVE_CWD=$TMPDIR; LIVE_NAMES=(); live_start a'
  assert_tmux_called "'--setting-sources' 'project'"
  assert_tmux_called 'CLAUDE_CODE_DISABLE_AUTO_MEMORY=1'
  assert_tmux_called 'CLAUDE_CODE_DISABLE_CLAUDE_MDS=1'
  assert_tmux_called '--append-system-prompt'
  assert_tmux_called "THRIFT_HOME=$TEST_DIR/tmp"
  assert_tmux_called "'--debug-file' '$TEST_DIR/tmp/debug-a.log'"
}

test_start_dialogs_cleared_is_an_error_when_the_session_exited() {
  run_live 'live_init; start_dialogs_cleared a'
  assert_exit_code 2
  assert_out_has 'exited at start-up'
}

test_start_dialogs_cleared_answers_the_claude_md_imports_dialog_and_keeps_waiting() {
  run_live 'live_init; tmux() { command tmux "$@" || true; }
    pane() { echo "Allow external CLAUDE.md file imports"; }
    check "keeps waiting" detail eval "! start_dialogs_cleared a"
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
    check ok detail true; live_verdict s'
  assert_exit_code 0
}

# live_claude_command is what the tmux server runs through sh. These tests run it as tmux would, with
# a stub claude that prints its own path and the variables the harness sets or drops. Only those: a
# failing test prints its output, and the rest of the owner's environment can hold keys.
write_env_dumping_claude() { # write_env_dumping_claude <path>
  mkdir -p "$(dirname "$1")"
  printf '#!/bin/sh\necho "BIN=$0"\nenv | grep -E "^(CLAUDE|ANTHROPIC|THRIFT_HOME=|PATH=)" || true\n' > "$1"
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

# tmux runs the command through its default-shell, which can be a POSIX sh (dash on Linux). printf %q
# writes a string with a newline as $'...', which only bash and zsh read.
test_the_session_command_runs_under_a_posix_sh() {
  write_live_stubs
  write_env_dumping_claude "$TEST_DIR/bin/claude"
  run_claude_command CLAUDE_PID=4242 CLAUDE_CODE_OAUTH_TOKEN=tok -- \
    'LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR; dash -c "$(live_claude_command a)"'
  assert_exit_code 0
  assert_out_has 'BIN='
  assert_out_has 'CLAUDE_CODE_OAUTH_TOKEN=tok'
  assert_out_lacks 'CLAUDE_PID='
}

# Outside a UTF-8 locale bash's printf %q writes a non-ASCII character as $'\303\251', which dash
# reads as a literal $ and a quoted string: the session would get another THRIFT_HOME, silently.
test_the_session_command_runs_under_a_posix_sh_in_the_c_locale_with_a_non_ascii_path() {
  write_live_stubs
  write_env_dumping_claude "$TEST_DIR/bin/claude"
  run_claude_command LC_ALL=C -- \
    'LIVE_THRIFT_HOME=$TMPDIR/José; LIVE_RUN=$TMPDIR; dash -c "$(live_claude_command a)"'
  assert_exit_code 0
  assert_out_has "THRIFT_HOME=$TEST_DIR/tmp/José"
}

test_the_session_command_hands_a_posix_sh_an_argument_with_a_newline_and_quotes() {
  write_live_stubs
  printf '#!/bin/sh\nfor a in "$@"; do printf "ARG=[%%s]\\n" "$a"; done\n' > "$TEST_DIR/bin/claude"
  run_claude_command -- \
    'LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR; dash -c "$(live_claude_command a --x "it'"'"'s \$HOME
two \\ \"lines\"")"'
  assert_exit_code 0
  assert_out_has "ARG=[it's \$HOME"
  assert_out_has 'two \ "lines"]'
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

test_the_session_command_adds_the_scenarios_variables_and_nothing_when_it_sets_none() {
  write_live_stubs
  write_env_dumping_claude "$TEST_DIR/bin/claude"
  run_claude_command LIVE_SESSION_ENV='CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 CLAUDE_CODE_SCENARIO_FLAG=on' -- \
    'LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR; sh -c "$(live_claude_command a)"'
  assert_exit_code 0
  assert_out_has 'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1'
  assert_out_has 'CLAUDE_CODE_SCENARIO_FLAG=on'
  run_claude_command -- 'LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR; sh -c "$(live_claude_command a)"'
  assert_exit_code 0
  assert_out_lacks 'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS'
}

# A scenario's variables travel like the login: through the owner-only file, so the command text is the
# same whether a scenario sets any or not, and no value is left in the run directory.
test_the_session_command_keeps_the_scenarios_values_out_of_its_text_and_the_run_directory() {
  write_live_stubs
  write_env_dumping_claude "$TEST_DIR/bin/claude"
  run_claude_command LIVE_SESSION_ENV='CLAUDE_CODE_SCENARIO_FLAG=scenario-val' -- \
    'LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR; plain=$(LIVE_SESSION_ENV= live_claude_command a); command=$(live_claude_command a)
     [[ "$command" == "$plain" ]] && echo SAME_TEXT; printf "COMMAND=%s\n" "$command"; sh -c "$command" | grep -c FLAG=scenario-val'
  assert_exit_code 0
  assert_out_has 'SAME_TEXT'
  assert_out_has 'COMMAND='
  assert_out_lacks 'scenario-val'
  ! grep -rqa scenario-val "$TEST_DIR/tmp" || fail 'a scenario value was left in the run directory'
}

# The harness's own switches and login win over a scenario's: a scenario cannot write the owner's
# decision log, load CLAUDE.md files, or swap the config directory.
test_the_session_command_lets_no_scenario_variable_override_the_harness() {
  write_live_stubs
  write_env_dumping_claude "$TEST_DIR/bin/claude"
  run_claude_command CLAUDE_CONFIG_DIR=/cfg LIVE_SESSION_ENV='THRIFT_HOME=/owner CLAUDE_CODE_DISABLE_CLAUDE_MDS=0 CLAUDE_CONFIG_DIR=/other' -- \
    'LIVE_THRIFT_HOME=/thrift-home; LIVE_RUN=$TMPDIR; sh -c "$(live_claude_command a)"'
  assert_exit_code 0
  assert_out_has 'THRIFT_HOME=/thrift-home'
  assert_out_has 'CLAUDE_CODE_DISABLE_CLAUDE_MDS=1'
  assert_out_has 'CLAUDE_CONFIG_DIR=/cfg'
  assert_out_lacks '/owner'
  assert_out_lacks '/other'
}

# `env` runs its first word without an `=` as the command, so a value with a space (or any stray word)
# would start that word in place of claude. The command is refused instead, and no file is left behind.
test_the_session_command_is_refused_when_a_scenario_word_is_not_an_assignment() {
  write_live_stubs
  run_claude_command CLAUDE_CODE_OAUTH_TOKEN=secret-tok LIVE_SESSION_ENV='CLAUDE_CODE_SCENARIO_FLAG=two words' -- \
    'LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR; live_claude_command a >/dev/null || echo "REFUSED=$?"'
  assert_out_has 'REFUSED=1'
  assert_out_has 'LIVE_SESSION_ENV'
  assert_out_lacks 'words'
  ! grep -rqa secret-tok "$TEST_DIR/tmp" || fail 'the token was left in the run directory'
}

test_the_session_command_takes_scenario_words_on_separate_lines() {
  write_live_stubs
  write_env_dumping_claude "$TEST_DIR/bin/claude"
  run_claude_command LIVE_SESSION_ENV=$'CLAUDE_CODE_FIRST_FLAG=1\nCLAUDE_CODE_SECOND_FLAG=2' -- \
    'LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR; command=$(live_claude_command a); env -u LIVE_SESSION_ENV sh -c "$command"'
  assert_exit_code 0
  assert_out_has 'CLAUDE_CODE_FIRST_FLAG=1'
  assert_out_has 'CLAUDE_CODE_SECOND_FLAG=2'
}

# A tmux server that was already running hands a new session its own environment, so the login and
# config directory a session keeps must be the harness's, not whatever the server started with:
# transcripts_dir() reads the harness's CLAUDE_CONFIG_DIR.
test_the_session_command_takes_the_kept_variables_from_the_harness_not_the_tmux_server() {
  write_live_stubs
  write_env_dumping_claude "$TEST_DIR/bin/claude"
  run_claude_command CLAUDE_CODE_OAUTH_TOKEN=harness-tok -- \
    'LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR; command=$(live_claude_command a)
     env -u CLAUDE_CODE_OAUTH_TOKEN CLAUDE_CONFIG_DIR=/server-cfg CLAUDE_CODE_USE_VERTEX=1 sh -c "$command"'
  assert_exit_code 0
  assert_out_has 'CLAUDE_CODE_OAUTH_TOKEN=harness-tok'
  assert_out_lacks 'CLAUDE_CONFIG_DIR='
  assert_out_lacks 'CLAUDE_CODE_USE_VERTEX='
}

# A tmux server that was already running can hold its own provider keys and endpoint; none of them
# reaches the session, as none of the owner's CLAUDE* variables do.
test_the_session_command_drops_the_anthropic_variables_of_the_tmux_server() {
  write_live_stubs
  write_env_dumping_claude "$TEST_DIR/bin/claude"
  run_claude_command -- \
    'LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR; command=$(live_claude_command a)
     env ANTHROPIC_API_KEY=server-key ANTHROPIC_BASE_URL=http://server ANTHROPIC_MODEL=m sh -c "$command"'
  assert_exit_code 0
  assert_out_has 'BIN='
  assert_out_lacks 'ANTHROPIC_'
  assert_out_lacks 'server-key'
}

# adversarial-qa: the tmux server's environment can hold a variable that is not valid UTF-8 (a Latin-1
# path, a binary blob). Under a UTF-8 locale BSD sed (macOS, where the harness runs) stops on it with
# "illegal byte sequence", the drop loop gets no names, and the server's keys reach the session.
test_the_session_command_drops_the_tmux_servers_variables_when_another_variable_is_not_utf8() {
  write_live_stubs
  printf '#!/bin/sh\necho "BIN=$0"\nenv | LC_ALL=C grep -aE "^(CLAUDE|ANTHROPIC)" || true\n' > "$TEST_DIR/bin/claude"
  chmod +x "$TEST_DIR/bin/claude"
  run_claude_command -- \
    'LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR; command=$(live_claude_command a)
     env LC_ALL=en_US.UTF-8 NOT_UTF8=$'"'"'\xff'"'"' ANTHROPIC_API_KEY=server-key CLAUDE_PID=4242 sh -c "$command"'
  assert_exit_code 0
  assert_out_has 'BIN='
  assert_out_lacks 'server-key'
  assert_out_lacks 'CLAUDE_PID='
}

# The harness's own ANTHROPIC* values (an API key, a Vertex project, a base URL) reach the session in
# place of the server's, so a login that is not an OAuth token still works.
test_the_session_command_takes_the_anthropic_variables_from_the_harness_not_the_tmux_server() {
  write_live_stubs
  write_env_dumping_claude "$TEST_DIR/bin/claude"
  run_claude_command ANTHROPIC_API_KEY=harness-key ANTHROPIC_VERTEX_PROJECT_ID=harness-project -- \
    'LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR; command=$(live_claude_command a)
     env -u ANTHROPIC_API_KEY -u ANTHROPIC_VERTEX_PROJECT_ID ANTHROPIC_API_KEY=server-key ANTHROPIC_BASE_URL=http://server sh -c "$command"'
  assert_exit_code 0
  assert_out_has 'ANTHROPIC_API_KEY=harness-key'
  assert_out_has 'ANTHROPIC_VERTEX_PROJECT_ID=harness-project'
  assert_out_lacks 'server-key'
  assert_out_lacks 'ANTHROPIC_BASE_URL='
}

# An API key travels like the OAuth token: through the owner-only file, never in the command text.
test_the_session_command_keeps_the_anthropic_api_key_out_of_its_text_and_the_run_directory() {
  write_live_stubs
  write_env_dumping_claude "$TEST_DIR/bin/claude"
  run_claude_command ANTHROPIC_API_KEY=secret-key -- \
    'LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR; command=$(live_claude_command a)
     printf "COMMAND=%s\n" "$command"; env -u ANTHROPIC_API_KEY sh -c "$command" | grep -c API_KEY=secret-key'
  assert_exit_code 0
  assert_out_has 'COMMAND='
  assert_out_lacks 'secret-key'
  ! grep -rqa secret-key "$TEST_DIR/tmp" || fail 'the API key was left in the run directory'
}

# The command text shows in `ps` and in tmux; the token reaches the session another way, and does not
# stay behind in the run directory, which a FAIL or an ERROR keeps.
test_the_session_command_keeps_the_oauth_token_out_of_its_text_and_the_run_directory() {
  write_live_stubs
  write_env_dumping_claude "$TEST_DIR/bin/claude"
  run_claude_command CLAUDE_CODE_OAUTH_TOKEN=secret-tok -- \
    'LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR; command=$(live_claude_command a)
     printf "COMMAND=%s\n" "$command"; env -u CLAUDE_CODE_OAUTH_TOKEN sh -c "$command" | grep -c OAUTH_TOKEN=secret-tok'
  assert_exit_code 0
  assert_out_has 'COMMAND='
  assert_out_lacks 'secret-tok'
  ! grep -rqa secret-tok "$TEST_DIR/tmp" || fail 'the token was left in the run directory'
}

# chmod 500 does not stop root, so under root this test starts the session and fails.
test_live_start_starts_no_session_when_it_cannot_write_the_kept_variables_file() {
  run_live 'live_init; LIVE_CWD=$TMPDIR; chmod 500 "$LIVE_RUN"; live_start a'
  chmod -R u+w "$TEST_DIR/tmp"
  assert_exit_code 2
  assert_out_has 'before it reached a verdict'
  assert_tmux_not_called 'new-session'
}

test_a_run_directory_kept_after_an_error_holds_no_token_of_a_session_that_never_started() {
  write_live_stubs
  run_claude_command CLAUDE_CODE_OAUTH_TOKEN=secret-tok -- 'live_init; live_claude_command a >/dev/null; false'
  assert_exit_code 2
  assert_out_has 'run directory kept'
  ! grep -rqa secret-tok "$TEST_DIR/tmp" || fail 'the token was left in the run directory'
}

# The tests run in the owner's shell, which can hold a login and API keys. None of it reaches the
# harness under test unless a test sets it, so a stub that prints its environment prints fixtures only.
test_the_harness_under_test_inherits_no_login_or_key_from_the_shell_running_the_tests() {
  write_live_stubs
  write_env_dumping_claude "$TEST_DIR/bin/claude"
  CLAUDE_CODE_OAUTH_TOKEN=owner-tok ANTHROPIC_ADMIN_KEY=owner-admin run_claude_command -- \
    'LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR
     echo "OAUTH=${CLAUDE_CODE_OAUTH_TOKEN-unset} ADMIN=${ANTHROPIC_ADMIN_KEY-unset}"; sh -c "$(live_claude_command a)"'
  assert_exit_code 0
  assert_out_has 'OAUTH=unset ADMIN=unset'
  assert_out_lacks 'owner-tok'
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

# command -v answers bin/claude for a relative PATH entry, and the session starts in LIVE_CWD.
test_live_require_records_claude_by_an_absolute_path_when_path_has_a_relative_entry() {
  write_live_stubs
  write_env_dumping_claude "$TEST_DIR/rel/bin/claude"
  run_claude_command -- 'cd "$TMPDIR/../rel"; PATH=bin:$PATH; live_require; echo "CLAUDE_BIN=$LIVE_CLAUDE_BIN"'
  assert_exit_code 0
  assert_out_has "CLAUDE_BIN=$TEST_DIR/rel/bin/claude"
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

run_tests "$@"
