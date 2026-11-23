#!/usr/bin/env bash
# The gate that lets CI merge a release-please PR: the PR must be open, on main, from this repo's
# release-please branch, authored by the release App, at the commit CI tested, and change only the
# files release-please writes. Stub PR JSON and file lists exercise each way the gate says no.
# Usage: release-merge-gate.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"
# shellcheck source=release-merge-stubs-lib.sh
source "$HARNESS_DIR/release-merge-stubs-lib.sh"

GOOD_FILES='.release-please-manifest.json
plugins/handoff/CHANGELOG.md
plugins/handoff/version.txt
plugins/handoff/.claude-plugin/plugin.json'

# gate_problems <pr-filter> [files]: the gate's output for a PR edited by the filter, with the open
# pull requests the stub `gh` serves from pulls.json.
gate_problems() {
  local dir
  dir=$TEST_DIR
  stub_gh
  write_pr "$dir/pr.json" "$1"
  printf '%s\n' "${2:-$GOOD_FILES}" >"$dir/files"
  release_merge_problems "$dir/pr.json" "$dir/files" "$CONFIG" "$REPO" main "$BOT" "$SHA"
}

# problems <pr-filter> [files]: gate_problems when the release PR is the only open PR.
problems() {
  write_pulls "$(open_pr 111 "$SHA")"
  gate_problems "$@"
}

test_allowlist_names_the_manifest_and_each_packages_changelog_and_extra_files() {
  local got want
  got=$(release_merge_allowlist "$CONFIG")
  want=$GOOD_FILES$'\nplugins/meter/CHANGELOG.md\nplugins/meter/version.txt\nplugins/meter/.claude-plugin/plugin.json'$'\nplugins/reread/CHANGELOG.md\nplugins/reread/version.txt\nplugins/reread/.claude-plugin/plugin.json'
  [[ "$got" == "$want" ]] || fail "got [$got]"
}

test_allowlist_follows_a_package_added_to_the_config() {
  local dir got
  dir=$TEST_DIR
  jq '.packages["plugins/other"] = {"changelog-path": "HISTORY.md", "extra-files": ["a.json", {"path": "b.json"}]}' \
    "$CONFIG" >"$dir/config.json"
  got=$(release_merge_allowlist "$dir/config.json")
  [[ "$got" == *$'\nplugins/other/HISTORY.md\nplugins/other/a.json\nplugins/other/b.json' ]] || fail "got [$got]"
}

test_allowlist_defaults_the_changelog_name_and_allows_no_extra_files() {
  local dir got
  dir=$TEST_DIR
  echo '{"packages": {"plugins/bare": {}}}' >"$dir/config.json"
  got=$(release_merge_allowlist "$dir/config.json")
  [[ "$got" == $'.release-please-manifest.json\nplugins/bare/CHANGELOG.md' ]] || fail "got [$got]"
}

