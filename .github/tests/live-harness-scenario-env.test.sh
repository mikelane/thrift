#!/usr/bin/env bash
# scripts/live/session.sh: LIVE_SESSION_ENV, the variables a scenario sets for the sessions it starts
# next, run through the session command as tmux would, with a stub claude. No real session starts.
# Usage: live-harness-scenario-env.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=live-harness-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/live-harness-lib.sh"

SESSION='LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR; command=$(live_claude_command a); env -u LIVE_SESSION_ENV sh -c "$command"'

# run_scenario_env <LIVE_SESSION_ENV> [<more env assignments...>]: the session's variables, as the stub
# claude prints them.
run_scenario_env() {
  write_live_stubs
  write_env_dumping_claude "$TEST_DIR/bin/claude"
  run_claude_command LIVE_SESSION_ENV="$1" "${@:2}" -- "$SESSION"
}

# refuse_scenario_env <LIVE_SESSION_ENV> [<more env assignments...>]: builds the command, which must be
# refused, and prints the exit status.
refuse_scenario_env() {
  write_live_stubs
  run_claude_command LIVE_SESSION_ENV="$1" "${@:2}" -- \
    'LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR; live_claude_command a >/dev/null || echo "REFUSED=$?"'
}

test_the_session_gets_the_scenarios_variables() {
  run_scenario_env 'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 CLAUDE_CODE_SCENARIO_FLAG=on'
  assert_exit_code 0
  assert_out_has 'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1'
  assert_out_has 'CLAUDE_CODE_SCENARIO_FLAG=on'
}

test_the_session_gets_no_scenario_variable_when_none_is_set() {
  run_scenario_env ''
  assert_exit_code 0
  assert_out_has 'BIN='
  assert_out_lacks 'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS'
}

test_the_session_takes_scenario_words_on_separate_lines_and_tabs() {
  run_scenario_env $'CLAUDE_CODE_FIRST_FLAG=1\nCLAUDE_CODE_SECOND_FLAG=2\tCLAUDE_CODE_THIRD_FLAG=3'
  assert_exit_code 0
  assert_out_has 'CLAUDE_CODE_FIRST_FLAG=1'
  assert_out_has 'CLAUDE_CODE_SECOND_FLAG=2'
  assert_out_has 'CLAUDE_CODE_THIRD_FLAG=3'
}

test_the_session_gets_an_empty_scenario_value() {
  run_scenario_env 'CLAUDE_CODE_EMPTY_FLAG='
  assert_exit_code 0
  assert_out_has 'CLAUDE_CODE_EMPTY_FLAG='
}

test_the_session_gets_a_scenario_value_with_a_quote_and_a_dollar_sign() {
  run_scenario_env "CLAUDE_CODE_QUOTED_FLAG=it's\$HOME"
  assert_exit_code 0
  assert_out_has "CLAUDE_CODE_QUOTED_FLAG=it's\$HOME"
}

# A scenario's variables travel like the login: through the owner-only file, so the command text is the
# same whether a scenario sets any or not, and no value is left in the run directory.
test_the_session_command_keeps_the_scenarios_values_out_of_its_text_and_the_run_directory() {
  write_live_stubs
  write_env_dumping_claude "$TEST_DIR/bin/claude"
  run_claude_command LIVE_SESSION_ENV='CLAUDE_CODE_SCENARIO_FLAG=scenario-val' -- \
    'LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR; plain=$(LIVE_SESSION_ENV= live_claude_command a); command=$(live_claude_command a)
     test "$command" = "$plain"; echo SAME_TEXT; printf "COMMAND=%s\n" "$command"; sh -c "$command" | grep -c FLAG=scenario-val'
  assert_exit_code 0
  assert_out_has 'SAME_TEXT'
  assert_out_has 'COMMAND='
  assert_out_lacks 'scenario-val'
  assert_dir_lacks scenario-val "$TEST_DIR/tmp"
}

# `env` runs its first word without an `=` as the command, so a value with a space (or any stray word)
# would start that word in place of claude. The command is refused instead, and no file is left behind.
test_the_session_command_is_refused_when_a_scenario_word_is_not_an_assignment() {
  refuse_scenario_env 'CLAUDE_CODE_SCENARIO_FLAG=two words' CLAUDE_CODE_OAUTH_TOKEN=secret-tok
  assert_out_has 'REFUSED=1'
  assert_out_has 'LIVE_SESSION_ENV holds a word that is not NAME=value'
  assert_out_lacks 'words'
  assert_dir_lacks secret-tok "$TEST_DIR/tmp"
}

test_the_session_command_is_refused_when_a_scenario_name_starts_with_a_digit() {
  refuse_scenario_env '1FLAG=on'
  assert_out_has 'REFUSED=1'
  assert_out_has 'is not NAME=value'
}

