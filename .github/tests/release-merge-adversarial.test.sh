#!/usr/bin/env bash
# Adversarial QA findings against the release-merge gate (issue #107). Each test names a case where
# the gate disagrees with what release-please writes, or with the PR the workflow should merge.
# Usage: release-merge-adversarial.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"
# shellcheck source=release-merge-lib.sh
source "$HARNESS_DIR/release-merge-lib.sh"

REPO=mikelane/thrift
BRANCH=release-please--branches--main--components--handoff

# allowlist_for <config-json>: the allowlist the gate derives from that config.
allowlist_for() {
  local dir got
  dir=$(mktemp -d)
  printf '%s\n' "$1" >"$dir/config.json"
  got=$(release_merge_allowlist "$dir/config.json")
  rm -rf "$dir"
  printf '%s' "$got"
}

# release-please's addPath writes a root package's files at the repository root, with no "./".
test_allowlist_names_a_root_package_changelog_the_way_release_please_writes_it() {
  local got
  got=$(allowlist_for '{"packages": {".": {}}}')
  [[ "$got" == $'.release-please-manifest.json\nCHANGELOG.md' ]] || fail "got [$got]"
}

# release-please's addPath treats an extra-files path with a leading slash as relative to the root.
test_allowlist_names_a_root_relative_extra_file_the_way_release_please_writes_it() {
  local got
  got=$(allowlist_for '{"packages": {"plugins/handoff": {"extra-files": ["/VERSION"]}}}')
  [[ "$got" == *$'\nVERSION' ]] || fail "got [$got]"
}

# release-please's mergeReleaserConfig applies a top-level changelog-path to every package.
test_allowlist_honors_a_top_level_changelog_path() {
  local got
  got=$(allowlist_for '{"changelog-path": "HISTORY.md", "packages": {"plugins/handoff": {}}}')
  [[ "$got" == $'.release-please-manifest.json\nplugins/handoff/HISTORY.md' ]] || fail "got [$got]"
}

# stub_pulls_api <dir>: a `gh` that answers GET repos/<repo>/pulls the way the API does, filtering
# two open PRs from the release branch by the head and base query fields it is given. The newer
# PR (#7, listed first as the API sorts by created desc) targets another branch; #5 targets main.
stub_pulls_api() {
  mkdir -p "$1"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'head= base= filter=.' \
    'while (($#)); do' \
    '  case $1 in' \
    '    -f) case $2 in head=*) head=${2#head=} ;; base=*) base=${2#base=} ;; esac; shift ;;' \
    '    --jq) filter=$2; shift ;;' \
    '  esac' \
    '  shift' \
    'done' \
    "jq -n --arg head \"\$head\" --arg base \"\$base\" '[" \
    "  {number: 7, head: {label: \"mikelane:$BRANCH\"}, base: {ref: \"sandbox\"}}," \
    "  {number: 5, head: {label: \"mikelane:$BRANCH\"}, base: {ref: \"main\"}}" \
    "] | map(select(.head.label == \$head and (\$base == \"\" or .base.ref == \$base)))' | jq -r \"\$filter\"" \
    >"$1/gh"
  chmod +x "$1/gh"
}

# With two open PRs from the release branch, the lookup must find the one that targets main.
# Taking .[0] of an unfiltered list finds #7, the gate refuses it, and the release PR never merges.
test_the_pr_lookup_finds_the_release_pr_that_targets_main_when_another_pr_shares_its_branch() {
  local dir got
  dir=$(mktemp -d)
  stub_pulls_api "$dir"
  got=$(PATH="$dir:$PATH" release_merge_open_pr_number "$REPO" mikelane "$BRANCH" main 2>&1)
  rm -rf "$dir"
  [[ "$got" == 5 ]] || fail "got [$got]"
}

# An extra-files object with no path has nothing to change, so it must not allow "<pkg>/null".
test_allowlist_skips_an_extra_file_object_without_a_path() {
  local got
  got=$(allowlist_for '{"packages": {"plugins/handoff": {"extra-files": [{"type": "json"}, "a.json"]}}}')
  [[ "$got" == $'.release-please-manifest.json\nplugins/handoff/CHANGELOG.md\nplugins/handoff/a.json' ]] || fail "got [$got]"
}

# A per-package key replaces the top-level one, as in release-please's mergeReleaserConfig.
test_allowlist_lets_a_package_override_the_top_level_extra_files_and_version_file() {
  local got
  got=$(allowlist_for '{"extra-files": ["top.json"], "version-file": "top.txt", "packages": {"p/a": {}, "p/b": {"extra-files": ["b.json"], "version-file": "b.txt"}}}')
  [[ "$got" == $'.release-please-manifest.json\np/a/CHANGELOG.md\np/a/top.txt\np/a/top.json\np/b/CHANGELOG.md\np/b/b.txt\np/b/b.json' ]] || fail "got [$got]"
}

run_tests "$@"
