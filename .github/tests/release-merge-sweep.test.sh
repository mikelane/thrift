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

# assert_sweep_warns_ci_failed <number> <sha> [conclusion]: the sweep selects nothing, exits 0, and
# reports a CI run at <sha> that concluded <conclusion> (default failure) as a warning annotation
# rather than as an ordinary skip.
assert_sweep_warns_ci_failed() {
  local got status
  got=$(sweep 2>"$TEST_DIR/sweep-err")
  status=$?
  [[ -z "$got" ]] || fail "selected [$got]"
  [[ "$status" == 0 ]] || fail "the sweep exited $status"
  assert_file_has "$TEST_DIR/sweep-err" \
    "::warning title=Release PR #$1 not merged::CI concluded ${3:-failure} at $2"
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
  [[ "$got" == "111 $SHA_A 1001" ]] || fail "got [$got]"
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
  assert_file_has "$TEST_DIR/sweep-err" "no CI run at that head whose pr-record names it"
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
  [[ "$got" == "111 $SHA_A 1002" ]] || fail "got [$got]"
}

test_a_sweep_ignores_runs_of_other_workflows() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z' 'Lint completed failure 2026-10-18T11:00:00Z .github/workflows/lint.yml'
  got=$(sweep)
  [[ "$got" == "111 $SHA_A 1001" ]] || fail "got [$got]"
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
  [[ "$got" == "111 $SHA_A 1001" ]] || fail "got [$got]"
  assert_file_has "$TEST_DIR/sweep-err" \
    "::warning title=Release PR #112 not merged::CI concluded failure at $SHA_B"
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
  assert_file_has "$TEST_DIR/sweep-err" "::error title=Release PR #111 not merged::cannot read the CI runs at $SHA_A"
}

test_a_sweep_fails_when_the_pull_request_list_fails() {
  : >"$TEST_DIR/pulls.error"
  sweep_fails || fail 'a failed pull request list was read as "no open release PR"'
}

test_a_sweep_names_the_pull_request_list_when_that_is_the_lookup_that_failed() {
  : >"$TEST_DIR/pulls.error"
  sweep_fails || fail 'a failed pull request list was read as "no open release PR"'
  assert_file_has "$TEST_DIR/sweep-err" "::error title=Release PR sweep failed::cannot list the open release PRs"
}

test_a_sweep_does_not_blame_the_pull_request_list_when_a_ci_lookup_failed() {
  write_pulls "$(open_pr 111 $SHA_A)"
  : >"$TEST_DIR/runs-$SHA_A.error"
  sweep_fails || fail 'a failed CI run lookup was read as "no CI run"'
  assert_file_lacks "$TEST_DIR/sweep-err" "cannot list the open release PRs"
}

test_a_sweep_warning_names_the_conclusion_of_a_cancelled_run() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed cancelled 2026-10-18T10:00:00Z'
  assert_sweep_warns_ci_failed 111 "$SHA_A" cancelled
}

test_a_sweep_warning_escapes_a_percent_sign_in_the_conclusion() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed 50%0A 2026-10-18T10:00:00Z'
  assert_sweep_warns_ci_failed 111 "$SHA_A" '50%250A'
}

test_a_sweep_still_selects_a_pr_when_a_later_pr_lookup_fails() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)" "$(open_pr 112 $SHA_B)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z'
  : >"$TEST_DIR/runs-$SHA_B.error"
  got=$(sweep 2>/dev/null)
  [[ "$got" == "111 $SHA_A 1001" ]] || fail "got [$got]"
}

test_a_sweep_fails_when_a_later_pr_lookup_fails_even_after_selecting_one() {
  write_pulls "$(open_pr 111 $SHA_A)" "$(open_pr 112 $SHA_B)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z'
  : >"$TEST_DIR/runs-$SHA_B.error"
  sweep_fails || fail 'a failed CI run lookup after a selected PR left the sweep green'
  assert_file_has "$TEST_DIR/sweep-err" "::error title=Release PR #112 not merged::cannot read the CI runs at $SHA_B"
}

test_a_sweep_fails_when_the_ci_runs_response_is_not_json() {
  write_pulls "$(open_pr 111 $SHA_A)"
  echo 'not json' >"$TEST_DIR/runs-$SHA_A.json"
  sweep_fails || fail 'an unreadable CI runs response was read as "no CI run"'
  assert_file_has "$TEST_DIR/sweep-err" "::error title=Release PR #111 not merged::cannot read the CI runs at $SHA_A"
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
  [[ "$got" == "111 $SHA_A 1002" ]] || fail "got [$got]"
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

test_a_sweep_ignores_a_successful_run_whose_record_names_a_different_pr_into_main() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z - - - 999'
  assert_sweep_skips 111 "$SHA_A"
}

