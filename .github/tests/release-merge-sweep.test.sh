#!/usr/bin/env bash
# The sweep that picks the open release PRs to merge when Release Please completes on main, and the
# CI-run matching that decides whether a PR passed CI at its head.
# Usage: release-merge-sweep.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"
# shellcheck source=release-merge-stubs-lib.sh
source "$HARNESS_DIR/release-merge-stubs-lib.sh"

sweep() { stub_gh; release_merge_sweep "$REPO" main; }

# assert_sweep_skips <number> <sha>: the sweep selects nothing, exits 0, and logs that it skipped PR
# <number> at <sha>. Only a CI lookup that worked and found no passing run logs that line, so a
# lookup that failed, or a fixture it could not read, does not pass for a run the sweep rejected.
assert_sweep_skips() {
  local got status
  got=$(sweep 2>"$TEST_DIR/sweep-err")
  status=$?
  [[ -z "$got" ]] || fail "selected [$got]"
  [[ "$status" == 0 ]] || fail "the sweep exited $status"
  assert_file_has "$TEST_DIR/sweep-err" "Skipping PR #$1 at $2: "
}

# assert_sweep_warns_ci_failed <number> <sha>: the sweep selects nothing, exits 0, and reports a
# failed CI run at <sha> as a warning annotation rather than as an ordinary skip.
assert_sweep_warns_ci_failed() {
  local got status
  got=$(sweep 2>"$TEST_DIR/sweep-err")
  status=$?
  [[ -z "$got" ]] || fail "selected [$got]"
  [[ "$status" == 0 ]] || fail "the sweep exited $status"
  assert_file_has "$TEST_DIR/sweep-err" \
    "::warning title=Release PR #$1 not merged::CI did not succeed at $2"
  assert_file_lacks "$TEST_DIR/sweep-err" "Skipping PR #$1"
}

# assert_sweep_looks_up_no_ci_run: the sweep selects nothing, exits 0, and never asks for a CI run
# (the stub writes runs-token on every lookup), so the PR list itself left the PR out.
assert_sweep_looks_up_no_ci_run() {
  local got status
  got=$(sweep)
  status=$?
  [[ -z "$got" ]] || fail "selected [$got]"
  [[ "$status" == 0 ]] || fail "the sweep exited $status"
  assert_no_file "$TEST_DIR/runs-token"
}

# ci_status: the code release_merge_ci_outcome returns for PR 111 at SHA_A.
ci_status() {
  stub_gh
  release_merge_ci_outcome "$REPO" "$SHA_A" "$RELEASE_BRANCH" 111 main >/dev/null 2>&1 \
    && echo 0 || echo $?
}

test_the_ci_lookup_returns_0_when_the_latest_run_succeeded() {
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z'
  [[ "$(ci_status)" == 0 ]] || fail "got $(ci_status)"
}

test_the_ci_lookup_returns_1_when_no_run_counts() {
  [[ "$(ci_status)" == 1 ]] || fail "got $(ci_status)"
}

test_the_ci_lookup_returns_2_when_the_lookup_fails() {
  : >"$TEST_DIR/runs-$SHA_A.error"
  [[ "$(ci_status)" == 2 ]] || fail "got $(ci_status)"
}

test_the_ci_lookup_returns_3_when_the_latest_run_is_still_going() {
  write_runs "$SHA_A" 'CI in_progress null 2026-10-18T10:00:00Z'
  [[ "$(ci_status)" == 3 ]] || fail "got $(ci_status)"
}

test_the_ci_lookup_returns_4_when_the_latest_run_failed() {
  write_runs "$SHA_A" 'CI completed failure 2026-10-18T10:00:00Z'
  [[ "$(ci_status)" == 4 ]] || fail "got $(ci_status)"
}

test_the_ci_lookup_returns_4_when_the_latest_run_was_cancelled() {
  write_runs "$SHA_A" 'CI completed cancelled 2026-10-18T10:00:00Z'
  [[ "$(ci_status)" == 4 ]] || fail "got $(ci_status)"
}

test_the_ci_lookup_returns_3_not_4_when_a_new_run_is_going_after_a_failure() {
  write_runs "$SHA_A" 'CI in_progress null 2026-10-18T11:00:00Z' \
    'CI completed failure 2026-10-18T10:00:00Z'
  [[ "$(ci_status)" == 3 ]] || fail "got $(ci_status)"
}

test_a_sweep_does_not_warn_that_ci_failed_when_ci_is_still_running() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI in_progress null 2026-10-18T10:00:00Z'
  sweep >/dev/null 2>"$TEST_DIR/sweep-err"
  assert_file_lacks "$TEST_DIR/sweep-err" "::warning"
}

test_a_sweep_with_no_open_release_prs_selects_nothing() {
  write_pulls
  assert_sweep_looks_up_no_ci_run
}

