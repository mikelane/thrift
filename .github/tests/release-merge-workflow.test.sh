#!/usr/bin/env bash
# The lost-race check after a failed merge, the merge command's flags, and the whole of release-merge.yml.
# The workflow is parsed with Ruby (Psych, the YAML 1.1 reader every runner has) and the WHOLE parsed
# document is compared with release-merge-workflow.expected.json, so an edit anywhere in the file (a
# top-level env or defaults, another job, a step, a trigger, a runner) fails a test, however it is spelled.
# ANY CHANGE TO release-merge.yml MUST UPDATE release-merge-workflow.expected.json IN THE SAME PR. The
# failing test prints the diff; regenerate the fixture with:
#   ruby -ryaml -rjson -e 'puts JSON.generate(YAML.safe_load(File.read(".github/workflows/release-merge.yml"), aliases: true))' | jq -S . > .github/tests/release-merge-workflow.expected.json
# Usage: release-merge-workflow.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"
# shellcheck source=release-merge-stubs-lib.sh
source "$HARNESS_DIR/release-merge-stubs-lib.sh"

WORKFLOW=$REPO_ROOT/.github/workflows/release-merge.yml
EXPECTED_WORKFLOW=$HARNESS_DIR/release-merge-workflow.expected.json

# workflow_json [file]: the workflow as one line of JSON. A YAML or Ruby error prints nothing and
# fails, so every check below fails closed. Psych reads a bare `on` key as boolean true, which JSON
# spells "true"; the fixture keeps that key as Psych emits it.
workflow_json() {
  ruby -ryaml -rjson -e '
    begin
      puts JSON.generate(YAML.safe_load(File.read(ARGV.fetch(0)), aliases: true))
    rescue StandardError, SyntaxError => e
      warn "cannot parse #{ARGV[0]}: #{e.class}"
      exit 1
    end' "${1:-$WORKFLOW}"
}

# workflow_text <jq-filter> [file]: the filter's string value, raw.
workflow_text() {
  workflow_json "${2:-}" | jq -r "$1"
}

# workflow_is_pinned [file]: succeeds when the parsed workflow equals the fixture exactly.
workflow_is_pinned() {
  local got
  got=$(workflow_json "${1:-}" | jq -S .) || return 1
  [[ "$got" == "$(jq -S . "$EXPECTED_WORKFLOW")" ]]
}

MERGE_JOB='.jobs.merge'

# merge_step_script: the run: string of the merge step.
merge_step_script() {
  workflow_text "$MERGE_JOB.steps[2].run"
}

# sparse_checkout_paths: the paths the checkout step fetches, one per line.
sparse_checkout_paths() {
  workflow_text "$MERGE_JOB.steps[1].with[\"sparse-checkout\"]"
}

test_the_whole_parsed_workflow_equals_the_expected_fixture() {
  workflow_is_pinned && return 0
  diff <(jq -S . "$EXPECTED_WORKFLOW") <(workflow_json | jq -S .) >&2
  fail 'release-merge.yml differs from release-merge-workflow.expected.json; update the fixture if the change is intended'
}

# The sweep reads only runs of .github/workflows/ci.yml, so the CI path must too: a workflow named
# CI in another file would otherwise start the merge job.
test_the_ci_completion_trigger_is_pinned_to_the_ci_workflow_file() {
  local condition
  condition=$(workflow_text "$MERGE_JOB.if")
  [[ "$condition" == *"github.event.workflow_run.path == '.github/workflows/ci.yml'"* ]] \
    || fail "the job condition never checks the CI workflow file path: $condition"
}

test_a_workflow_without_the_ci_path_check_is_refused_by_the_fixture_check() {
  refuses_variant 'o.replace("\n        && github.event.workflow_run.path == '"'"'.github/workflows/ci.yml'"'"'", "", 1)' \
    'the CI path check is gone'
}

test_the_merge_step_calls_release_merge_run() {
  merge_step_script | grep -qxF 'release_merge_run' || fail 'the merge step never calls release_merge_run'
}

test_the_merge_step_sets_euo_pipefail() {
  merge_step_script | grep -qxF 'set -euo pipefail' || fail 'the merge step does not set -euo pipefail'
}

test_the_sparse_checkout_includes_the_file_the_merge_step_sources() {
  local sourced
  sourced=$(merge_step_script | sed -n 's/^source //p')
  [[ -n "$sourced" ]] || fail 'the merge step sources nothing'
  sparse_checkout_paths | grep -qxF "$sourced" || fail "the sparse checkout omits $sourced"
}