# The runs API documents pull_requests as "Pull requests that are open with a head_sha or
# head_branch that matches the workflow run. The returned pull requests do not necessarily indicate
# pull requests that triggered the run." So while PR 999 (same release branch, into old-feature) is
# open, every run at that head lists both PRs, the run PR 999 triggered included. The lib reads only
# each run's pr-record: PR 999's run records 999, so its success must not stand in for the release
# PR's own CI run, whose record names 111 and which failed.
test_a_sweep_ignores_another_bases_run_whose_record_names_another_pr() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" \
    'CI completed success 2026-10-18T11:00:00Z - - - 999@old-feature,111 2 999@old-feature' \
    'CI completed failure 2026-10-18T10:00:00Z - - - 999@old-feature,111 1 111'
  assert_sweep_warns_ci_failed 111 "$SHA_A"
}

# issue #117, the closed decoy: PR 999 (this release branch into a base whose ci.yml has no branch
# filter) was closed, so its run's pull_requests lists only the release PR into main. The run's own
# pr-record still names 999, so its success must not stand in for the release PR's failed CI run.
test_a_sweep_ignores_a_successful_run_of_a_closed_pr_into_another_base() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" \
    'CI completed success 2026-10-18T11:00:00Z - - - 111 2 999@old-feature' \
    'CI completed failure 2026-10-18T10:00:00Z - - - 111 1'
  assert_sweep_warns_ci_failed 111 "$SHA_A"
}

test_a_sweep_ignores_a_successful_run_whose_record_names_this_pr_into_another_base() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z - - - 111 1 111@old-feature'
  assert_sweep_skips 111 "$SHA_A"
}

test_a_sweep_ignores_a_successful_run_with_no_record_and_says_why() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z - - - 111 1 none'
  assert_sweep_skips 111 "$SHA_A"
  assert_file_has "$TEST_DIR/sweep-err" "run 1 has no pr-record artifact"
}

test_a_sweep_ignores_a_successful_run_with_an_unreadable_record_and_says_why() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z - - - 111 1 corrupt'
  assert_sweep_skips 111 "$SHA_A"
  assert_file_has "$TEST_DIR/sweep-err" "run 1 has an unreadable pr-record"
}

# The record naming another PR is the decoy of issue #117, so the sweep says so in an annotation that
# names the run and the record; a run with no record or an unreadable one stays on stderr only.
test_a_sweep_warns_with_an_annotation_naming_the_run_and_the_record_of_a_decoy_run() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z - - - 111 1 999@old-feature'
  sweep >/dev/null 2>"$TEST_DIR/sweep-err"
  assert_file_has "$TEST_DIR/sweep-err" \
    '::warning title=Release PR #111 skipped a CI run for another PR::run 1 has a pr-record naming {"number":999,"base":"old-feature"}'
}

test_a_sweep_warns_about_a_decoy_run_even_when_an_older_run_is_selected() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" \
    'CI completed success 2026-10-18T11:00:00Z - - - 111 2 999@old-feature' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 1'
  sweep >"$TEST_DIR/sweep-out" 2>"$TEST_DIR/sweep-err"
  assert_file_has "$TEST_DIR/sweep-out" "111 $SHA_A 1"
  assert_file_has "$TEST_DIR/sweep-err" "::warning title=Release PR #111 skipped a CI run for another PR::run 2 has"
}

test_a_sweep_escapes_a_percent_sign_in_the_decoy_annotation() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z - - - 111 1 999@50%0A'
  sweep >/dev/null 2>"$TEST_DIR/sweep-err"
  assert_file_has "$TEST_DIR/sweep-err" '"base":"50%250A"}'
}

test_a_sweep_gives_no_annotation_for_a_run_with_no_record_or_an_unreadable_one() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" \
    'CI completed success 2026-10-18T11:00:00Z - - - 111 2 corrupt' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 1 none'
  sweep >/dev/null 2>"$TEST_DIR/sweep-err"
  assert_file_lacks "$TEST_DIR/sweep-err" "::warning"
}

test_a_sweep_says_what_a_mismatched_record_names() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z - - - 111 1 999@old-feature'
  assert_sweep_skips 111 "$SHA_A"
  assert_file_has "$TEST_DIR/sweep-err" 'run 1 has a pr-record naming {"number":999,"base":"old-feature"}'
}

