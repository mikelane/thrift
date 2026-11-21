#!/usr/bin/env bash
# The sweep that picks the open release PRs to merge when Release Please completes on main, and the
# CI-run matching that decides whether a PR passed CI at its head.
# Usage: release-merge-sweep.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"
# shellcheck source=release-merge-stubs-lib.sh
source "$HARNESS_DIR/release-merge-stubs-lib.sh"

sweep() { stub_gh; release_merge_sweep "$REPO" main; }

test_a_sweep_with_no_open_release_prs_selects_nothing() {
  local got
  write_pulls
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_selects_a_pr_whose_ci_succeeded_at_its_head() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z'
  got=$(sweep)
  [[ "$got" == "111 $SHA_A" ]] || fail "got [$got]"
}

test_a_sweep_skips_a_pr_whose_ci_failed_at_its_head() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI completed failure 2026-10-18T10:00:00Z'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_skips_a_pr_whose_ci_is_still_running_at_its_head() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI in_progress null 2026-10-18T10:00:00Z'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_skips_a_pr_with_no_ci_run_at_its_head() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_logs_why_it_skips_a_pr_with_no_ci_run_at_its_head() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  got=$(sweep 2>&1 >/dev/null)
  [[ "$got" == "Skipping PR #111 at $SHA_A: "* ]] || fail "got [$got]"
}

test_a_sweep_skips_a_pr_whose_ci_succeeded_only_at_an_older_sha() {
  local got
  write_pulls "$(open_pr 111 $SHA_B)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_counts_only_the_latest_ci_run_at_the_head() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z' 'CI completed failure 2026-10-18T11:00:00Z'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_accepts_a_rerun_that_succeeded_after_a_failure() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI completed failure 2026-10-18T10:00:00Z' 'CI completed success 2026-10-18T11:00:00Z'
  got=$(sweep)
  [[ "$got" == "111 $SHA_A" ]] || fail "got [$got]"
}

test_a_sweep_ignores_runs_of_other_workflows() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z' 'Lint completed failure 2026-10-18T11:00:00Z .github/workflows/lint.yml'
  got=$(sweep)
  [[ "$got" == "111 $SHA_A" ]] || fail "got [$got]"
}

test_a_sweep_ignores_a_successful_run_from_a_fork() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z .github/workflows/ci.yml someone/thrift'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_ignores_a_successful_run_from_a_differently_named_branch() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A "CI completed success 2026-10-18T10:00:00Z .github/workflows/ci.yml $REPO main"
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_ignores_a_successful_run_of_another_workflow_file_named_ci() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z .github/workflows/fake.yml'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_skips_a_pr_the_other_path_already_merged() {
  local got
  write_pulls "$(open_pr 111 $SHA_A '.state = "closed"')"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_skips_a_pr_from_a_branch_without_the_release_please_prefix() {
  local got
  write_pulls "$(open_pr 111 $SHA_A '.head.ref = "feature/x"')"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_skips_a_pr_from_a_fork() {
  local got
  write_pulls "$(open_pr 111 $SHA_A '.head.repo.full_name = "someone/thrift"')"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_selects_each_pr_whose_ci_passed_and_no_other() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)" "$(open_pr 112 $SHA_B)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z'
  write_runs $SHA_B 'CI completed failure 2026-10-18T10:00:00Z'
  got=$(sweep)
  [[ "$got" == "111 $SHA_A" ]] || fail "got [$got]"
}

test_the_ci_run_lookup_uses_the_runs_token_not_the_app_token() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z'
  (export GH_TOKEN=app-token RUNS_TOKEN=runs-token; sweep >/dev/null)
  got=$(<"$TEST_DIR/runs-token")
  [[ "$got" == runs-token ]] || fail "got [$got]"
}

# sweep_fails: succeeds when the sweep exits non-zero, as the workflow runs it (pipefail on).
sweep_fails() { ! (set -o pipefail; sweep) >/dev/null 2>&1; }