test_the_session_command_is_refused_when_a_scenario_name_is_not_ascii() {
  refuse_scenario_env 'FLÄG=on'
  assert_out_has 'REFUSED=1'
  assert_out_has 'is not NAME=value'
}

# A scenario may not set what the harness sets, even when the harness has no value for it: the config
# directory decides where transcripts_dir looks, PATH decides which `rm` the session runs.
test_the_session_command_is_refused_when_a_scenario_sets_the_config_directory_the_harness_lacks() {
  refuse_scenario_env 'CLAUDE_CONFIG_DIR=/other'
  assert_out_has 'REFUSED=1'
  assert_out_has 'LIVE_SESSION_ENV sets CLAUDE_CONFIG_DIR, which the harness sets for every session'
}

test_the_session_command_is_refused_when_a_scenario_sets_the_oauth_token() {
  refuse_scenario_env 'CLAUDE_CODE_OAUTH_TOKEN=scenario-tok'
  assert_out_has 'REFUSED=1'
  assert_out_lacks 'scenario-tok'
}

test_the_session_command_is_refused_when_a_scenario_sets_an_anthropic_variable() {
  refuse_scenario_env 'ANTHROPIC_BASE_URL=http://elsewhere'
  assert_out_has 'REFUSED=1'
}

test_the_session_command_is_refused_when_a_scenario_sets_path() {
  refuse_scenario_env 'PATH=/elsewhere'
  assert_out_has 'REFUSED=1'
}

test_the_session_command_is_refused_when_a_scenario_sets_thrift_home() {
  refuse_scenario_env 'THRIFT_HOME=/owner'
  assert_out_has 'REFUSED=1'
}

test_the_session_command_is_refused_when_a_scenario_turns_auto_memory_back_on() {
  refuse_scenario_env 'CLAUDE_CODE_DISABLE_AUTO_MEMORY=0'
  assert_out_has 'REFUSED=1'
}

test_the_session_command_is_refused_when_a_scenario_turns_claude_md_loading_back_on() {
  refuse_scenario_env 'CLAUDE_CODE_DISABLE_CLAUDE_MDS=0'
  assert_out_has 'REFUSED=1'
}

# run_decoy_session <LIVE_SESSION_ENV>: builds the command and runs it through sh as tmux would, with a
# fake login token kept from this shell and a stub claude that prints nothing.
run_decoy_session() {
  write_live_stubs
  printf '#!/bin/sh\nexit 0\n' > "$TEST_DIR/bin/claude"
  chmod +x "$TEST_DIR/bin/claude"
  run_claude_command LIVE_SESSION_ENV="$1" CLAUDE_CODE_OAUTH_TOKEN=fake-login-tok -- \
    'LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR
     if command=$(live_claude_command a 2>/dev/null); then env -u LIVE_SESSION_ENV sh -c "$command" >/dev/null 2>&1 || true; else echo REFUSED; fi'
}

# The login file is read and deleted before any scenario export runs, so a scenario variable named like the
# launch script's own cannot redirect the delete, and a readonly name cannot stop it.
test_the_login_file_is_deleted_when_a_scenario_sets_a_variable_named_env_file() {
  printf 'keep\n' > "$TEST_DIR/decoy"
  run_decoy_session "env_file=$TEST_DIR/decoy"
  assert_dir_lacks fake-login-tok "$TEST_DIR/tmp"
}

test_a_file_the_scenario_names_in_env_file_is_not_deleted_by_the_session() {
  printf 'keep\n' > "$TEST_DIR/decoy"
  run_decoy_session "env_file=$TEST_DIR/decoy"
  assert_file_has "$TEST_DIR/decoy" keep
}

test_the_login_file_is_deleted_when_a_scenario_sets_a_readonly_shell_variable() {
  run_decoy_session 'UID=0'
  assert_dir_lacks fake-login-tok "$TEST_DIR/tmp"
}

test_the_session_command_is_refused_when_a_scenario_sets_home() {
  refuse_scenario_env 'HOME=/other'
  assert_out_has 'REFUSED=1'
  assert_out_has 'LIVE_SESSION_ENV sets HOME'
}

test_the_session_command_is_refused_when_a_scenario_name_is_empty() {
  refuse_scenario_env '=on'
  assert_out_has 'REFUSED=1'
  assert_out_has 'is not NAME=value'
}

test_the_session_env_file_is_owner_only() {
  write_live_stubs
  run_claude_command CLAUDE_CODE_OAUTH_TOKEN=fake-login-tok -- \
    'LIVE_THRIFT_HOME=$TMPDIR; LIVE_RUN=$TMPDIR; live_claude_command a >/dev/null; ls -l "$LIVE_RUN/session-env-a" | cut -c1-10'
  assert_exit_code 0
  assert_out_has '-rw-------'
}

run_tests "$@"
