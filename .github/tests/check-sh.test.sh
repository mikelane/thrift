#!/usr/bin/env bash
# The check step that records the version, and scripts/check.sh in log-directory and local mode.
# Usage: check-sh.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"

# ---------------------------------------------------------------------------------------------
# The check step that records the version
# ---------------------------------------------------------------------------------------------
test_record_step_writes_the_bare_version_the_report_validates() {
  rm "$FAILURE_LOG_DIR/claude-version"
  mkdir -p "$TEST_DIR/bin" && cp "$STUBS/claude" "$TEST_DIR/bin/claude"
  printf 'STUB_LOG=%q\nSTUB_VERSION=2.1.411\n' "$TEST_DIR/stub-calls" > "$TEST_DIR/bin/stub.env"
  run_record_step "$TEST_DIR/bin:/usr/bin:/bin"
  assert_exit_code 0
  [[ "$(cat "$FAILURE_LOG_DIR/claude-version")" == 2.1.411 ]] || fail 'claude-version is not the bare version'
}
test_record_step_fails_and_leaves_no_version_when_claude_is_missing() {
  rm "$FAILURE_LOG_DIR/claude-version"
  run_record_step '/usr/bin:/bin'
  assert_exit_code_nonzero
  assert_no_file "$FAILURE_LOG_DIR/claude-version"
}