test_a_sweep_selects_a_pr_whose_ci_succeeded_at_its_head() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z'
  got=$(sweep)
  [[ "$got" == "111 $SHA_A" ]] || fail "got [$got]"
}

test_a_sweep_warns_about_a_pr_whose_ci_failed_at_its_head() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed failure 2026-10-18T10:00:00Z'
  assert_sweep_warns_ci_failed 111 "$SHA_A"
}

test_a_sweep_skips_a_pr_whose_ci_is_still_running_at_its_head() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI in_progress null 2026-10-18T10:00:00Z'
  assert_sweep_skips 111 "$SHA_A"
  assert_file_has "$TEST_DIR/sweep-err" "CI is still running"
}

test_a_sweep_skips_a_pr_with_no_ci_run_at_its_head() {
  write_pulls "$(open_pr 111 $SHA_A)"
  assert_sweep_skips 111 "$SHA_A"
  assert_file_has "$TEST_DIR/sweep-err" "no CI run for it alone at that head"
}

test_a_sweep_skips_a_pr_whose_ci_succeeded_only_at_an_older_sha() {
  write_pulls "$(open_pr 111 $SHA_B)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z'
  assert_sweep_skips 111 "$SHA_B"
}

test_a_sweep_counts_only_the_latest_ci_run_at_the_head() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z' 'CI completed failure 2026-10-18T11:00:00Z'
  assert_sweep_warns_ci_failed 111 "$SHA_A"
}

test_a_sweep_accepts_a_rerun_that_succeeded_after_a_failure() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed failure 2026-10-18T10:00:00Z' 'CI completed success 2026-10-18T11:00:00Z'
  got=$(sweep)
  [[ "$got" == "111 $SHA_A" ]] || fail "got [$got]"
}

test_a_sweep_ignores_runs_of_other_workflows() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z' 'Lint completed failure 2026-10-18T11:00:00Z .github/workflows/lint.yml'
  got=$(sweep)
  [[ "$got" == "111 $SHA_A" ]] || fail "got [$got]"
}

test_a_sweep_ignores_a_successful_run_from_a_fork() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z .github/workflows/ci.yml someone/thrift'
  assert_sweep_skips 111 "$SHA_A"
}

test_a_sweep_ignores_a_successful_run_from_a_differently_named_branch() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" "CI completed success 2026-10-18T10:00:00Z .github/workflows/ci.yml $REPO main"
  assert_sweep_skips 111 "$SHA_A"
}

test_a_sweep_ignores_a_successful_run_of_another_workflow_file_named_ci() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z .github/workflows/fake.yml'
  assert_sweep_skips 111 "$SHA_A"
}

test_a_sweep_skips_a_pr_the_other_path_already_merged() {
  write_pulls "$(open_pr 111 $SHA_A '.state = "closed"')"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z'
  assert_sweep_looks_up_no_ci_run
}

test_a_sweep_skips_a_pr_from_a_branch_without_the_release_please_prefix() {
  write_pulls "$(open_pr 111 $SHA_A '.head.ref = "feature/x"')"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z'
  assert_sweep_looks_up_no_ci_run
}

test_a_sweep_skips_a_pr_from_a_fork() {
  write_pulls "$(open_pr 111 $SHA_A '.head.repo.full_name = "someone/thrift"')"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z'
  assert_sweep_looks_up_no_ci_run
}

test_a_sweep_selects_each_pr_whose_ci_passed_and_no_other() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)" "$(open_pr 112 $SHA_B)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z'
  write_runs "$SHA_B" 'CI completed failure 2026-10-18T10:00:00Z - - - 112'
  got=$(sweep 2>"$TEST_DIR/sweep-err")
  [[ "$got" == "111 $SHA_A" ]] || fail "got [$got]"
  assert_file_has "$TEST_DIR/sweep-err" \
    "::warning title=Release PR #112 not merged::CI did not succeed at $SHA_B"
}

test_the_ci_run_lookup_uses_the_runs_token_not_the_app_token() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z'
  (export GH_TOKEN=app-token RUNS_TOKEN=runs-token; sweep >/dev/null)
  got=$(<"$TEST_DIR/runs-token")
  [[ "$got" == runs-token ]] || fail "got [$got]"
}

# sweep_fails: succeeds when the sweep exits non-zero, as the workflow runs it (pipefail on).
# Its stderr goes to sweep-err, so a test can check which lookup failed.
sweep_fails() { ! (set -o pipefail; sweep) >/dev/null 2>"$TEST_DIR/sweep-err"; }

test_a_sweep_fails_when_the_ci_run_lookup_fails_so_a_stuck_pr_is_not_hidden() {
  write_pulls "$(open_pr 111 $SHA_A)"
  : >"$TEST_DIR/runs-$SHA_A.error"
  sweep_fails || fail 'a failed CI run lookup was read as "no CI run"'
  assert_file_has "$TEST_DIR/sweep-err" "Cannot read the CI runs of PR #111 at $SHA_A;"
}