# The lib sources its siblings (release_merge_load_sibling <file>) from its own directory; the sparse checkout must fetch each one, or
# the live step fails at `source` while every test (which runs from a full checkout) passes.
test_the_sparse_checkout_includes_every_file_the_lib_sources() {
  local lib_dir siblings missing
  lib_dir=$(dirname "$(merge_step_script | sed -n 's/^source //p')")
  siblings=$(sed -n "s|^release_merge_load_sibling \\([^ ]*\\) .*|$lib_dir/\\1|p" "$RELEASE_MERGE_LIB" | sort)
  [[ -n "$siblings" ]] || fail 'the lib sources no siblings'
  missing=$(comm -23 <(printf '%s\n' "$siblings") <(sparse_checkout_paths | sort))
  [[ -z "$missing" ]] || fail "the sparse checkout omits $missing"
}

# A sibling the lib reaches some other way than a `release_merge_load_sibling X` line still has
# to be fetched, so every release-merge-*.sh beside the lib must be in the sparse checkout.
test_the_sparse_checkout_includes_every_release_merge_script_on_disk() {
  local lib_dir on_disk missing
  lib_dir=$(dirname "$(merge_step_script | sed -n 's/^source //p')")
  on_disk=$(cd "$REPO_ROOT" && ls "$lib_dir"/release-merge-*.sh)
  [[ -n "$on_disk" ]] || fail "no release-merge-*.sh files under $lib_dir"
  missing=$(comm -23 <(printf '%s\n' "$on_disk" | sort) <(sparse_checkout_paths | sort))
  [[ -z "$missing" ]] || fail "the sparse checkout omits $missing"
}

# The step sources the lib by a relative path, so the lib's `cd "$(dirname ...)"` is a relative cd,
# which consults CDPATH: with a CDPATH entry the cd prints the directory, and the sibling path
# becomes two lines; with an entry holding .github/scripts the siblings come from that tree.
test_the_lib_sources_its_siblings_from_its_own_directory_when_cdpath_is_set() {
  local sourced decoy_cdpath_dir got
  sourced=$(merge_step_script | sed -n 's/^source //p')
  # Under the per-test TEST_DIR, which the harness's EXIT trap removes, so no decoy outlives the run.
  decoy_cdpath_dir=$TEST_DIR/cdpath-decoy
  mkdir -p "$decoy_cdpath_dir/$(dirname "$sourced")" || { fail "could not make the CDPATH decoy under $decoy_cdpath_dir"; return; }
  got=$(cd "$REPO_ROOT" && CDPATH="$decoy_cdpath_dir" "$BASH" -c 'set -euo pipefail; source "$1"; printf %s "$release_merge_lib_dir"' _ "$sourced" 2>&1)
  [[ "$got" == "$REPO_ROOT/$(dirname "$sourced")" ]] || fail "with CDPATH set, the lib resolved its directory as: $got"
}

# Without set -e, a failed cd must stop the source with a non-zero status, not go on to source
# /release-merge-ci-lookup.sh from the root directory. A `cd` function makes the cd fail.
test_the_lib_stops_sourcing_when_it_cannot_enter_its_own_directory_without_set_e() {
  local sourced got
  sourced=$(merge_step_script | sed -n 's/^source //p')
  got=$(cd "$REPO_ROOT" && "$BASH" -c 'cd() { return 1; }; source "$1"; printf "status=%s" "$?"' _ "$sourced" 2>&1)
  [[ "$got" == "status=1" ]] || fail "expected the source to stop with status 1 and no output, got: $got"
}

test_the_lib_defines_its_sibling_functions_when_cdpath_lists_the_current_directory() {
  local sourced
  sourced=$(merge_step_script | sed -n 's/^source //p')
  (cd "$REPO_ROOT" && CDPATH=.:/nonexistent "$BASH" -c 'set -euo pipefail; source "$1"; declare -F release_merge_sweep release_merge_lost_race >/dev/null' _ "$sourced") \
    || fail 'with CDPATH=.:/nonexistent, sourcing the lib failed or left the sibling functions undefined'
}

# The tests source the lib by their own path; this ties that path to the one the workflow sources,
# so a move that updates one side only (the tests, or the workflow and its fixture) fails here.
test_the_file_the_merge_step_sources_is_the_lib_the_tests_exercise() {
  local sourced
  sourced=$(merge_step_script | sed -n 's/^source //p')
  [[ "$REPO_ROOT/$sourced" -ef "$RELEASE_MERGE_LIB" ]] \
    || fail "the merge step sources $sourced, which is not the lib the tests source"
}

# YAML reads a lone CR as a line break, which a text reader of the file would not.
test_the_workflow_contains_no_carriage_return() {
  local got
  got=$(tr -cd '\r' <"$WORKFLOW" | wc -c | tr -d ' ')
  [[ "$got" == 0 ]] || fail "the workflow has $got carriage return(s)"
}

test_the_workflow_check_fails_closed_on_a_file_that_is_not_yaml() {
  printf 'jobs: [unclosed\n' >"$TEST_DIR/broken.yml"
  workflow_is_pinned "$TEST_DIR/broken.yml" && fail 'a file that does not parse passed'
  return 0
}