# ---------------------------------------------------------------------------------------------
# scripts/check.sh in CHECK_LOG_DIR mode
# ---------------------------------------------------------------------------------------------
test_ci_step_runs_check_sh_with_a_log_directory_the_report_job_reads() {
  # shellcheck disable=SC2016 # the workflow expression is matched literally
  grep -qF 'CHECK_LOG_DIR: ${{ runner.temp }}/failures' "$CI_YML" || fail 'the check step does not set CHECK_LOG_DIR to runner.temp/failures'
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURE_LOG_DIR" --
  assert_exit_code 0
  assert_file_exists "$FAILURE_LOG_DIR/checked"
}
test_failing_plugin_keeps_its_log_and_a_passing_plugin_log_is_removed() {
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURE_LOG_DIR" STUB_TSC_FAIL=a --
  assert_exit_code 1
  assert_file_has "$FAILURE_LOG_DIR/a.txt" 'FAILED: plugins/a: tsc -p exited 2'
  assert_file_has "$STUB_LOG" 'claude plugin test plugins/b'
  assert_no_file "$FAILURE_LOG_DIR/b.txt"
  assert_out_has 'FAILED: plugins/a: tsc -p exited 2'
}
test_checked_marker_is_written_after_every_plugin_is_tried_even_when_one_fails() {
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURE_LOG_DIR" STUB_TSC_FAIL=a --
  assert_exit_code 1
  assert_file_exists "$FAILURE_LOG_DIR/checked"
  assert_file_has "$STUB_LOG" 'tsc -p plugins/b'
  assert_file_has "$STUB_LOG" 'MARKER plugin=b checked=absent'
}
test_checked_marker_is_written_when_every_plugin_passes_and_no_log_remains() {
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURE_LOG_DIR" --
  assert_exit_code 0
  assert_file_exists "$FAILURE_LOG_DIR/checked"
  assert_no_file "$FAILURE_LOG_DIR/a.txt"
}
test_validate_failure_stops_that_plugin_before_tsc_and_keeps_the_log() {
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURE_LOG_DIR" STUB_VALIDATE_FAIL=a --
  assert_exit_code 1
  assert_file_has "$FAILURE_LOG_DIR/a.txt" 'FAILED: plugins/a: claude plugin validate exited 1'
  assert_file_lacks "$STUB_LOG" 'tsc -p plugins/a'
}
test_type_declaration_failure_lands_in_the_plugin_log() {
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURE_LOG_DIR" STUB_NO_TYPE_DECLARATIONS=a --
  assert_exit_code 1
  assert_file_has "$FAILURE_LOG_DIR/a.txt" 'The engine wrote no type declarations for plugins/a'
  assert_file_has "$FAILURE_LOG_DIR/a.txt" 'FAILED: plugins/a: type declarations exited 1'
  assert_file_lacks "$STUB_LOG" 'tsc -p plugins/a'
}
test_stale_type_declarations_are_removed_before_the_engine_regenerates_them() {
  make_repo a
  mkdir -p "$REPO_COPY/plugins/a/.claude-plugin/types/claude-code"
  echo stale > "$REPO_COPY/plugins/a/.claude-plugin/types/claude-code/index.d.ts"
  run_check_step CHECK_LOG_DIR="$FAILURE_LOG_DIR" STUB_NO_TYPE_DECLARATIONS=a --
  assert_exit_code 1
  assert_no_file "$REPO_COPY/plugins/a/.claude-plugin/types/claude-code/index.d.ts"
}
test_report_opens_a_canary_issue_for_a_type_declaration_failure() {
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURE_LOG_DIR" STUB_NO_TYPE_DECLARATIONS=a --
  mkdir -p "$TEST_DIR/bin" && cp "$STUBS/claude" "$TEST_DIR/bin/claude"
  printf 'STUB_LOG=%q\nSTUB_VERSION=2.1.300\n' "$TEST_DIR/stub-calls" > "$TEST_DIR/bin/stub.env"
  run_record_step "$TEST_DIR/bin:/usr/bin:/bin"
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create --title Claude Code 2.1.300 breaks a --body-file' 1
  assert_file_has "$TEST_DIR/issue-body.md" 'type declarations'
}
test_report_opens_a_canary_issue_for_a_tsc_failure_and_none_for_a_passing_plugin() {
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURE_LOG_DIR" STUB_TSC_FAIL=b --
  mkdir -p "$TEST_DIR/bin" && cp "$STUBS/claude" "$TEST_DIR/bin/claude"
  printf 'STUB_LOG=%q\nSTUB_VERSION=2.1.300\n' "$TEST_DIR/stub-calls" > "$TEST_DIR/bin/stub.env"
  run_record_step "$TEST_DIR/bin:/usr/bin:/bin"
  printf '%s\n' a b > "$GH_PLUGINS"
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create' 1
  assert_gh_call_count 'issue create --title Claude Code 2.1.300 breaks b' 1
  assert_file_has "$TEST_DIR/issue-body.md" 'TS2578'
}
test_unknown_plugin_name_writes_a_no_such_plugin_log_and_the_marker() {
  make_repo a b
  run_check_script CHECK_LOG_DIR="$FAILURE_LOG_DIR" -- nope
  assert_exit_code 1
  assert_file_has "$FAILURE_LOG_DIR/nope.txt" 'No such plugin: plugins/nope'
  assert_file_exists "$FAILURE_LOG_DIR/checked"
}
test_unknown_plugin_name_with_a_trailing_slash_writes_its_log_under_the_bare_name() {
  make_repo a b
  run_check_script CHECK_LOG_DIR="$FAILURE_LOG_DIR" -- nope/
  assert_exit_code 1
  assert_file_has "$FAILURE_LOG_DIR/nope.txt" 'No such plugin: plugins/nope'
  assert_file_exists "$FAILURE_LOG_DIR/checked"
}
test_failing_plugin_given_with_a_trailing_slash_keeps_its_log_under_the_bare_name() {
  make_repo a b
  run_check_script CHECK_LOG_DIR="$FAILURE_LOG_DIR" STUB_TSC_FAIL=a -- a/
  assert_exit_code 1
  assert_file_has "$FAILURE_LOG_DIR/a.txt" 'FAILED: plugins/a: tsc -p exited 2'
}
test_empty_plugin_name_writes_a_log_instead_of_only_the_marker() {
  make_repo a
  run_check_script CHECK_LOG_DIR="$FAILURE_LOG_DIR" -- ''
  assert_exit_code 1
  assert_file_has "$FAILURE_LOG_DIR/.txt" 'No such plugin'
}
test_missing_plugins_directory_exits_1_with_no_marker() {
  make_repo
  rmdir "$REPO_COPY/plugins"
  run_check_script CHECK_LOG_DIR="$FAILURE_LOG_DIR" --
  assert_exit_code 1
  assert_out_has 'No plugins found under'
  assert_no_file "$FAILURE_LOG_DIR/checked"
}
test_empty_plugins_directory_exits_1_with_no_marker() {
  make_repo
  run_check_script CHECK_LOG_DIR="$FAILURE_LOG_DIR" --
  assert_exit_code 1
  assert_out_has 'No plugins found under'
  assert_no_file "$FAILURE_LOG_DIR/checked"
}
test_missing_tsc_exits_1_and_says_how_to_install_it() {
  make_repo a
  rm "$REPO_COPY/node_modules/.bin/tsc"
  run_check_script CHECK_LOG_DIR="$FAILURE_LOG_DIR" --
  assert_exit_code 1
  assert_out_has "Run 'npm ci'"
  assert_no_file "$FAILURE_LOG_DIR/checked"
}