test_a_sweep_fails_when_the_ci_run_lookup_fails_so_a_stuck_pr_is_not_hidden() {
  write_pulls "$(open_pr 111 $SHA_A)"
  : >"$TEST_DIR/runs-$SHA_A.error"
  sweep_fails || fail 'a failed CI run lookup was read as "no CI run"'
}

test_a_sweep_fails_when_the_pull_request_list_fails() {
  : >"$TEST_DIR/pulls.error"
  sweep_fails || fail 'a failed pull request list was read as "no open release PR"'
}

test_a_sweep_still_selects_a_pr_when_a_later_pr_lookup_fails() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)" "$(open_pr 112 $SHA_B)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z'
  : >"$TEST_DIR/runs-$SHA_B.error"
  got=$(sweep 2>/dev/null)
  [[ "$got" == "111 $SHA_A" ]] || fail "got [$got]"
}

test_a_sweep_fails_when_a_later_pr_lookup_fails_even_after_selecting_one() {
  write_pulls "$(open_pr 111 $SHA_A)" "$(open_pr 112 $SHA_B)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z'
  : >"$TEST_DIR/runs-$SHA_B.error"
  sweep_fails || fail 'a failed CI run lookup after a selected PR left the sweep green'
}

test_a_sweep_fails_when_the_ci_runs_response_is_not_json() {
  write_pulls "$(open_pr 111 $SHA_A)"
  echo 'not json' >"$TEST_DIR/runs-$SHA_A.json"
  sweep_fails || fail 'an unreadable CI runs response was read as "no CI run"'
}

test_a_sweep_reads_every_page_of_the_ci_runs() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z'
  jq -c . "$TEST_DIR/runs-$SHA_A.json" >"$TEST_DIR/page1"
  echo '{"workflow_runs":[]}' >>"$TEST_DIR/page1"
  mv "$TEST_DIR/page1" "$TEST_DIR/runs-$SHA_A.json"
  got=$(sweep)
  [[ "$got" == "111 $SHA_A" ]] || fail "got [$got]"
}

# ci.yml runs on pull_request with no branch filter, and anyone who can read the repo can open a PR
# from this repo's release branch into some other base. That PR's CI run has the same head SHA,
# head branch, head repository and workflow file, but it tested a merge into another base. It must
# not stand in for the release PR's own CI run, which here failed.
test_a_sweep_ignores_a_successful_run_from_a_pr_of_the_same_branch_into_another_base() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A \
    'CI completed success 2026-10-18T11:00:00Z - - - 999@old-feature 2' \
    'CI completed failure 2026-10-18T10:00:00Z - - - 111 1'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

# created_at has one-second resolution. Two runs created in the same second tie, and sort_by keeps
# the API's newest-first order, so `last` picks the older run. The newer run failed.
test_a_sweep_counts_the_newer_of_two_ci_runs_created_in_the_same_second() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A \
    'CI completed failure 2026-10-18T10:00:00Z - - - 111 2' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 1'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

# A run with an empty pull_requests array names no pull request, so it cannot be tied to this one.
test_a_sweep_ignores_a_successful_run_with_no_pull_requests() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z - - - none'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_sweep_ignores_a_successful_run_from_a_different_pr_number_into_main() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A 'CI completed success 2026-10-18T10:00:00Z - - - 999'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

# The runs API documents pull_requests as "Pull requests that are open with a head_sha or
# head_branch that matches the workflow run. The returned pull requests do not necessarily indicate
# pull requests that triggered the run." So while PR 999 (same release branch, into old-feature) is
# open, every run at that head lists both PRs, the run PR 999 triggered included. Its success must
# not stand in for the release PR's own CI run, which failed.
test_a_sweep_ignores_another_bases_run_that_lists_the_release_pr_too() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs $SHA_A \
    'CI completed success 2026-10-18T11:00:00Z - - - 999@old-feature,111 2' \
    'CI completed failure 2026-10-18T10:00:00Z - - - 999@old-feature,111 1'
  got=$(sweep)
  [[ -z "$got" ]] || fail "got [$got]"
}

run_tests "$@"