# lost_race <pr-json-filter>: release_merge_lost_race's status and output for PR 111 at SHA.
lost_race() {
  write_pr "$TEST_DIR/pr-111.json" "$1"
  stub_gh
  release_merge_lost_race "$REPO" 111 "$SHA"
}

test_a_failed_merge_of_a_pr_that_was_merged_by_the_other_trigger_is_a_lost_race() {
  local got
  got=$(lost_race '.state = "closed" | .merged = true') \
    || fail 'treated a merged PR as a real failure'
  [[ "$got" == 'PR #111 is closed: another run merged it first.' ]] || fail "got [$got]"
}

test_a_failed_merge_of_a_pr_closed_without_merging_says_it_was_closed_without_being_merged() {
  local got
  got=$(lost_race '.state = "closed" | .merged = false') \
    || fail 'treated a closed PR as a real failure'
  [[ "$got" == 'PR #111 was closed without being merged.' ]] || fail "got [$got]"
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

test_a_failed_merge_whose_pr_lookup_fails_returns_2_so_it_differs_from_a_still_open_pr() {
  local status=0
  stub_gh
  release_merge_lost_race "$REPO" 111 "$SHA" >/dev/null 2>&1 || status=$?
  [[ "$status" == 2 ]] || fail "got status $status"
}

test_a_failed_merge_of_an_open_pr_at_the_tested_head_returns_1() {
  local status=0
  write_pr "$TEST_DIR/pr-111.json" .
  stub_gh
  release_merge_lost_race "$REPO" 111 "$SHA" >/dev/null 2>&1 || status=$?
  [[ "$status" == 1 ]] || fail "got status $status"
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
  grep -E '^[[:space:]]*gh pr merge ' "$RELEASE_MERGE_LIB" \
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
  [[ "$got" == *'|| release_merge_lost_race "$REPO" "$number" "$tested_sha" '* ]] || fail "got [$got]"
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
  [[ "$got" == *' --match-head-commit "$tested_sha"'* ]] || fail "got [$got]"
}

# --- Variants a YAML parser reads as a weaker gate. Each is a copy of the workflow that Psych and
# actionlint both accept; workflow_is_pinned must refuse it. ---

REF='          ref: ${{ github.event.workflow_run.head_sha }}'

# variant_workflow <python-expr>: writes the workflow, edited by the expression over `o`, to VARIANT.
# CHK, WITH, RUN_HDR, RUN_BODY, REF, PAY, DECOY_CHECKOUT and DECOY_RUN are predefined for it.
# The <python-expr> comes only from this file's own literals, never from workflow or user input.
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
  workflow_is_pinned "$VARIANT" && fail "the check passed a workflow where $2"
  return 0
}

test_the_unedited_workflow_is_what_the_variants_start_from() {
  variant_workflow 'o'
  workflow_is_pinned "$VARIANT" || fail 'the unedited workflow failed the check'
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

# AQA run 6: bash expands BASH_ENV (command substitution included) before the script runs, so a
# workflow-level env can rewrite the sourced lib before the step sources it.
test_the_check_fails_a_workflow_level_bash_env_that_rewrites_the_gate() {
  refuses_variant 'o.replace("permissions: {}\n", "permissions: {}\n\nenv:\n  BASH_ENV: \x27$(perl -pi -e \"s/^release_merge_problems\\\\(\\\\) \\\\{/release_merge_problems() { return 0; }\\\\nzz() {/\" .github/scripts/release-merge-lib.sh)\x27\n", 1)' \
    'a workflow-level env sets BASH_ENV to a command that neuters release_merge_problems'
}

# AQA run 6: the step-level shell is refused, but defaults.run.shell at the workflow level applies too.
test_the_check_fails_a_workflow_level_default_shell_that_skips_the_script() {
  refuses_variant 'o.replace("permissions: {}\n", "permissions: {}\n\ndefaults:\n  run:\n    shell: bash -c true {0}\n", 1)' \
    'a workflow-level defaults.run.shell skips the merge script'
}

# AQA run 6: only .jobs.merge is pinned, so a second job in the release environment can mint the App token.
test_the_check_fails_a_second_job_that_mints_the_app_token() {
  refuses_variant 'o + "\n  also:\n    runs-on: ubuntu-latest\n    environment: release\n    steps:\n      - id: t\n        uses: actions/create-github-app-token@f418cff399f7aef4c2f0ad47e25ca7a6abbdd6fc\n        with:\n          client-id: ${{ vars.RELEASE_APP_ID }}\n          private-key: ${{ secrets.RELEASE_APP_PRIVATE_KEY }}\n      - run: echo \"$T\"\n        env:\n          T: ${{ steps.t.outputs.token }}\n"' \
    'a second job mints the App token outside the gated merge job'
}

run_tests "$@"
