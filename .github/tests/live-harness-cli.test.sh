#!/usr/bin/env bash
# scripts/live: live.sh itself (arguments, plugin and scenario lookup, the working directory) and the handoff
# plugin preparation, against a stub `tmux` and `claude`. No real session starts.
# Usage: live-harness-cli.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck disable=SC2034 # EXIT_CODE is read by assert_exit_code in canary-report-lib.sh
# shellcheck source=live-harness-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/live-harness-lib.sh"

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
  echo 'const MIN_THRESHOLD = 80_000' > "$1/hooks/signals.ts"
  [[ "${2:-}" != omit-threshold ]] || echo 'const OTHER = 1' > "$1/hooks/signals.ts"
}

test_handoff_prepare_patches_the_copy_and_leaves_the_source_alone() {
  make_plugin_fixture "$TEST_DIR/src"
  run_live 'source "$LIVE_DIR/handoff/common.sh"
    live_init; LIVE_PLUGIN_SOURCE='"$TEST_DIR"'/src; handoff_prepare "{}"
    cat "$LIVE_RUN/plugin/hooks/signals.ts"
    jq -c .userConfig "$LIVE_RUN/plugin/.claude-plugin/plugin.json"
    check ok detail true; live_verdict s'
  assert_exit_code 0
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
# working directory inside it, so live.sh stops and names LIVE_CWD instead of starting a session there.
test_live_sh_is_an_error_when_the_default_working_directory_is_in_a_git_work_tree_at_home() {
  write_live_stubs
  local repo=$TEST_DIR/repo
  mkdir -p "$repo/scripts"
  cp -R "$LIVE_DIR" "$repo/scripts/live"
  make_plugin_fixture "$repo/plugins/handoff"
  git -C "$TEST_DIR/home" init -q
  EXIT_CODE=0
  hermetic_env PATH="$TEST_DIR/bin:$JQ_DIR:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" \
    "$BASH" "$repo/scripts/live/live.sh" handoff held-prompt-box > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  assert_exit_code 2
  assert_out_has 'inside a git work tree'
  assert_out_has 'Set LIVE_CWD'
  assert_tmux_not_called 'new-session'
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
  cp "$LIVE_DIR/live.sh" "$LIVE_DIR/lib.sh" "$LIVE_DIR/session.sh" "$LIVE_DIR/evidence.sh" "$repo/scripts/live/"
  printf '%s\n' 'scenario_run() { check "scenario ran" "no" true; }' > "$repo/scripts/live/bare/scenarios/only.sh"
  make_plugin_fixture "$repo/plugins/bare"
  EXIT_CODE=0
  hermetic_env PATH="$TEST_DIR/bin:$JQ_DIR:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" \
    "$BASH" "$repo/scripts/live/live.sh" bare only > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  assert_exit_code 0
  assert_out_has 'PASS bare/only (1 checks)'
}

# live_sh_in_repo <live-cwd-relative-to-repo>: live.sh from a copy inside a fresh git repository, with
# LIVE_CWD set to a directory of that repository.
live_sh_in_repo() {
  write_live_stubs
  local repo=$TEST_DIR/repo
  mkdir -p "$repo/scripts"
  cp -R "$LIVE_DIR" "$repo/scripts/live"
  make_plugin_fixture "$repo/plugins/handoff"
  git -C "$repo" init -q
  EXIT_CODE=0
  hermetic_env PATH="$TEST_DIR/bin:$JQ_DIR:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" LIVE_CWD="$repo/$1" \
    "$BASH" "$repo/scripts/live/live.sh" handoff held-prompt-box > "$OUTPUT" 2>&1 || EXIT_CODE=$?
}

# Inside a .git directory `git rev-parse --is-inside-work-tree` prints false and exits 0.
test_a_working_directory_inside_dot_git_is_not_taken_for_a_work_tree() {
  live_sh_in_repo .git/live-cwd
  assert_out_lacks 'inside a git work tree'
  assert_tmux_called 'new-session'
}

test_a_working_directory_inside_a_work_tree_is_an_error() {
  live_sh_in_repo scratch
  assert_exit_code 2
  assert_out_has 'inside a git work tree'
  assert_tmux_not_called 'new-session'
}

run_tests "$@"
