#!/usr/bin/env bash
# Issue #215: a release-merge annotation names the plugins its PR changes, taken from the
# plugins/<name>/ paths in the PR's file list, and a lib sibling that fails to load is reported.
# Usage: release-merge-annotation-plugins.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"
# shellcheck source=release-merge-stubs-lib.sh
source "$HARNESS_DIR/release-merge-stubs-lib.sh"
# shellcheck source=release-merge-step-lib.sh
source "$HARNESS_DIR/release-merge-step-lib.sh"

# stage_files <number> <path>...: the changed files the stub serves for the staged PR.
stage_files() {
  local number=$1
  shift
  printf '%s\n' "$@" | jq -R '{filename: .}' | jq -s . >"$TEST_DIR/files-$number.json"
  edit_pr "$number" ".changed_files = $#"
}

test_a_refusal_warning_names_the_plugin_of_a_single_plugin_pr() {
  stage_release_pr 111 "$SHA_A" handoff success
  edit_pr 111 '.draft = true'
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_line "::warning title=Release PR #111 (handoff) not merged::the PR is a draft (at $SHA_A)"
}

test_a_refusal_warning_names_each_plugin_of_a_multi_plugin_pr_sorted() {
  stage_release_pr 111 "$SHA_A" handoff success
  stage_files 111 plugins/meter/CHANGELOG.md plugins/handoff/CHANGELOG.md plugins/meter/plugin.json
  edit_pr 111 '.draft = true'
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_line "::warning title=Release PR #111 (handoff%2C meter) not merged::the PR is a draft (at $SHA_A)"
}

test_a_refusal_warning_names_no_plugin_when_no_changed_file_is_under_plugins() {
  stage_release_pr 111 "$SHA_A" handoff success
  stage_files 111 .release-please-manifest.json
  edit_pr 111 '.draft = true'
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_line "::warning title=Release PR #111 not merged::the PR is a draft (at $SHA_A)"
}

test_a_refusal_warning_escapes_percent_in_a_plugin_name() {
  stage_release_pr 111 "$SHA_A" handoff success
  stage_files 111 'plugins/100%/CHANGELOG.md'
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_has "::warning title=Release PR #111 (100%25) not merged::"
}

test_a_refusal_warning_escapes_colon_and_comma_in_a_plugin_name() {
  stage_release_pr 111 "$SHA_A" handoff success
  stage_files 111 'plugins/a:b,c/CHANGELOG.md'
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_has "::warning title=Release PR #111 (a%3Ab%2Cc) not merged::"
}

test_the_merged_notice_names_the_plugin() {
  stage_release_pr 111 "$SHA_A" handoff success
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_line "::notice title=Release PR #111 (handoff) merged::Merged PR #111 at $SHA_A."
}

test_a_merge_failure_error_names_the_plugin() {
  stage_release_pr 111 "$SHA_A" handoff success
  : >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_has "::error title=Release PR #111 (handoff) not merged::the merge command failed at $SHA_A"
}

test_the_closed_without_merging_notice_names_the_plugin() {
  stage_release_pr 111 "$SHA_A" handoff success
  jq '.state = "closed" | .merged = false' "$TEST_DIR/pr-111.json" >"$TEST_DIR/pr-after-failed-merge.json"
  : >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_line "::notice title=Release PR #111 (handoff) not merged::PR #111 was closed without being merged."
}

test_an_error_before_the_file_list_is_known_names_no_plugin() {
  stage_release_pr 111 "$SHA_A" handoff success
  rm "$TEST_DIR/files-111.json"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_has "::error title=Release PR #111 not merged::cannot fetch the changed files"
}

test_the_plugins_of_one_pr_do_not_carry_over_to_the_next_pr_of_a_sweep() {
  stage_release_pr 111 "$SHA_A" handoff success
  stage_release_pr 112 "$SHA_B" meter success
  edit_pr 111 '.draft = true'
  edit_pr 112 '.draft = true'
  run_merge_step release_merge_run_two_prs
  assert_out_line "::warning title=Release PR #112 (meter) not merged::the PR is a draft (at $SHA_B)"
}

release_merge_run_two_prs() {
  release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  release_merge_pr_if_gate_passes 112 "$SHA_B" 212
}

# copy_lib_with_bad_sibling <sibling> <contents>: a copy of the lib in $TEST_DIR/lib whose <sibling>
# fails to load: absent when <contents> is "missing", otherwise a file holding <contents>.
copy_lib_with_bad_sibling() {
  local sibling=$1 contents=$2
  mkdir -p "$TEST_DIR/lib"
  cp "$RELEASE_MERGE_LIB" "$(dirname "$RELEASE_MERGE_LIB")"/release-merge-ci-lookup.sh \
    "$(dirname "$RELEASE_MERGE_LIB")"/release-merge-failure.sh "$TEST_DIR/lib/"
  rm "$TEST_DIR/lib/$sibling"
  [[ "$contents" == missing ]] || printf '%s\n' "$contents" >"$TEST_DIR/lib/$sibling"
}

# source_lib_copy: sources the copied lib the way the workflow step does, then reaches the gate.
source_lib_copy() {
  "$BASH" -c 'set -euo pipefail; source "$1"; echo the-gate-ran' _ "$TEST_DIR/lib/release-merge-lib.sh" >"$OUTPUT" 2>&1
  # shellcheck disable=SC2034 # read by assert_exit_code in canary-report-lib.sh
  EXIT_CODE=$?
}

test_a_missing_failure_sibling_writes_an_error_annotation_naming_the_file() {
  copy_lib_with_bad_sibling release-merge-failure.sh missing
  source_lib_copy || true
  assert_exit_code 1
  assert_out_has "::error title=Release merge failed::cannot load $TEST_DIR/lib/release-merge-failure.sh"
  assert_out_lacks "the-gate-ran"
}

test_a_missing_ci_lookup_sibling_writes_an_error_annotation_naming_the_file() {
  copy_lib_with_bad_sibling release-merge-ci-lookup.sh missing
  source_lib_copy || true
  assert_exit_code 1
  assert_out_has "::error title=Release merge failed::cannot load $TEST_DIR/lib/release-merge-ci-lookup.sh"
  assert_out_lacks "the-gate-ran"
}

test_a_sibling_that_fails_while_loading_writes_an_error_annotation_naming_the_file() {
  copy_lib_with_bad_sibling release-merge-ci-lookup.sh 'return 1'
  source_lib_copy || true
  assert_exit_code 1
  assert_out_has "::error title=Release merge failed::cannot load $TEST_DIR/lib/release-merge-ci-lookup.sh"
  assert_out_lacks "the-gate-ran"
}

# On bash 3.2 a syntax error or a failing top-level command under `set -e` exits the shell before the
# loader's `||` runs, so no annotation is promised here; the step must still stop before the gate.
test_a_sibling_with_a_syntax_error_stops_the_step_before_the_gate() {
  copy_lib_with_bad_sibling release-merge-ci-lookup.sh 'if then'
  source_lib_copy || true
  assert_exit_code_nonzero
  assert_out_lacks "the-gate-ran"
}

test_a_sibling_whose_top_level_command_fails_stops_the_step_before_the_gate() {
  copy_lib_with_bad_sibling release-merge-ci-lookup.sh 'false'
  source_lib_copy || true
  assert_exit_code_nonzero
  assert_out_lacks "the-gate-ran"
}

run_tests "$@"