# The record, not pull_requests, ties a run to the PR: a run listing no PR at all still counts.
test_a_sweep_counts_a_successful_run_whose_record_names_the_pr_even_when_pull_requests_is_empty() {
  local got
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z - - - none 1 111'
  got=$(sweep)
  [[ "$got" == "111 $SHA_A 1" ]] || fail "got [$got]"
}

test_the_ci_lookup_skips_a_newer_successful_run_without_a_record_and_counts_the_older_one_that_has_one() {
  write_runs "$SHA_A" \
    'CI completed success 2026-10-18T11:00:00Z - - - 111 2 none' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 1'
  [[ "$(ci_status)" == 0 ]] || fail "got $(ci_status)"
}

# A finished run with no record that did not succeed may be this PR's failed run, so an older
# success must not stand in for it (fail closed). Such a decoy holds the PR for a person.
test_the_ci_lookup_returns_4_when_a_newer_failed_run_has_no_record_ahead_of_an_older_success() {
  write_runs "$SHA_A" \
    'CI completed failure 2026-10-18T11:00:00Z - - - 111 2 none' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 1'
  [[ "$(ci_status)" == 4 ]] || fail "got $(ci_status)"
}

test_the_ci_lookup_returns_4_when_a_newer_cancelled_run_has_no_record_ahead_of_an_older_success() {
  write_runs "$SHA_A" \
    'CI completed cancelled 2026-10-18T11:00:00Z - - - 111 2 none' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 1'
  [[ "$(ci_status)" == 4 ]] || fail "got $(ci_status)"
}

test_a_sweep_warns_with_the_conclusion_of_a_newer_failed_run_that_has_no_record() {
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" \
    'CI completed failure 2026-10-18T11:00:00Z - - - 111 2 none' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 1'
  assert_sweep_warns_ci_failed 111 "$SHA_A"
}

# A running run uploads its record partway through, so a newer run with none yet may still be this
# PR's: the lookup waits for it instead of counting an older success.
test_the_ci_lookup_returns_3_when_a_newer_run_is_still_running_with_no_record_yet() {
  write_runs "$SHA_A" \
    'CI in_progress null 2026-10-18T11:00:00Z - - - 111 2 none' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 1'
  [[ "$(ci_status)" == 3 ]] || fail "got $(ci_status)"
}

# A running run whose record names another PR is not this PR's, so it does not hold the PR back.
test_the_ci_lookup_skips_a_newer_running_run_whose_record_names_another_pr() {
  write_runs "$SHA_A" \
    'CI in_progress null 2026-10-18T11:00:00Z - - - 111 2 999@old-feature' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 1'
  [[ "$(ci_status)" == 0 ]] || fail "got $(ci_status)"
}

# A run whose record cannot be read may be this PR's own (a zip cut short by the network downloads
# fine), so it is treated like a run with no record: a running one holds the PR, a finished one that
# did not succeed stops the walk. Only a record that names another PR is skipped.
test_the_ci_lookup_returns_4_when_a_newer_failed_run_has_an_unreadable_record_ahead_of_an_older_success() {
  write_runs "$SHA_A" \
    'CI completed failure 2026-10-18T11:00:00Z - - - 111 2 corrupt' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 1'
  [[ "$(ci_status)" == 4 ]] || fail "got $(ci_status)"
}

test_the_ci_lookup_returns_3_when_a_newer_running_run_has_an_unreadable_record_ahead_of_an_older_success() {
  write_runs "$SHA_A" \
    'CI in_progress null 2026-10-18T11:00:00Z - - - 111 2 corrupt' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 1'
  [[ "$(ci_status)" == 3 ]] || fail "got $(ci_status)"
}

test_the_ci_lookup_returns_2_when_the_artifact_list_cannot_be_read() {
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z - - - 111 1'
  : >"$TEST_DIR/artifacts-1.error"
  [[ "$(ci_status)" == 2 ]] || fail "got $(ci_status)"
}

test_the_ci_lookup_returns_2_when_the_record_cannot_be_downloaded() {
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z - - - 111 1'
  : >"$TEST_DIR/record-5001.error"
  [[ "$(ci_status)" == 2 ]] || fail "got $(ci_status)"
}

