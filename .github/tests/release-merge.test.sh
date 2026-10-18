#!/usr/bin/env bash
# The gate that lets CI merge a release-please PR: the PR must be open, on main, from this repo's
# release-please branch, authored by the release App, at the commit CI tested, and change only the
# files release-please writes. Stub PR JSON and file lists exercise each way the gate says no.
# Usage: release-merge.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"
# shellcheck source=release-merge-lib.sh
source "$HARNESS_DIR/release-merge-lib.sh"

REPO=mikelane/thrift
BOT='thrift-release[bot]'
SHA=0123456789abcdef0123456789abcdef01234567
CONFIG=$REPO_ROOT/release-please-config.json

# write_pr <file> [jq filter]: a release PR that passes the gate, edited by the filter.
write_pr() {
  jq -n --arg repo "$REPO" --arg bot "$BOT" --arg sha "$SHA" '{
    state: "open", base: {ref: "main"},
    head: {ref: "release-please--branches--main--components--handoff", sha: $sha,
           repo: {full_name: $repo}},
    user: {login: $bot}}' | jq "${2:-.}" >"$1"
}

GOOD_FILES='.release-please-manifest.json
plugins/handoff/CHANGELOG.md
plugins/handoff/version.txt
plugins/handoff/.claude-plugin/plugin.json'

# problems <pr-filter> [files]: the gate's output for a PR edited by the filter.
problems() {
  local dir
  dir=$(mktemp -d)
  write_pr "$dir/pr.json" "$1"
  printf '%s\n' "${2:-$GOOD_FILES}" >"$dir/files"
  release_merge_problems "$dir/pr.json" "$dir/files" "$CONFIG" "$REPO" main "$BOT" "$SHA"
  rm -rf "$dir"
}

test_allowlist_names_the_manifest_and_each_packages_changelog_and_extra_files() {
  local got want
  got=$(release_merge_allowlist "$CONFIG")
  want=$GOOD_FILES
  [[ "$got" == "$want" ]] || fail "got [$got]"
}

test_allowlist_follows_a_package_added_to_the_config() {
  local dir got
  dir=$(mktemp -d)
  jq '.packages["plugins/other"] = {"changelog-path": "HISTORY.md", "extra-files": ["a.json", {"path": "b.json"}]}' \
    "$CONFIG" >"$dir/config.json"
  got=$(release_merge_allowlist "$dir/config.json")
  rm -rf "$dir"
  [[ "$got" == *$'\nplugins/other/HISTORY.md\nplugins/other/a.json\nplugins/other/b.json' ]] || fail "got [$got]"
}

test_allowlist_defaults_the_changelog_name_and_allows_no_extra_files() {
  local dir got
  dir=$(mktemp -d)
  echo '{"packages": {"plugins/bare": {}}}' >"$dir/config.json"
  got=$(release_merge_allowlist "$dir/config.json")
  rm -rf "$dir"
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
  [[ "$got" == *'is not a file a release PR changes' ]] || fail "got [$got]"
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
  [[ $(wc -l <<<"$got" | tr -d ' ') == 3 ]] || fail "got [$got]"
}

test_an_unreadable_config_blocks_the_merge() {
  local dir got
  dir=$(mktemp -d)
  write_pr "$dir/pr.json"
  echo 'plugins/handoff/CHANGELOG.md' >"$dir/files"
  got=$(release_merge_problems "$dir/pr.json" "$dir/files" "$dir/missing.json" "$REPO" main "$BOT" "$SHA" 2>/dev/null)
  rm -rf "$dir"
  [[ "$got" == *'cannot read the allowlist'* ]] || fail "got [$got]"
}

# stub_gh <dir>: a `gh` that behaves like the real one when `gh api` gets fields (-f) and no
# --method: it sends a POST, which would try to create a pull request. A GET answers one PR.
stub_gh() {
  mkdir -p "$1"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'method=GET has_field=' \
    'for arg in "$@"; do [[ "$arg" == -f || "$arg" == -F ]] && has_field=1; done' \
    'while (($#)); do case $1 in -X | --method) method=$2 ;; esac; shift; done' \
    '[[ -n "$has_field" && -z "$method_given" && "$method" == GET && "$*" != *--method* ]] || true' \
    'echo "[{\"number\": 42}]"' >"$1/gh"
  chmod +x "$1/gh"
}

test_the_pr_lookup_sends_a_get_request_so_gh_does_not_create_a_pull_request() {
  local dir got
  dir=$(mktemp -d)
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
  rm -rf "$dir"
  [[ "$got" == 42 ]] || fail "got [$got]"
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
  dir=$(mktemp -d)
  changed_files "$1" >"$dir/files"
  write_pr "$dir/pr.json"
  release_merge_problems "$dir/pr.json" "$dir/files" "$CONFIG" "$REPO" main "$BOT" "$SHA"
  rm -rf "$dir"
}

test_a_file_name_with_a_trailing_newline_blocks_the_merge() {
  local got
  got=$(problems_for_names '[{"filename":"plugins/handoff/CHANGELOG.md\n"}]')
  [[ "$got" == *'is not a file a release PR changes' ]] || fail "got [$got]"
}

test_a_file_name_with_a_newline_cannot_pose_as_two_allowed_names() {
  local got
  got=$(problems_for_names '[{"filename":"plugins/handoff/CHANGELOG.md\n.release-please-manifest.json"}]')
  [[ "$got" == *'is not a file a release PR changes' ]] || fail "got [$got]"
}

test_an_ordinary_file_list_from_the_files_api_has_no_problems() {
  local got
  got=$(problems_for_names '[{"filename":".release-please-manifest.json"},{"filename":"plugins/handoff/CHANGELOG.md"}]')
  [[ -z "$got" ]] || fail "got [$got]"
}

run_tests "$@"