test_a_sweep_fails_when_the_pull_request_list_fails() {
  : >"$TEST_DIR/pulls.error"
  sweep_fails || fail 'a failed pull request list was read as "no open release PR"'
}

test_a_sweep_still_selects_a_pr_when_a_later_pr_lookup_fails() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)" "$(open_pr 112 $SHA_B)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z'
  : >"$TEST_DIR/runs-$SHA_B.error"
  got=$(sweep 2>/dev/null)
  [[ "$got" == "111 $SHA_A" ]] || fail "got [$got]"
}

test_a_sweep_fails_when_a_later_pr_lookup_fails_even_after_selecting_one() {
  write_pulls "$(open_pr 111 $SHA_A)" "$(open_pr 112 $SHA_B)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z'
  : >"$TEST_DIR/runs-$SHA_B.error"
  sweep_fails || fail 'a failed CI run lookup after a selected PR left the sweep green'
  assert_file_has "$TEST_DIR/sweep-err" "Cannot read the CI runs of PR #112 at $SHA_B;"
}

test_a_sweep_fails_when_the_ci_runs_response_is_not_json() {
  write_pulls "$(open_pr 111 $SHA_A)"
  echo 'not json' >"$TEST_DIR/runs-$SHA_A.json"
  sweep_fails || fail 'an unreadable CI runs response was read as "no CI run"'
  assert_file_has "$TEST_DIR/sweep-err" "Cannot read the CI runs of PR #111 at $SHA_A;"
}

# The stub prints the runs as two pages, as `gh api --paginate` does: an older failure on page 1 and
# the deciding later success on page 2. Judging each page on its own finds the failure (or prints
# two conclusions), so this checks the pages are combined. That the lib asks for every page at all
# is checked by the stub, which fails a CI runs call without --paginate.
test_a_sweep_reads_every_page_of_the_ci_runs() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed failure 2026-10-18T10:00:00Z'
  jq -c . "$TEST_DIR/runs-$SHA_A.json" >"$TEST_DIR/pages"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T11:00:00Z'
  jq -c . "$TEST_DIR/runs-$SHA_A.json" >>"$TEST_DIR/pages"
  mv "$TEST_DIR/pages" "$TEST_DIR/runs-$SHA_A.json"
  got=$(sweep)
  [[ "$got" == "111 $SHA_A" ]] || fail "got [$got]"
}

# ci.yml runs on pull_request with no branch filter, and anyone who can read the repo can open a PR
# from this repo's release branch into some other base. That PR's CI run has the same head SHA,
# head branch, head repository and workflow file, but it tested a merge into another base. It must
# not stand in for the release PR's own CI run, which here failed.
test_a_sweep_ignores_a_successful_run_from_a_pr_of_the_same_branch_into_another_base() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" \
    'CI completed success 2026-10-18T11:00:00Z - - - 999@old-feature 2' \
    'CI completed failure 2026-10-18T10:00:00Z - - - 111 1'
  assert_sweep_warns_ci_failed 111 "$SHA_A"
}

# created_at has one-second resolution. Two runs created in the same second tie, and sort_by keeps
# the API's newest-first order, so `last` picks the older run. The newer run failed.
test_a_sweep_counts_the_newer_of_two_ci_runs_created_in_the_same_second() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" \
    'CI completed failure 2026-10-18T10:00:00Z - - - 111 2' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 1'
  assert_sweep_warns_ci_failed 111 "$SHA_A"
}

# A run with an empty pull_requests array names no pull request, so it cannot be tied to this one.
test_a_sweep_ignores_a_successful_run_with_no_pull_requests() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z - - - none'
  assert_sweep_skips 111 "$SHA_A"
}

test_a_sweep_ignores_a_successful_run_from_a_different_pr_number_into_main() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z - - - 999'
  assert_sweep_skips 111 "$SHA_A"
}

# The runs API documents pull_requests as "Pull requests that are open with a head_sha or
# head_branch that matches the workflow run. The returned pull requests do not necessarily indicate
# pull requests that triggered the run." So while PR 999 (same release branch, into old-feature) is
# open, every run at that head lists both PRs, the run PR 999 triggered included. Its success must
# not stand in for the release PR's own CI run, which failed.
test_a_sweep_ignores_another_bases_run_that_lists_the_release_pr_too() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" \
    'CI completed success 2026-10-18T11:00:00Z - - - 999@old-feature,111 2' \
    'CI completed failure 2026-10-18T10:00:00Z - - - 999@old-feature,111 1'
  assert_sweep_skips 111 "$SHA_A"
}

run_tests "$@"