test_a_sweep_fails_and_names_the_pr_when_a_record_cannot_be_read() {
  local status
  write_pulls "$(open_pr 111 $SHA_A)"
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z - - - 111 1'
  : >"$TEST_DIR/artifacts-1.error"
  sweep >"$TEST_DIR/sweep-out" 2>"$TEST_DIR/sweep-err"
  status=$?
  [[ "$status" != 0 ]] || fail "the sweep succeeded"
  assert_file_has "$TEST_DIR/sweep-err" "::error title=Release PR #111 not merged::cannot read the CI runs at $SHA_A (cannot list the artifacts of CI run 1)"
}

test_the_ci_lookup_lists_a_runs_artifacts_with_the_runs_token_not_the_app_token() {
  local got
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z - - - 111 1'
  GH_TOKEN=app-token RUNS_TOKEN=runs-tok ci_status >/dev/null
  got=$(<"$TEST_DIR/artifacts-token")
  [[ "$got" == runs-tok ]] || fail "got [$got]"
}

test_the_ci_lookup_downloads_the_record_with_the_runs_token_not_the_app_token() {
  local got
  write_runs "$SHA_A" 'CI completed success 2026-10-18T10:00:00Z - - - 111 1'
  GH_TOKEN=app-token RUNS_TOKEN=runs-tok ci_status >/dev/null
  got=$(<"$TEST_DIR/zip-token")
  [[ "$got" == runs-tok ]] || fail "got [$got]"
}

# A lookup that fails on the newest run must not fall through to an older run that would count.
test_the_ci_lookup_returns_2_when_the_newest_runs_record_lookup_fails_ahead_of_an_older_good_run() {
  write_runs "$SHA_A" \
    'CI completed success 2026-10-18T11:00:00Z - - - 111 2' \
    'CI completed success 2026-10-18T10:00:00Z - - - 111 1'
  : >"$TEST_DIR/artifacts-2.error"
  [[ "$(ci_status)" == 2 ]] || fail "got $(ci_status)"
}

# record_check <run-id>: "<code> <reason>" from release_merge_run_record_verdict for PR 111 into
# main, run with pipefail as the workflow step runs it. The reason is read in the same shell.
record_check() {
  stub_gh
  (
    set -o pipefail
    release_merge_run_record_verdict "$REPO" "$1" 111 main && code=0 || code=$?
    echo "$code $release_merge_run_record_detail"
  )
}

# assert_record_check <run-id> <expected "<code> <reason>">
assert_record_check() {
  local got
  got=$(record_check "$1" 2>"$TEST_DIR/record-err")
  [[ "$got" == "$2" ]] || fail "got [$got], expected [$2]"
}

test_the_record_check_returns_0_when_the_record_names_the_pr_into_main() {
  write_record 7 111
  assert_record_check 7 '0 '
}

test_the_record_check_returns_1_with_no_run_id() {
  assert_record_check '' '1 is unknown (no run id)'
}

test_the_record_check_returns_3_when_the_run_has_no_artifacts() {
  write_record 7 none
  assert_record_check 7 '3 has no pr-record artifact'
}

# The zip would name the PR, so only the expired flag keeps the artifact from counting.
test_the_record_check_returns_3_when_the_only_pr_record_has_expired() {
  write_record 7 111
  write_artifact_pages 7 "{\"artifacts\":[$(artifact_entry 5007 pr-record true)]}"
  assert_record_check 7 '3 has no pr-record artifact'
}

# The expired artifact has the higher id and names another PR: reading it would refuse the PR.
test_the_record_check_returns_0_from_the_unexpired_record_when_a_newer_one_has_expired() {
  write_record 7 111
  write_raw_record 5008 '{"number":999,"base":"main"}'
  write_artifact_pages 7 "{\"artifacts\":[$(artifact_entry 5007),$(artifact_entry 5008 pr-record true)]}"
  assert_record_check 7 '0 '
}

# Listed highest id first, so taking the last entry as listed would read the other PR's record.
test_the_record_check_returns_0_from_the_highest_id_of_two_unexpired_records() {
  write_record 7 111
  write_raw_record 5006 '{"number":999,"base":"main"}'
  write_artifact_pages 7 "{\"artifacts\":[$(artifact_entry 5007),$(artifact_entry 5006)]}"
  assert_record_check 7 '0 '
}

# The zip would name the PR, so only the name check keeps the artifact from counting.
test_the_record_check_returns_3_when_the_only_artifact_has_another_name() {
  write_record 7 111
  write_artifact_pages 7 "{\"artifacts\":[$(artifact_entry 5007 coverage)]}"
  assert_record_check 7 '3 has no pr-record artifact'
}

