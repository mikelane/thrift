#!/usr/bin/env bash
# A plugin README that says "needs Claude Code X or newer" must name the build the pinned CI job
# runs, so no plugin claims support for a build CI never checks (issue #146). Changing the pin in
# ci.yml means updating those claims in the same change.
# Usage: min-claude-code.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"

CI_WORKFLOW="$REPO_ROOT/.github/workflows/ci.yml"
MINIMUM_CLAIM='needs Claude Code [0-9][0-9.]* or newer'

pinned_version() {
  grep -o '"channel":"pinned","version":"[0-9][0-9.]*"' "$CI_WORKFLOW" | grep -o '[0-9][0-9.]*"$' | tr -d '"'
}

minimum_claims() {
  grep -H -o -- "$MINIMUM_CLAIM" "$REPO_ROOT"/plugins/*/README.md
}

test_ci_pins_one_claude_code_build() {
  local pinned
  pinned=$(pinned_version)
  [[ "$pinned" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || fail "ci.yml's pinned version is '${pinned:-<unreadable>}', expected MAJOR.MINOR.PATCH"
}

test_a_plugin_readme_states_a_minimum() {
  [[ -n "$(minimum_claims)" ]] || fail "no plugin README says '$MINIMUM_CLAIM'"
}

test_every_stated_minimum_is_the_pinned_build() {
  local stale
  stale=$(minimum_claims | grep -v -F -- "needs Claude Code $(pinned_version) or newer")
  [[ -z "$stale" ]] || fail "minimums that differ from the pinned $(pinned_version): $stale"
}

run_tests "$@"
