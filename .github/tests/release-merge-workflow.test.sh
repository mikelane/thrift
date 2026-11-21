#!/usr/bin/env bash
# The lost-race check after a failed merge, and the shape of the merge job in release-merge.yml: the
# merge command's flags, the triggers, the token use, the concurrency group, the list of steps, the
# checkout step, and the merge step's script and environment.
# The workflow is parsed with Ruby (Psych, the YAML 1.1 reader every runner has) and compared as data,
# so no spelling of a key, quote, flow style, alias or blank line can hide a change from the tests.
# Usage: release-merge-workflow.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"
# shellcheck source=release-merge-stubs-lib.sh
source "$HARNESS_DIR/release-merge-stubs-lib.sh"

WORKFLOW=$REPO_ROOT/.github/workflows/release-merge.yml

# workflow_json [file]: the workflow as one line of JSON. A YAML or Ruby error prints nothing and
# fails, so every check below fails closed. Psych reads a bare `on` key as boolean true, which JSON
# spells "true", so read the triggers through workflow_triggers_filter.
workflow_json() {
  ruby -ryaml -rjson -e '
    begin
      puts JSON.generate(YAML.safe_load(File.read(ARGV.fetch(0)), aliases: true))
    rescue StandardError, SyntaxError => e
      warn "cannot parse #{ARGV[0]}: #{e.class}"
      exit 1
    end' "${1:-$WORKFLOW}"
}

# workflow_has <jq-filter> <json> [file]: succeeds when the filter's value equals the JSON exactly.
workflow_has() {
  workflow_json "${3:-}" | jq -e --argjson want "$2" "($1) == \$want" >/dev/null
}

# workflow_text <jq-filter> [file]: the filter's string value, raw.
workflow_text() {
  workflow_json "${2:-}" | jq -r "$1"
}

TRIGGERS_FILTER='(.on // .["true"])'
MERGE_JOB='.jobs.merge'

# merge_step_script: the run: string of the merge step.
merge_step_script() {
  workflow_text "$MERGE_JOB.steps[2].run"
}

# sparse_checkout_paths: the paths the checkout step fetches, one per line.
sparse_checkout_paths() {
  workflow_text "$MERGE_JOB.steps[1].with[\"sparse-checkout\"]"
}

# --- What the merge job must be, each as one check that takes an optional workflow file. ---

merge_job_keys_are_expected() {
  workflow_has "$MERGE_JOB | keys" '["environment","if","permissions","runs-on","steps","timeout-minutes"]' "${1:-}"
}

merge_job_environment_is_release() {
  workflow_has "$MERGE_JOB.environment" '"release"' "${1:-}"
}

merge_job_permissions_are_actions_read_only() {
  workflow_has "$MERGE_JOB.permissions" '{"actions":"read"}' "${1:-}"
}

MERGE_JOB_IF='( github.event.workflow_run.conclusion == '\''success'\'' && github.event.workflow_run.event == '\''pull_request'\'' && github.event.workflow_run.head_repository.full_name == github.repository && startsWith(github.event.workflow_run.head_branch, '\''release-please--'\'') ) || ( github.event.workflow_run.conclusion == '\''success'\'' && github.event.workflow_run.name == '\''Release Please'\'' && github.event.workflow_run.event == '\''push'\'' && github.event.workflow_run.head_branch == github.event.repository.default_branch )'

merge_job_condition_is_expected() {
  workflow_has "$MERGE_JOB.if | gsub(\"\\\\s+\"; \" \")" "$(jq -Rn --arg s "$MERGE_JOB_IF" '$s')" "${1:-}"
}

merge_job_steps_are_expected() {
  workflow_has "$MERGE_JOB.steps | map({name, uses})" '[
    {"name":"Mint a short-lived App token","uses":"actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510"},
    {"name":null,"uses":"actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1"},
    {"name":"Squash-merge the release PR if the gate passes","uses":null}]' "${1:-}"
}

merge_job_token_step_is_expected() {
  workflow_has "$MERGE_JOB.steps[0]" '{
    "name":"Mint a short-lived App token","id":"app-token",
    "uses":"actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510",
    "with":{"client-id":"${{ vars.RELEASE_APP_ID }}","private-key":"${{ secrets.RELEASE_APP_PRIVATE_KEY }}",
            "permission-contents":"write","permission-pull-requests":"write"}}' "${1:-}"
}