# `gh api --paginate` prints one JSON object per page; the record is only on page 2.
test_the_record_check_returns_0_when_the_record_is_on_the_second_page_of_artifacts() {
  write_record 7 111
  write_artifact_pages 7 \
    "{\"total_count\":2,\"artifacts\":[$(artifact_entry 5006 coverage)]}" \
    "{\"total_count\":2,\"artifacts\":[$(artifact_entry 5007)]}"
  assert_record_check 7 '0 '
}

test_the_record_check_returns_2_when_the_artifact_list_is_not_json() {
  write_artifact_pages 7 'not json'
  assert_record_check 7 '2 cannot list the artifacts of CI run 7'
}

test_the_record_check_returns_2_when_the_artifact_list_cannot_be_fetched() {
  write_record 7 111
  : >"$TEST_DIR/artifacts-7.error"
  assert_record_check 7 '2 cannot list the artifacts of CI run 7'
}

test_the_record_check_returns_2_when_the_record_cannot_be_downloaded() {
  write_record 7 111
  : >"$TEST_DIR/record-5007.error"
  assert_record_check 7 '2 cannot download the pr-record (artifact 5007) of CI run 7'
}

# An empty PATH also hides gh and jq, so the message is what shows the unzip check fired.
test_the_record_check_returns_2_and_names_unzip_when_unzip_is_missing() {
  local got
  write_record 7 111
  mkdir "$TEST_DIR/empty-path"
  # shellcheck disable=SC2123 # an empty PATH is the point: unzip must not be found
  got=$(stub_gh; PATH=$TEST_DIR/empty-path
    release_merge_run_record_verdict "$REPO" 7 111 main 2>"$TEST_DIR/record-err" && echo 0 || echo $?)
  [[ "$got" == 2 ]] || fail "got [$got]"
  assert_file_has "$TEST_DIR/record-err" "unzip is not installed, so the pr-record of CI run 7 cannot be read"
}

# record_check_mktemp_template <work_dir>: the template the record check passes to mktemp ("" leaves
# work_dir unset).
record_check_mktemp_template() {
  write_record 7 111
  mkdir -p "$TEST_DIR/work"
  (
    stub_gh
    mktemp() { echo "$1" >"$TEST_DIR/mktemp-template"; command mktemp "$@"; }
    if [[ -n "$1" ]]; then work_dir=$1; else unset work_dir; fi
    TMPDIR=$TEST_DIR/tmpdir
    release_merge_run_record_verdict "$REPO" 7 111 main
  ) >/dev/null 2>&1
  echo "$(<"$TEST_DIR/mktemp-template")"
}

test_the_record_check_makes_its_zip_temp_file_under_work_dir_when_it_is_set() {
  local got
  got=$(record_check_mktemp_template "$TEST_DIR/work")
  [[ "$got" == "$TEST_DIR/work/pr-record."* ]] || fail "got [$got]"
}

test_the_record_check_makes_its_zip_temp_file_under_tmpdir_when_work_dir_is_unset() {
  local got
  mkdir -p "$TEST_DIR/tmpdir"
  got=$(record_check_mktemp_template '')
  [[ "$got" == "$TEST_DIR/tmpdir/pr-record."* ]] || fail "got [$got]"
}

test_the_record_check_returns_1_when_the_zip_holds_no_pr_record_json() {
  write_record 7 111
  write_raw_record 5007 '{"number":111,"base":"main"}' other.json
  assert_record_check 7 '1 has an unreadable pr-record'
}

test_the_record_check_returns_1_when_the_record_is_empty() {
  write_record 7 111
  write_raw_record 5007 ''
  assert_record_check 7 '1 has an unreadable pr-record'
}

test_the_record_check_returns_1_when_the_record_number_is_a_string() {
  write_record 7 111
  write_raw_record 5007 '{"number":"111","base":"main"}'
  assert_record_check 7 '1 has an unreadable pr-record'
}

test_the_record_check_returns_1_when_the_record_has_no_base() {
  write_record 7 111
  write_raw_record 5007 '{"number":111}'
  assert_record_check 7 '1 has an unreadable pr-record'
}

test_the_record_check_returns_1_when_the_record_is_not_an_object() {
  write_record 7 111
  write_raw_record 5007 '[111,"main"]'
  assert_record_check 7 '1 has an unreadable pr-record'
}

test_the_record_check_returns_1_when_the_record_is_not_json() {
  write_record 7 111
  write_raw_record 5007 '{"number":111,"base":"main"} trailing'
  assert_record_check 7 '1 has an unreadable pr-record'
}

