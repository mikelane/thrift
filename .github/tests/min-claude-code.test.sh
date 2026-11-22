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
  grep -o '"channel":"pinned","version":"[0-9][0-9.]*"' "$CI_WORKFLOW" \
    | grep -o '[0-9][0-9.]*"$' \
    | tr -d '"'
}

# minimum_claims: one "plugins/<name>/README.md:<claim>" line per claim. Each README is read as one
# line, so a claim that wraps across a line break is still found and still checked against the pin.
minimum_claims() {
  local readme claim
  for readme in "$REPO_ROOT"/plugins/*/README.md; do
    while IFS= read -r claim; do
      printf '%s:%s\n' "${readme#"$REPO_ROOT"/}" "$claim"
    done < <(tr '\n' ' ' < "$readme" | grep -o -- "$MINIMUM_CLAIM")
  done
}

test_ci_pins_one_claude_code_build() {
  local pinned
  pinned=$(pinned_version)
  [[ "$pinned" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || fail "the canary matrix entry {\"channel\":\"pinned\",\"version\":...}" \
      "in .github/workflows/ci.yml gives '${pinned:-<none found>}'," \
      "expected one MAJOR.MINOR.PATCH version"
}

test_a_plugin_readme_states_a_minimum() {
  [[ -n "$(minimum_claims)" ]] \
    || fail "no plugins/*/README.md says 'needs Claude Code X or newer';" \
      "at least one must state the minimum"
}

test_every_stated_minimum_is_the_pinned_build() {
  local pinned stale
  pinned=$(pinned_version)
  stale=$(minimum_claims | grep -v -F -- "needs Claude Code $pinned or newer" | paste -s -d ';' -)
  [[ -z "$stale" ]] \
    || fail "README minimums differ from the pin ${pinned:-<none found>}" \
      "in .github/workflows/ci.yml: $stale." \
      "Change each to 'needs Claude Code $pinned or newer', or move the pin in the same change"
}

run_tests "$@"