merge_job_checkout_step_is_expected() {
  workflow_has "$MERGE_JOB.steps[1]" '{
    "uses":"actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    "with":{"token":"${{ steps.app-token.outputs.token }}","persist-credentials":false,
            "sparse-checkout":".github/tests/release-merge-lib.sh\nrelease-please-config.json\n",
            "sparse-checkout-cone-mode":false}}' "${1:-}"
}

# The merge step minus its script: exactly a name and an env, so no shell, if or continue-on-error.
merge_job_merge_step_is_expected() {
  workflow_has "$MERGE_JOB.steps[2] | del(.run)" '{
    "name":"Squash-merge the release PR if the gate passes",
    "env":{"GH_TOKEN":"${{ steps.app-token.outputs.token }}","RUNS_TOKEN":"${{ github.token }}",
           "REPO":"${{ github.repository }}","OWNER":"${{ github.repository_owner }}",
           "BASE":"${{ github.event.repository.default_branch }}",
           "BOT_LOGIN":"${{ steps.app-token.outputs.app-slug }}[bot]",
           "TRIGGER":"${{ github.event.workflow_run.name }}","BRANCH":"${{ github.event.workflow_run.head_branch }}",
           "CI_TESTED_SHA":"${{ github.event.workflow_run.head_sha }}"}}' "${1:-}"
}

merge_job_script_is_expected() {
  local want
  want=$(printf '%s\n' \
    'set -euo pipefail' \
    '# shellcheck source=.github/tests/release-merge-lib.sh' \
    'source .github/tests/release-merge-lib.sh' \
    '# Every temp file lives here, so an early return or a failure still cleans up.' \
    'work_dir=$(mktemp -d)' \
    "trap 'rm -rf \"\$work_dir\"' EXIT" \
    'release_merge_run' | jq -Rs .)
  workflow_has "$MERGE_JOB.steps[2].run" "$want" "${1:-}"
}

# merge_job_is_pinned [file]: every check above.
merge_job_is_pinned() {
  merge_job_keys_are_expected "$@" \
    && merge_job_environment_is_release "$@" \
    && merge_job_permissions_are_actions_read_only "$@" \
    && merge_job_condition_is_expected "$@" \
    && merge_job_steps_are_expected "$@" \
    && merge_job_token_step_is_expected "$@" \
    && merge_job_checkout_step_is_expected "$@" \
    && merge_job_merge_step_is_expected "$@" \
    && merge_job_script_is_expected "$@"
}

test_the_merge_job_has_exactly_the_expected_keys() {
  merge_job_keys_are_expected || fail "keys: $(workflow_text "$MERGE_JOB | keys | join(\",\")")"
}

test_the_merge_job_does_not_continue_on_error() {
  workflow_has "$MERGE_JOB | has(\"continue-on-error\")" false || fail 'the merge job sets continue-on-error'
}

test_the_merge_job_runs_in_the_release_environment() {
  merge_job_environment_is_release || fail "environment: $(workflow_text "$MERGE_JOB.environment")"
}

test_the_merge_job_grants_its_token_actions_read_and_nothing_else() {
  merge_job_permissions_are_actions_read_only || fail "permissions: $(workflow_text "$MERGE_JOB.permissions")"
}

test_the_workflow_grants_no_permissions_at_the_top_level() {
  workflow_has '.permissions' '{}' || fail "got [$(workflow_text '.permissions')]"
}

test_the_job_condition_is_exactly_the_expected_expression() {
  merge_job_condition_is_expected || fail "got [$(workflow_text "$MERGE_JOB.if")]"
}