# ---------------------------------------------------------------------------------------------
# scripts/check.sh in local mode, and its arguments
# ---------------------------------------------------------------------------------------------
test_local_run_stops_at_the_first_failing_plugin() {
  make_repo a b
  run_check_script STUB_TSC_FAIL=a --
  assert_exit_code_nonzero
  assert_file_has "$STUB_LOG" 'tsc -p plugins/a'
  assert_out_has 'FAILED: plugins/a: tsc -p exited 2'
  assert_file_lacks "$STUB_LOG" 'plugins/b'
}
test_local_run_passes_when_every_plugin_passes() {
  make_repo a b
  run_check_script --
  assert_exit_code 0
  assert_file_has "$STUB_LOG" 'claude plugin test plugins/b'
}
test_local_run_checks_only_the_plugins_named() {
  make_repo a b
  run_check_script -- b
  assert_exit_code 0
  assert_file_has "$STUB_LOG" 'claude plugin test plugins/b'
  assert_file_lacks "$STUB_LOG" 'plugins/a'
}
test_local_run_from_another_directory_still_finds_the_plugins() {
  make_repo a
  write_stub_env
  EXIT_CODE=0
  (cd "$TEST_DIR" && env PATH="$REPO_COPY/bin:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" "$BASH" "$REPO_COPY/scripts/check.sh" a) > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  assert_exit_code 0
  assert_file_has "$STUB_LOG" 'claude plugin test plugins/a'
}
test_local_run_by_relative_path_ignores_an_exported_cdpath() {
  make_repo a
  write_stub_env
  mkdir -p "$TEST_DIR/decoy/scripts"
  EXIT_CODE=0
  (cd "$REPO_COPY" && env CDPATH="$TEST_DIR/decoy" PATH="$REPO_COPY/bin:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" "$BASH" scripts/check.sh a) > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  assert_exit_code 0
  assert_file_has "$STUB_LOG" 'claude plugin test plugins/a'
}
test_engine_type_generation_runs_without_credentials_or_the_callers_config() {
  make_repo a b
  run_check_script CHECK_LOG_DIR="$FAILURE_LOG_DIR" --
  assert_exit_code 0
  assert_file_has "$STUB_LOG" 'GENENV plugin=a api_key=unset oauth=unset'
  assert_file_has "$STUB_LOG" 'GENENV plugin=b api_key=unset oauth=unset'
  assert_file_lacks "$STUB_LOG" '/caller-config'
  assert_file_has "$STUB_LOG" 'config_state=empty'
}
test_engine_type_generation_config_directory_is_removed_when_the_run_ends() {
  make_repo a b
  run_check_script STUB_TSC_FAIL=b --
  # macOS mktemp ignores TMPDIR, so the directory is found through the path the engine was given.
  local config_dir
  config_dir=$(sed -n 's/^GENENV plugin=a .* config=\([^ ]*\) .*/\1/p' "$STUB_LOG")
  [[ "$config_dir" == /* ]] || { fail "the engine was given no absolute config directory: '$config_dir'"; return; }
  [[ ! -e "$config_dir" ]] || fail "check.sh left its config directory behind: $config_dir"
  [[ -z "$(find "$TEST_DIR/tmp" -mindepth 1)" ]] || fail "check.sh left entries in TMPDIR: $(find "$TEST_DIR/tmp" -mindepth 1)"
}

# ---------------------------------------------------------------------------------------------
# scripts/check.sh plugin names
# ---------------------------------------------------------------------------------------------
test_dot_dot_name_is_rejected() {
  make_repo a
  run_check_script -- ..
  assert_exit_code 1
  assert_out_has 'Invalid plugin name'
}
test_doubled_plugins_prefix_is_rejected() {
  make_repo a
  run_check_script -- plugins/plugins/a
  assert_exit_code 1
  assert_out_has 'Invalid plugin name'
}
test_nested_name_is_rejected() {
  make_repo a
  mkdir -p "$REPO_COPY/plugins/a/b"
  run_check_script -- a/b
  assert_exit_code 1
  assert_out_has 'Invalid plugin name'
}
test_parent_directory_name_is_rejected_before_any_check_runs() {
  make_repo a
  mkdir -p "$REPO_COPY/x/.claude-plugin"
  run_check_script -- ../x
  assert_exit_code 1
  assert_out_has 'Invalid plugin name'
  assert_file_lacks "$STUB_LOG" 'plugins/../x'
}
test_plugins_prefix_in_log_mode_writes_the_log_under_the_bare_name() {
  make_repo a b
  run_check_script CHECK_LOG_DIR="$FAILURE_LOG_DIR" STUB_TSC_FAIL=a -- plugins/a
  assert_exit_code 1
  assert_file_has "$FAILURE_LOG_DIR/a.txt" 'FAILED: plugins/a: tsc -p exited 2'
}
test_plugins_prefix_is_accepted_the_same_as_the_bare_name() {
  make_repo a b
  run_check_script -- plugins/a
  assert_exit_code 0
  assert_file_has "$STUB_LOG" 'claude plugin test plugins/a'
  assert_file_lacks "$STUB_LOG" 'plugins/plugins'
}
test_rejected_name_in_log_mode_writes_a_log_inside_the_log_directory() {
  make_repo a
  mkdir -p "$REPO_COPY/x/.claude-plugin"
  run_check_script CHECK_LOG_DIR="$FAILURE_LOG_DIR" -- ../x
  assert_exit_code 1
  assert_file_has "$FAILURE_LOG_DIR/.._x.txt" 'Invalid plugin name'
  assert_file_exists "$FAILURE_LOG_DIR/checked"
}

test_dot_name_is_rejected_instead_of_checking_the_plugins_directory() {
  make_repo a
  run_check_script -- .
  assert_exit_code 1
  assert_out_has 'Invalid plugin name'
  assert_file_lacks "$STUB_LOG" 'plugin validate plugins/.'
}

run_tests "$@"