test_a_release_pr_that_changes_only_allowed_files_has_no_problems() {
  local got
  got=$(problems .)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_pr_that_changes_only_some_allowed_files_has_no_problems() {
  local got
  got=$(problems . 'plugins/handoff/CHANGELOG.md')
  [[ -z "$got" ]] || fail "got [$got]"
}

test_an_extra_file_blocks_the_merge() {
  local got
  got=$(problems . "$GOOD_FILES"$'\nscripts/check.sh')
  [[ "$got" == 'scripts/check.sh is not a file a release PR changes' ]] || fail "got [$got]"
}

test_another_file_under_a_package_path_blocks_the_merge() {
  local got
  got=$(problems . "$GOOD_FILES"$'\nplugins/handoff/hooks/register.tsx')
  [[ "$got" == 'plugins/handoff/hooks/register.tsx is not a file a release PR changes' ]] || fail "got [$got]"
}

test_a_changelog_outside_a_package_path_blocks_the_merge() {
  local got
  got=$(problems . 'CHANGELOG.md')
  [[ "$got" == 'CHANGELOG.md is not a file a release PR changes' ]] || fail "got [$got]"
}

test_a_path_that_merely_contains_an_allowed_name_blocks_the_merge() {
  local got
  got=$(problems . 'evil/plugins/handoff/CHANGELOG.md')
  [[ "$got" == 'evil/plugins/handoff/CHANGELOG.md is not a file a release PR changes' ]] || fail "got [$got]"
}

test_a_blank_line_in_the_file_list_is_skipped() {
  local got
  got=$(problems . $'plugins/handoff/CHANGELOG.md\n\n.release-please-manifest.json')
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_branch_without_the_release_please_prefix_blocks_the_merge() {
  local got
  got=$(problems '.head.ref = "feature/x"')
  [[ "$got" == 'the PR branch feature/x does not start with release-please--' ]] || fail "got [$got]"
}

test_an_author_other_than_the_release_app_blocks_the_merge() {
  local got
  got=$(problems '.user.login = "mikelane"')
  [[ "$got" == "the PR author is mikelane, not $BOT" ]] || fail "got [$got]"
}

test_a_head_commit_other_than_the_one_ci_tested_blocks_the_merge() {
  local got
  got=$(problems '.head.sha = "ffffffffffffffffffffffffffffffffffffffff"')
  [[ "$got" == "the PR head is ffffffffffffffffffffffffffffffffffffffff but CI tested $SHA" ]] || fail "got [$got]"
}

test_a_fork_head_blocks_the_merge() {
  local got
  got=$(problems '.head.repo.full_name = "someone/thrift"')
  [[ "$got" == "the PR head is in someone/thrift, not $REPO" ]] || fail "got [$got]"
}

test_a_deleted_head_repo_blocks_the_merge() {
  local got
  got=$(problems '.head.repo = null')
  [[ "$got" == "the PR head is in (deleted), not $REPO" ]] || fail "got [$got]"
}

test_a_closed_pr_blocks_the_merge() {
  local got
  got=$(problems '.state = "closed"')
  [[ "$got" == 'the PR is closed, not open' ]] || fail "got [$got]"
}

test_a_pr_that_targets_another_branch_blocks_the_merge() {
  local got
  got=$(problems '.base.ref = "dev"')
  [[ "$got" == 'the PR targets dev, not main' ]] || fail "got [$got]"
}

test_every_problem_is_reported() {
  local got
  got=$(problems '.state = "closed" | .user.login = "x"' 'oops')
  [[ "$got" == "the PR is closed, not open"$'\n'"the PR author is x, not $BOT"$'\n''oops is not a file a release PR changes' ]] \
    || fail "got [$got]"
}

test_an_unreadable_config_fails_the_gate_instead_of_reading_as_a_refusal() {
  local dir got status
  dir=$TEST_DIR
  write_pr "$dir/pr.json"
  echo 'plugins/handoff/CHANGELOG.md' >"$dir/files"
  stub_gh
  write_pulls "$(open_pr 111 "$SHA")"
  got=$(release_merge_problems "$dir/pr.json" "$dir/files" "$dir/missing.json" "$REPO" main "$BOT" "$SHA" 2>"$dir/err")
  status=$?
  [[ "$status" != 0 ]] || fail 'a failed allowlist lookup returned 0, which reads as "no problems" or a refusal'
  [[ -z "$got" ]] || fail "printed a problem [$got], which the caller reads as a refusal"
  assert_file_has "$dir/err" "cannot read the allowlist from $dir/missing.json"
}

test_an_unreadable_changed_files_list_fails_the_gate_instead_of_reading_as_a_refusal() {
  local dir got status
  dir=$TEST_DIR
  write_pr "$dir/pr.json"
  stub_gh
  write_pulls "$(open_pr 111 "$SHA")"
  got=$(release_merge_problems "$dir/pr.json" "$dir/missing-files" "$CONFIG" "$REPO" main "$BOT" "$SHA" 2>"$dir/err")
  status=$?
  [[ "$status" != 0 ]] || fail 'a failed changed-files read returned 0, which reads as "no problems" or a refusal'
  [[ -z "$got" ]] || fail "printed a problem [$got], which the caller reads as a refusal"
  assert_file_has "$dir/err" "cannot read the changed files from $dir/missing-files"
}

# The inline `gh` behaves like the real one when `gh api` gets fields (-f) and no --method: it
# sends a POST, which would try to create a pull request.
test_the_pr_lookup_sends_a_get_request_so_gh_does_not_create_a_pull_request() {
  local dir got
  dir=$TEST_DIR
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'method= has_field=' \
    'for arg in "$@"; do [[ "$arg" == -f || "$arg" == -F ]] && has_field=1; done' \
    'prev=; for arg in "$@"; do [[ "$prev" == -X || "$prev" == --method ]] && method=$arg; prev=$arg; done' \
    '[[ -z "$method" && -n "$has_field" ]] && method=POST' \
    '[[ "${method:-GET}" == GET ]] || { echo "gh would send a $method and create a pull request" >&2; exit 1; }' \
    'echo 42' >"$dir/gh"
  chmod +x "$dir/gh"
  got=$(PATH="$dir:$PATH" release_merge_open_pr_number "$REPO" mikelane release-please--branches--main--components--handoff main 2>&1)
  [[ "$got" == 42 ]] || fail "got [$got]"
}

# The stub `gh` ignores the query, so only this test shows which PR the lookup asks for: one from
# the owner's own branch (head=<owner>:<branch>, never a fork's), into the base, still open.
test_the_pr_lookup_asks_for_the_open_pr_from_the_owners_branch_into_the_base() {
  local dir args_file
  dir=$TEST_DIR
  args_file=$(printf '%q' "$dir/gh-args")
  printf '%s\n' '#!/usr/bin/env bash' "printf '%s\n' \"\$@\" >$args_file" 'echo 42' >"$dir/gh"
  chmod +x "$dir/gh"
  PATH="$dir:$PATH" release_merge_open_pr_number "$REPO" mikelane "$RELEASE_BRANCH" main >/dev/null
  grep -qxF "head=mikelane:$RELEASE_BRANCH" "$dir/gh-args" || fail 'the lookup does not pin head to the owner and branch'
  grep -qxF 'base=main' "$dir/gh-args" || fail 'the lookup does not pin the base'
  grep -qxF 'state=open' "$dir/gh-args" || fail 'the lookup does not ask for open PRs'
}

# changed_files <json>: the names release_merge_changed_files prints for the files API's JSON.
changed_files() { printf '%s' "$1" | release_merge_changed_files; }

test_changed_files_lists_each_name_and_the_old_name_of_a_rename() {
  local got
  got=$(changed_files '[{"filename":"a.md"},{"filename":"b.md","previous_filename":"c.md"}]')
  [[ "$got" == $'a.md\nb.md\nc.md' ]] || fail "got [$got]"
}

test_changed_files_reads_every_page_of_the_files_api() {
  local got
  got=$(changed_files '[{"filename":"a.md"}][{"filename":"b.md"}]')
  [[ "$got" == $'a.md\nb.md' ]] || fail "got [$got]"
}

# problems_for_names <json>: the gate's output for a PR whose files API returned the JSON.
problems_for_names() {
  local dir
  dir=$TEST_DIR
  changed_files "$1" >"$dir/files"
  write_pr "$dir/pr.json"
  stub_gh
  write_pulls "$(open_pr 111 "$SHA")"
  release_merge_problems "$dir/pr.json" "$dir/files" "$CONFIG" "$REPO" main "$BOT" "$SHA"
}

test_a_file_name_with_a_trailing_newline_blocks_the_merge() {
  local got
  got=$(problems_for_names '[{"filename":"plugins/handoff/CHANGELOG.md\n"}]')
  [[ "$got" == '"plugins/handoff/CHANGELOG.md\n" is not a file a release PR changes' ]] || fail "got [$got]"
}

test_a_file_name_with_a_newline_cannot_pose_as_two_allowed_names() {
  local got
  got=$(problems_for_names '[{"filename":"plugins/handoff/CHANGELOG.md\n.release-please-manifest.json"}]')
  [[ "$got" == '"plugins/handoff/CHANGELOG.md\n.release-please-manifest.json" is not a file a release PR changes' ]] \
    || fail "got [$got]"
}

test_an_ordinary_file_list_from_the_files_api_has_no_problems() {
  local got
  got=$(problems_for_names '[{"filename":".release-please-manifest.json"},{"filename":"plugins/handoff/CHANGELOG.md"}]')
  [[ -z "$got" ]] || fail "got [$got]"
}

# A person converts the release PR to a draft to hold the release. The merge API refuses a draft,
# release_merge_lost_race sees an open PR at the tested head and fails, so with the sweep every
# push to main turns the job red until someone undrafts it. The gate should refuse it instead.
test_a_draft_pr_blocks_the_merge() {
  local got
  got=$(problems '.draft = true')
  [[ "$got" == 'the PR is a draft' ]] || fail "got [$got]"
}

test_a_pr_that_is_not_a_draft_has_no_draft_problem() {
  local got
  got=$(problems '.draft = false')
  [[ -z "$got" ]] || fail "got [$got]"
}

# The sibling check: the runs API does not say which PR a run triggered, so a second open PR from
# the release branch makes every run at that head ambiguous.
test_another_open_pr_from_the_release_branch_blocks_the_merge() {
  local got
  write_pulls "$(open_pr 111 "$SHA")" "$(open_pr 999 "$SHA" '.base.ref = "old-feature"')"
  got=$(gate_problems .)
  [[ "$got" == 'another open PR shares the branch release-please--branches--main--components--handoff: #999' ]] \
    || fail "got [$got]"
}

test_an_open_pr_from_another_branch_is_not_a_sibling() {
  local got
  write_pulls "$(open_pr 111 "$SHA")" "$(open_pr 999 "$SHA" '.head.ref = "feature/x"')"
  got=$(gate_problems .)
  [[ -z "$got" ]] || fail "got [$got]"
}

test_a_failed_open_pr_lookup_fails_the_gate_instead_of_reading_as_a_refusal() {
  local got status
  touch "$TEST_DIR/pulls.error"
  got=$(gate_problems . 2>"$TEST_DIR/err")
  status=$?
  [[ "$status" != 0 ]] || fail 'a failed PR list returned 0, which reads as "no problems" or a refusal'
  [[ -z "$got" ]] || fail "printed a problem [$got], which the caller reads as a refusal"
  assert_file_has "$TEST_DIR/err" 'cannot list the open PRs from release-please--branches--main--components--handoff'
}

test_an_open_pr_from_a_forks_branch_of_the_same_name_is_not_a_sibling() {
  local got
  write_pulls "$(open_pr 111 "$SHA")" "$(open_pr 999 "$SHA" '.head.repo.full_name = "someone/thrift"')"
  got=$(gate_problems .)
  [[ -z "$got" ]] || fail "got [$got]"
}

run_tests "$@"