# jq reads every document, so a record holding the right one and a second would pass as either.
test_the_record_check_returns_1_when_the_record_holds_two_documents() {
  write_record 7 111
  write_raw_record 5007 '{"number":999,"base":"main"}{"number":111,"base":"main"}'
  assert_record_check 7 '1 has an unreadable pr-record'
}

# Only the first 4096 bytes are read, so a longer record is cut mid-string and does not parse.
test_the_record_check_returns_1_when_the_record_is_longer_than_4096_bytes() {
  local padding
  padding=$(printf '%5000s' '' | tr ' ' x)
  write_record 7 111
  write_raw_record 5007 "{\"number\":111,\"base\":\"main\",\"pad\":\"$padding\"}"
  assert_record_check 7 '1 has an unreadable pr-record'
}

# spaces <n>: n spaces.
spaces() { printf "%${1}s" ''; }

# Cutting the record at 4096 bytes is not the same as refusing it: when the cut lands after a
# complete document, what is left would parse.
test_the_record_check_returns_1_when_a_record_longer_than_4096_bytes_ends_in_garbage() {
  write_record 7 111
  write_raw_record 5007 "{\"number\":111,\"base\":\"main\"}$(spaces 4100)garbage"
  assert_record_check 7 '1 has an unreadable pr-record'
}

test_the_record_check_returns_1_when_a_second_document_starts_past_byte_4096() {
  write_record 7 111
  write_raw_record 5007 "{\"number\":111,\"base\":\"main\"}$(spaces 4100){\"number\":999,\"base\":\"main\"}"
  assert_record_check 7 '1 has an unreadable pr-record'
}

test_the_record_check_returns_1_and_names_the_record_when_it_names_another_base() {
  write_record 7 111@old-feature
  assert_record_check 7 '1 has a pr-record naming {"number":111,"base":"old-feature"}'
}

test_the_record_check_returns_1_and_names_the_record_when_it_names_another_pr() {
  write_record 7 999
  assert_record_check 7 '1 has a pr-record naming {"number":999,"base":"main"}'
}

# gh exits 0 but the open-PR list is not JSON: the sweep names the failed lookup and fails.
test_a_sweep_names_an_unparseable_pr_list_as_the_failed_lookup() {
  local status
  stub_gh
  echo 'not json' >"$TEST_DIR/pulls.json"
  release_merge_sweep "$REPO" main >"$TEST_DIR/sweep-out" 2>"$TEST_DIR/sweep-err"
  status=$?
  [[ "$status" != 0 ]] || fail 'the sweep succeeded on an unparseable PR list'
  assert_file_has "$TEST_DIR/sweep-err" '::error title=Release PR sweep failed::cannot list the open release PRs'
}

# write_padded_record <artifact> <pad-byte-hex> <total-bytes>: a pr-record.json holding a record that
# names PR 111 into main, padded with the byte <pad-byte-hex> to <total-bytes> bytes.
write_padded_record() {
  python3 -I -c '
import sys, zipfile
doc = b"{\"number\":111,\"base\":\"main\"}"
pad = bytes([int(sys.argv[2], 16)]) * (int(sys.argv[3]) - len(doc))
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.writestr("pr-record.json", doc + pad)
' "$TEST_DIR/record-$1.zip" "$2" "$3"
}

test_the_record_check_returns_0_for_a_record_of_exactly_4096_bytes() {
  write_record 7 111
  write_padded_record 5007 20 4096
  assert_record_check 7 '0 '
}

test_the_record_check_returns_0_for_a_record_of_4096_bytes_ending_in_a_newline() {
  write_record 7 111
  write_padded_record 5007 0a 4096
  assert_record_check 7 '0 '
}

test_the_record_check_returns_1_for_a_record_of_4097_bytes() {
  write_record 7 111
  write_padded_record 5007 20 4097
  assert_record_check 7 '1 has an unreadable pr-record'
}

test_the_record_check_returns_1_for_a_record_of_4097_newlines() {
  write_record 7 111
  write_padded_record 5007 0a 4097
  assert_record_check 7 '1 has an unreadable pr-record'
}

# Command substitution drops NUL bytes, so a record padded with NULs past 4096 bytes is measured
# after they are gone.
test_the_record_check_returns_1_for_a_record_padded_with_nul_bytes_past_4096() {
  write_record 7 111
  write_padded_record 5007 00 5000
  assert_record_check 7 '1 has an unreadable pr-record'
}

run_tests "$@"
