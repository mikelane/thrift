#!/usr/bin/env bash
# Adversarial QA findings for issue #174: a PR response that is not one JSON object. The gate's
# parse check and the lost-race lookup must both treat it as an unreadable fetch, never as a PR.
# Usage: release-merge-unparsed-pr.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"
# shellcheck source=release-merge-stubs-lib.sh
source "$HARNESS_DIR/release-merge-stubs-lib.sh"
# shellcheck source=release-merge-step-lib.sh
source "$HARNESS_DIR/release-merge-step-lib.sh"

# prepend_to_pr <number> <json>: puts <json> in front of the staged PR, so the PR response is a
# stream of two JSON values whose last one is the real PR object.
prepend_to_pr() {
  { printf '%s\n' "$2"; jq . "$TEST_DIR/pr-$1.json"; } >"$TEST_DIR/pr-stream.json"
  mv "$TEST_DIR/pr-stream.json" "$TEST_DIR/pr-$1.json"
}

# `jq -e` reads only the last value, so a stream ending in the PR object passes the parse check,
# the gate's per-field jq reads skip the value they cannot index, and the PR is merged.
test_the_merge_step_does_not_merge_when_the_pr_response_is_an_array_followed_by_the_pr() {
  stage_release_pr 111 "$SHA_A" handoff success
  prepend_to_pr 111 '[]'
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_out_has "::error title=Release PR #111 (handoff) not merged::cannot parse the PR (at $SHA_A)"
  assert_no_file "$TEST_DIR/merge-calls"
}

# The lost-race lookup reads `null` as state "false", not open, so a real merge failure is reported
# as "PR #111 was false without being merged." with a notice, and the job stays green.
test_a_failed_merge_whose_pr_lookup_returns_null_fails_the_job() {
  stage_release_pr 111 "$SHA_A" handoff success
  printf 'null' >"$TEST_DIR/pr-after-failed-merge.json"
  echo 'HTTP 502: Bad Gateway' >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_out_has "and the PR's state could not be read"
  assert_out_lacks "::notice"
}

test_a_failed_merge_whose_pr_lookup_returns_an_empty_body_fails_the_job() {
  stage_release_pr 111 "$SHA_A" handoff success
  : >"$TEST_DIR/pr-after-failed-merge.json"
  echo 'HTTP 502: Bad Gateway' >"$TEST_DIR/merge.error"
  run_merge_step release_merge_pr_if_gate_passes 111 "$SHA_A" 211
  assert_exit_code 1
  assert_out_has "and the PR's state could not be read"
  assert_out_lacks "::notice"
}

test_the_lost_race_lookup_returns_2_when_the_pr_response_is_an_empty_object() {
  local status=0
  printf '{}' >"$TEST_DIR/pr-111.json"
  stub_gh
  release_merge_lost_race "$REPO" 111 "$SHA_A" >/dev/null 2>&1 || status=$?
  [[ "$status" == 2 ]] || fail "got status $status"
}

run_tests "$@"
