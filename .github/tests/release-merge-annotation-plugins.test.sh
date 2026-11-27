#!/usr/bin/env bash
# Issue #215: a release-merge annotation names the plugins its PR changes, taken from the
# plugins/<name>/ paths in the PR's file list.
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

# draft_pr_changing <path>: the staged PR 111 is a draft and changes only <path>.
draft_pr_changing() {
  stage_release_pr 111 "$SHA_A" handoff success
  stage_files 111 "$1"
  edit_pr 111 '.draft = true'
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
}

test_a_plugin_name_with_a_percent_is_not_named() {
  draft_pr_changing 'plugins/100%/CHANGELOG.md'
  assert_out_line "::warning title=Release PR #111 not merged::the PR is a draft (at $SHA_A)"
}

test_a_plugin_name_with_a_colon_is_not_named() {
  draft_pr_changing 'plugins/a:b/CHANGELOG.md'
  assert_out_line "::warning title=Release PR #111 not merged::the PR is a draft (at $SHA_A)"
}

test_a_plugin_name_with_a_comma_is_not_named() {
  draft_pr_changing 'plugins/a,b/CHANGELOG.md'
  assert_out_line "::warning title=Release PR #111 not merged::the PR is a draft (at $SHA_A)"
}

test_a_plugin_name_that_opens_a_workflow_command_is_not_named() {
  draft_pr_changing 'plugins/##[add-mask]t/f'
  assert_out_line "::warning title=Release PR #111 not merged::the PR is a draft (at $SHA_A)"
}

test_a_plugin_name_with_an_unsafe_character_is_left_out_but_the_others_are_named() {
  stage_release_pr 111 "$SHA_A" handoff success
  stage_files 111 'plugins/a,b/CHANGELOG.md' plugins/handoff/CHANGELOG.md
  edit_pr 111 '.draft = true'
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_line "::warning title=Release PR #111 (handoff) not merged::the PR is a draft (at $SHA_A)"
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

test_the_plugins_of_one_pr_do_not_carry_over_to_the_next_pr_gated_in_the_same_shell() {
  stage_release_pr 111 "$SHA_A" handoff success
  stage_release_pr 112 "$SHA_B" meter success
  edit_pr 111 '.draft = true'
  edit_pr 112 '.draft = true'
  run_merge_step merge_step_for_prs_111_and_112
  assert_out_line "::warning title=Release PR #112 (meter) not merged::the PR is a draft (at $SHA_B)"
}

test_the_plugins_of_one_pr_do_not_carry_over_to_a_next_pr_whose_file_list_cannot_be_fetched() {
  stage_release_pr 111 "$SHA_A" handoff success
  stage_release_pr 112 "$SHA_B" meter success
  edit_pr 111 '.draft = true'
  rm "$TEST_DIR/files-112.json"
  run_merge_step merge_step_for_prs_111_and_112
  assert_out_has "::error title=Release PR #112 not merged::cannot fetch the changed files"
}

# stage_files_json <number> <count> <json>: the files API response the stub serves for the staged PR.
stage_files_json() {
  printf '%s\n' "$3" >"$TEST_DIR/files-$1.json"
  edit_pr "$1" ".changed_files = $2"
}

test_a_newline_in_a_path_names_no_plugin_from_the_text_after_it() {
  stage_release_pr 111 "$SHA_A" handoff success
  stage_files_json 111 1 '[{"filename":"plugins/a\nplugins/evil/CHANGELOG.md"}]'
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_has "::warning title=Release PR #111 not merged::"
  assert_out_lacks "(evil)"
}

test_a_carriage_return_in_a_plugin_name_names_no_plugin() {
  stage_release_pr 111 "$SHA_A" handoff success
  stage_files_json 111 1 '[{"filename":"plugins/a\rb/CHANGELOG.md"}]'
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_has "::warning title=Release PR #111 not merged::"
}

test_a_plugin_name_with_a_literal_backslash_is_not_named() {
  draft_pr_changing 'plugins/a\nb/CHANGELOG.md'
  assert_out_line "::warning title=Release PR #111 not merged::the PR is a draft (at $SHA_A)"
}

test_a_renamed_file_names_the_plugin_of_its_previous_path_too() {
  stage_release_pr 111 "$SHA_A" handoff success
  stage_files_json 111 1 '[{"filename":"plugins/meter/CHANGELOG.md","previous_filename":"plugins/handoff/CHANGELOG.md"}]'
  edit_pr 111 '.draft = true'
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_out_line "::warning title=Release PR #111 (handoff%2C meter) not merged::the PR is a draft (at $SHA_A)"
}

merge_step_for_prs_111_and_112() {
  release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  release_merge_pr_if_gate_passes 112 "$SHA_B" 212
}

run_tests "$@"