test_the_merge_job_has_exactly_the_three_expected_steps_in_order() {
  merge_job_steps_are_expected || fail "got [$(workflow_text "$MERGE_JOB.steps | map(.name // .uses) | join(\" | \")")]"
}

test_the_token_step_asks_for_contents_and_pull_requests_write_only() {
  merge_job_token_step_is_expected || fail "got [$(workflow_text "$MERGE_JOB.steps[0]")]"
}

test_the_checkout_step_takes_exactly_the_app_token_no_credentials_and_the_sparse_paths() {
  merge_job_checkout_step_is_expected || fail "got [$(workflow_text "$MERGE_JOB.steps[1]")]"
}

# The env also pins CI_TESTED_SHA, RUNS_TOKEN and BOT_LOGIN, and a merge step with no `if`, `shell`
# or `continue-on-error` key cannot be skipped, swallowed or run through another shell.
test_the_merge_step_has_exactly_a_name_an_env_and_a_script() {
  merge_job_merge_step_is_expected || fail "got [$(workflow_text "$MERGE_JOB.steps[2] | del(.run)")]"
}

test_the_merge_step_script_is_exactly_the_expected_block() {
  merge_job_script_is_expected || fail "the merge step's run block changed: [$(merge_step_script)]"
}

test_the_merge_step_calls_release_merge_run() {
  merge_step_script | grep -qxF 'release_merge_run' || fail 'the merge step never calls release_merge_run'
}

test_the_merge_step_is_strict() {
  merge_step_script | grep -qxF 'set -euo pipefail' || fail 'the merge step does not set -euo pipefail'
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

test_the_workflow_runs_only_when_ci_or_release_please_completes() {
  workflow_has "$TRIGGERS_FILTER" '{"workflow_run":{"workflows":["CI","Release Please"],"types":["completed"]}}' \
    || fail "got [$(workflow_text "$TRIGGERS_FILTER")]"
}

# A run that the job `if` skips still joins the concurrency group, and a newer pending run replaces
# an older pending one. CI's push to main completes with head_branch main, the branch the sweep
# also runs for, so a group without the workflow name lets that skipped run cancel a queued sweep.
test_the_concurrency_group_names_the_workflow_so_a_skipped_ci_push_run_cannot_cancel_a_queued_sweep() {
  workflow_has '.concurrency' '{
    "group":"release-merge-${{ github.event.workflow_run.name }}-${{ github.event.workflow_run.head_repository.full_name }}-${{ github.event.workflow_run.head_branch }}",
    "cancel-in-progress":false}' || fail "got [$(workflow_text '.concurrency')]"
}

# YAML reads a lone CR as a line break, which a text reader of the file would not.
test_the_workflow_contains_no_carriage_return() {
  local got
  got=$(tr -cd '\r' <"$WORKFLOW" | wc -c | tr -d ' ')
  [[ "$got" == 0 ]] || fail "the workflow has $got carriage return(s)"
}

test_the_workflow_check_fails_closed_on_a_file_that_is_not_yaml() {
  printf 'jobs: [unclosed\n' >"$TEST_DIR/broken.yml"
  merge_job_is_pinned "$TEST_DIR/broken.yml" && fail 'a file that does not parse passed'
  return 0
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

# --- Variants a YAML parser reads as a weaker gate. Each is a copy of the workflow that Psych and
# actionlint both accept; merge_job_is_pinned must refuse it. ---

REF='          ref: ${{ github.event.workflow_run.head_sha }}'

# variant_workflow <python-expr>: writes the workflow, edited by the expression over `o`, to VARIANT.
# CHK, WITH, RUN_HDR, RUN_BODY, REF, PAY, DECOY_CHECKOUT and DECOY_RUN are predefined for it.
variant_workflow() {
  VARIANT=$TEST_DIR/variant.yml
  python3 - "$WORKFLOW" "$VARIANT" "$1" "$REF" <<'PY'
import sys
o = open(sys.argv[1], newline="").read()
REF = sys.argv[4] + "\n"
CHK = [l for l in o.splitlines() if l.startswith("      - uses: actions/checkout@")][0] + "\n"
WITH = o[o.index("        with:\n          token: ${{ steps.app-token"):o.index("      - name: Squash-merge")]
RUN_HDR = "        run: |\n"
RUN_BODY = o[o.index(RUN_HDR) + len(RUN_HDR):]
DECOY_CHECKOUT = "\n" + CHK + WITH.rstrip("\n") + "\n"
DECOY_RUN = "\n      - name: decoy\n" + RUN_HDR + RUN_BODY
PAY = "          release_merge_problems() { :; }; TRIGGER=CI release_merge_run\n"
open(sys.argv[2], "w", newline="").write(eval(sys.argv[3]))
PY
}

# refuses_variant <python-expr> <what the variant does>: fails the test when the pinned check passes.
refuses_variant() {
  variant_workflow "$1"
  merge_job_is_pinned "$VARIANT" && fail "the check passed a workflow where $2"
  return 0
}

test_the_unedited_workflow_is_what_the_variants_start_from() {
  variant_workflow 'o'
  merge_job_is_pinned "$VARIANT" || fail 'the unedited workflow failed the check'
}

test_the_check_fails_a_checkout_whose_quoted_with_key_fetches_the_pr_head() {
  refuses_variant 'o.replace("        with:\n          token", "        \"with\":\n" + REF + "          token", 1) + DECOY_CHECKOUT' \
    'the checkout fetches the PR head under a quoted with: key'
}

test_the_check_fails_a_checkout_whose_spaced_with_key_fetches_the_pr_head() {
  refuses_variant 'o.replace("        with:\n          token", "        with :\n" + REF + "          token", 1) + DECOY_CHECKOUT' \
    'the checkout fetches the PR head under a `with :` key'
}

test_the_check_fails_a_checkout_whose_flow_style_with_fetches_the_pr_head() {
  refuses_variant 'o.replace(WITH, "        with: {ref: \"${{ github.event.workflow_run.head_sha }}\", token: \"${{ steps.app-token.outputs.token }}\", persist-credentials: false}\n\n", 1) + DECOY_CHECKOUT' \
    'the checkout fetches the PR head under a flow-style with:'
}

test_the_check_fails_a_checkout_whose_with_is_an_alias_of_a_map_with_a_ref() {
  refuses_variant 'o.replace("        with:\n          client-id", "        with: &w\n" + REF + "          client-id", 1).replace(WITH, "        with: *w\n\n", 1) + DECOY_CHECKOUT' \
    'the checkout takes its with: from an alias'
}

test_the_check_fails_a_merge_step_whose_quoted_run_key_skips_the_gate() {
  refuses_variant 'o.replace(RUN_HDR, "        \"run\": |\n", 1).replace("          release_merge_run\n", PAY, 1) + DECOY_RUN' \
    'a quoted "run": key overrides release_merge_problems'
}

test_the_check_fails_a_merge_step_whose_spaced_run_key_skips_the_gate() {
  refuses_variant 'o.replace(RUN_HDR, "        run : |\n", 1).replace("          release_merge_run\n", PAY, 1) + DECOY_RUN' \
    'a `run :` key overrides release_merge_problems'
}

test_the_check_fails_a_second_named_checkout_of_the_pr_head() {
  refuses_variant 'o.replace("      - name: Squash-merge", "      - name: fetch\n        uses: " + CHK.split("uses: ")[1] + "        with:\n          token: ${{ steps.app-token.outputs.token }}\n" + REF + "\n      - name: Squash-merge", 1)' \
    'a second named checkout step fetches the PR head'
}

# A blank line inside the run block is still inside it, so a payload after one is part of the script.
test_the_check_fails_a_payload_that_follows_a_blank_line_in_the_run_block() {
  refuses_variant 'o.replace("          release_merge_run\n", "          release_merge_run\n\n" + PAY, 1)' \
    'a line after a blank line in the run block overrides release_merge_problems'
}

# `run: |1` sets the block indent to 9, so YAML reads a 9-space line as part of the script.
test_the_check_fails_a_run_header_with_an_indentation_indicator() {
  refuses_variant 'o.replace(RUN_HDR, "        run: |1\n", 1)' 'the run: header carries an indentation indicator'
}

# A blank line inside `with:` is still inside the mapping, so a `ref:` after it checks out the PR.
test_the_check_fails_a_ref_that_follows_a_blank_line_in_the_with_block() {
  refuses_variant 'o.replace("          sparse-checkout-cone-mode: false\n", "          sparse-checkout-cone-mode: false\n\n" + REF, 1)' \
    'a ref: follows a blank line in the checkout with: block'
}

test_the_check_fails_a_merge_step_that_runs_through_another_shell() {
  refuses_variant 'o.replace(RUN_HDR, "        shell: bash -c true {0}\n" + RUN_HDR, 1)' 'the merge step sets a shell that skips the script'
}

test_the_check_fails_an_env_that_rebinds_the_tested_sha() {
  refuses_variant 'o.replace("CI_TESTED_SHA: ${{ github.event.workflow_run.head_sha }}", "CI_TESTED_SHA: ${{ github.event.pull_request.head.sha }}", 1)' \
    'CI_TESTED_SHA is the PR head instead of the commit CI tested'
}

test_the_check_fails_a_job_condition_that_ends_in_or_true() {
  refuses_variant 'o.replace("default_branch\n      )\n    runs-on", "default_branch\n      ) || true\n    runs-on", 1)' 'the job condition ends in || true'
}

test_the_check_fails_a_merge_job_that_continues_on_error() {
  refuses_variant 'o.replace("    runs-on: ubuntu-latest\n", "    runs-on: ubuntu-latest\n    continue-on-error: true\n", 1)' 'the merge job continues on error'
}

test_the_check_fails_a_merge_job_with_write_all_permissions() {
  refuses_variant 'o.replace("    permissions:\n      actions: read\n", "    permissions: write-all\n", 1)' 'the merge job has write-all permissions'
}

test_the_check_fails_a_merge_job_without_its_environment() {
  refuses_variant 'o.replace("    environment: release\n", "", 1)' 'the merge job has no environment'
}

run_tests "$@"
