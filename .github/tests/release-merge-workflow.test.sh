#!/usr/bin/env bash
# The lost-race check after a failed merge, and the shape of the merge step and release-merge.yml:
# the merge command's flags, the triggers, the token use and the concurrency group.
# Usage: release-merge-workflow.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"
# shellcheck source=release-merge-stubs-lib.sh
source "$HARNESS_DIR/release-merge-stubs-lib.sh"

test_the_merge_job_grants_its_token_actions_read_and_nothing_else() {
  local got
  got=$(awk '/^    permissions:/{f=1;next} f&&/^      /{print;next} f{exit}' "$REPO_ROOT/.github/workflows/release-merge.yml")
  [[ "$got" == '      actions: read' ]] || fail "got [$got]"
}

test_the_workflow_hands_the_sweep_the_workflow_token_as_the_runs_token() {
  grep -qF 'RUNS_TOKEN: ${{ github.token }}' "$REPO_ROOT/.github/workflows/release-merge.yml" \
    || fail 'RUNS_TOKEN is not the workflow token'
}

# lost_race <pr-json-filter>: release_merge_lost_race's status and output for PR 111 at SHA.
lost_race() {
  write_pr "$TEST_DIR/pr-111.json" "$1"
  stub_gh
  release_merge_lost_race "$REPO" 111 "$SHA"
}

test_a_failed_merge_of_a_pr_that_is_already_merged_is_a_lost_race() {
  local got
  got=$(lost_race '.state = "closed"') || fail 'treated a merged PR as a real failure'
  [[ "$got" == 'PR #111 is closed: another run merged it first.' ]] || fail "got [$got]"
}

test_a_failed_merge_of_a_pr_whose_head_moved_is_a_lost_race() {
  local got
  got=$(lost_race '.head.sha = "ffffffffffffffffffffffffffffffffffffffff"') || fail 'treated a moved head as a real failure'
  [[ "$got" == "PR #111 head moved to ffffffffffffffffffffffffffffffffffffffff since CI tested $SHA." ]] \
    || fail "got [$got]"
}

# No pr-111.json: the stub's PR lookup fails, which must not read as "the PR is no longer open".
test_a_failed_merge_whose_pr_lookup_fails_is_not_a_lost_race() {
  stub_gh
  release_merge_lost_race "$REPO" 111 "$SHA" >/dev/null 2>&1 && fail 'read a failed PR lookup as a lost race'
  return 0
}

test_a_failed_merge_of_an_open_pr_at_the_tested_head_is_not_a_lost_race() {
  lost_race . >/dev/null && fail 'hid a real merge failure'
  return 0
}

# merge_commands: the lines of the lib that run `gh pr merge`. A comment, an echo or trailing
# text that merely mentions the command does not start with it, so it is not selected. A trailing
# comment on a merge line is stripped, so a flag named only in that comment does not count. Each
# line gets one trailing space, so a flag at the end of the line matches the ' --flag ' patterns.
merge_commands() {
  grep -E '^[[:space:]]*gh pr merge ' "$HARNESS_DIR/release-merge-lib.sh" \
    | sed -e "s/[[:space:]]#.*$//" -e "s/$/ /"
}

test_the_merge_step_runs_exactly_one_merge_command() {
  local got
  got=$(merge_commands | wc -l | tr -d ' ')
  [[ "$got" == 1 ]] || fail "got [$got]"
}

# merge_step_script: the run: block of the workflow's merge step, without its indentation. The flag
# tests above read the lib, so these are what check the workflow itself.
merge_step_script() {
  awk '/^      - name: Squash-merge the release PR/{f=1} f&&/^        run: \|/{r=1;next}
       r&&/^[[:space:]]*$/{blanks=blanks "\n";next}
       r&&/^          /{printf "%s", blanks;blanks="";sub(/^          /,"");print;next}
       r{exit}' "$REPO_ROOT/.github/workflows/release-merge.yml"
}

test_the_workflow_runs_no_merge_command_of_its_own() {
  local got
  got=$(grep -cE '^[[:space:]]*[^#]*gh pr merge' "$REPO_ROOT/.github/workflows/release-merge.yml")
  [[ "$got" == 0 ]] || fail "the workflow has $got gh pr merge line(s) outside the lib"
}

test_the_merge_step_calls_release_merge_run() {
  merge_step_script | grep -qxF 'release_merge_run' || fail 'the merge step never calls release_merge_run'
}

test_the_merge_step_is_strict() {
  merge_step_script | grep -qxF 'set -euo pipefail' || fail 'the merge step does not set -euo pipefail'
}

test_the_merge_step_script_is_exactly_the_expected_block() {
  local want got
  want=$(printf '%s\n' \
    'set -euo pipefail' \
    '# shellcheck source=.github/tests/release-merge-lib.sh' \
    'source .github/tests/release-merge-lib.sh' \
    '# Every temp file lives here, so an early return or a failure still cleans up.' \
    'work_dir=$(mktemp -d)' \
    "trap 'rm -rf \"\$work_dir\"' EXIT" \
    'release_merge_run')
  got=$(merge_step_script)
  [[ "$got" == "$want" ]] || fail "the merge step's run block changed: [$got]"
}

test_merge_step_script_returns_a_line_that_follows_a_blank_line_in_the_run_block() {
  local got
  mkdir -p "$TEST_DIR/repo/.github/workflows"
  awk '{print} /^          release_merge_run$/{print ""; print "          release_merge_problems() { :; }; TRIGGER=CI release_merge_run"}' \
    "$REPO_ROOT/.github/workflows/release-merge.yml" >"$TEST_DIR/repo/.github/workflows/release-merge.yml"
  got=$(REPO_ROOT=$TEST_DIR/repo merge_step_script)
  [[ "$got" == *'release_merge_problems() { :; }'* ]] || fail "the line after a blank line is invisible: [$got]"
}

# checkout_with_block: the `with:` lines of the merge job's actions/checkout step, one per line,
# continuation lines included. It ends at the step's next blank line.
checkout_with_block() {
  awk '/^      - uses: actions\/checkout@/{f=1;next} f&&/^        with:/{w=1;next} w&&/^[[:space:]]*$/{exit} w{print}' \
    "$REPO_ROOT/.github/workflows/release-merge.yml"
}

test_the_checkout_step_takes_exactly_the_app_token_no_credentials_and_the_sparse_paths() {
  local want got
  want=$(printf '%s\n' \
    '          token: ${{ steps.app-token.outputs.token }}' \
    '          persist-credentials: false' \
    '          sparse-checkout: |' \
    '            .github/tests/release-merge-lib.sh' \
    '            release-please-config.json' \
    '          sparse-checkout-cone-mode: false')
  got=$(checkout_with_block)
  [[ "$got" == "$want" ]] || fail "the checkout step's with: block changed: [$got]"
}

# merge_step_block: the whole merge step (it is the last step), from its name line to the end.
merge_step_block() {
  awk '/^      - name: Squash-merge the release PR/{f=1} f' "$REPO_ROOT/.github/workflows/release-merge.yml"
}

test_the_merge_step_has_no_if_condition() {
  merge_step_block | grep -qE '^        if:' && fail 'the merge step has an if: that can skip it'
  return 0
}

test_the_merge_step_does_not_continue_on_error() {
  merge_step_block | grep -q 'continue-on-error' && fail 'the merge step sets continue-on-error'
  return 0
}

# sparse_checkout_paths: the paths the checkout step fetches, one per line.
sparse_checkout_paths() {
  awk '/^          sparse-checkout: \|/{f=1;next} f&&/^            /{sub(/^            /,"");print;next} f{exit}' \
    "$REPO_ROOT/.github/workflows/release-merge.yml"
}

test_the_sparse_checkout_fetches_exactly_the_lib_and_the_release_please_config() {
  local got
  got=$(sparse_checkout_paths)
  [[ "$got" == $'.github/tests/release-merge-lib.sh\nrelease-please-config.json' ]] || fail "got [$got]"
}

test_the_sparse_checkout_includes_the_file_the_merge_step_sources() {
  local sourced
  sourced=$(merge_step_script | sed -n 's/^source //p')
  [[ -n "$sourced" ]] || fail 'the merge step sources nothing'
  sparse_checkout_paths | grep -qxF "$sourced" || fail "the sparse checkout omits $sourced"
}

test_the_job_condition_has_the_ci_path_clause() {
  local got
  got=$(tr -d '\n' <"$REPO_ROOT/.github/workflows/release-merge.yml" | tr -s ' ')
  [[ "$got" == *"( github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'pull_request' && github.event.workflow_run.head_repository.full_name == github.repository && startsWith(github.event.workflow_run.head_branch, 'release-please--') )"* ]] \
    || fail 'the job condition lacks the CI-path clause'
}

test_the_workflow_never_sets_the_allowlist_config() {
  grep -q 'RELEASE_MERGE_CONFIG' "$REPO_ROOT/.github/workflows/release-merge.yml" \
    && fail 'the workflow sets RELEASE_MERGE_CONFIG'
  return 0
}

test_the_workflow_also_runs_when_release_please_completes() {
  grep -qE '^    workflows: \[CI, Release Please\]' "$REPO_ROOT/.github/workflows/release-merge.yml" \
    || fail 'the workflow_run trigger does not name Release Please'
}

test_the_workflow_runs_the_sweep_only_for_a_successful_release_please_push_to_main() {
  local got
  got=$(tr -d '\n' <"$REPO_ROOT/.github/workflows/release-merge.yml" | tr -s ' ')
  # The whole parenthesized clause, so the success check is in it and nothing else is.
  [[ "$got" == *"|| ( github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.name == 'Release Please' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == github.event.repository.default_branch )"* ]] \
    || fail 'the job condition does not pin the Release Please trigger to a successful push to main'
}

# A run that the job `if` skips still joins the concurrency group, and a newer pending run replaces
# an older pending one. CI's push to main completes with head_branch main, the branch the sweep
# also runs for, so a group without the workflow name lets that skipped run cancel a queued sweep.
test_the_concurrency_group_names_the_workflow_so_a_skipped_ci_push_run_cannot_cancel_a_queued_sweep() {
  local got
  got=$(grep -E '^  group: ' "$REPO_ROOT/.github/workflows/release-merge.yml")
  [[ "$got" == *'github.event.workflow_run.name'* ]] || fail "got [$got]"
}

test_the_merge_command_treats_a_lost_race_as_success() {
  local got
  got=$(merge_commands)
  [[ "$got" == *'|| release_merge_lost_race "$REPO" "$number" "$TESTED_SHA" '* ]] || fail "got [$got]"
}

test_the_merge_command_skips_the_ruleset_review_with_admin() {
  local got
  got=$(merge_commands)
  [[ "$got" == *' --admin '* ]] || fail "got [$got]"
}

test_the_merge_command_squashes() {
  local got
  got=$(merge_commands)
  [[ "$got" == *' --squash '* ]] || fail "got [$got]"
}

test_the_merge_command_does_not_read_the_sweep_loops_stdin() {
  local got
  got=$(merge_commands)
  [[ "$got" == *' </dev/null '* ]] || fail "got [$got]"
}

test_the_merge_command_pins_the_merge_to_the_commit_ci_tested() {
  local got
  got=$(merge_commands)
  [[ "$got" == *' --match-head-commit "$TESTED_SHA"'* ]] || fail "got [$got]"
}

run_tests "$@"
