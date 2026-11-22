#!/usr/bin/env bash
# A plugin README that says "needs Claude Code X or newer" must name the build the pinned CI job
# runs, so no plugin claims support for a build CI never checks (issue #146). Changing the pin in
# ci.yml means updating those claims in the same change.
#
# Known limits: only the phrase "needs Claude Code <digits and dots> or newer" counts, in that
# case, so "requires", "Needs", "v2.1.330", "**2.1.330**" and "2.1.330+" go unseen. Only
# plugins/*/README.md is read. A claim may wrap across lines, also inside a "> " blockquote
# (nested "> > " too) or in a CRLF file.
# The "states a minimum" test needs one claim across all READMEs, not one per plugin.
# Usage: min-claude-code.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"

MINIMUM_CLAIM_PATTERN='needs Claude Code [0-9][0-9.]* or newer'
PIN_HOME='the "channel":"pinned" matrix entry in .github/workflows/ci.yml'

# pinned_version [workflow]: the version of the matrix's pinned entry, empty when there is none.
pinned_version() {
  grep -o '"channel":"pinned","version":"[0-9][0-9.]*"' "${1:-$CI_YML}" \
    | grep -o '[0-9][0-9.]*"$' \
    | tr -d '"'
}

# is_one_build <version>: true for exactly one MAJOR.MINOR.PATCH, so an empty or doubled pin fails.
is_one_build() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; }

# minimum_claims [readme ...]: one "path:needs Claude Code X or newer" line per claim. A path under
# $REPO_ROOT prints repo-relative (plugins/<name>/README.md); any other path, such as a fixture in
# $TEST_DIR, prints as given. Each file is read as one line, with every leading blockquote marker
# dropped and whitespace runs (CR included) made one space, so a claim that a reflowed paragraph
# wrapped still matches. BSD
# awk has no ENDFILE, so the previous file is flushed when the next one starts.
minimum_claims() {
  [[ $# -gt 0 ]] || set -- "$REPO_ROOT"/plugins/*/README.md
  local claim_line
  while IFS= read -r claim_line; do
    printf '%s\n' "${claim_line#"$REPO_ROOT"/}"
  done < <(awk -v claim="$MINIMUM_CLAIM_PATTERN" '
    function flush(  rest) {
      gsub(/[ \t\r]+/, " ", text)
      rest = text
      while (match(rest, claim)) {
        print file ":" substr(rest, RSTART, RLENGTH)
        rest = substr(rest, RSTART + RLENGTH)
      }
    }
    FNR == 1 && NR > 1 { flush() }
    FNR == 1 { file = FILENAME; text = "" }
    { line = $0; sub(/^[ \t]*(>[ \t]?)+/, "", line); text = text " " line }
    END { if (NR > 0) flush() }
  ' "$@")
}

# stale_minimums <pin> [readme ...]: the claims that name a build other than the pin.
stale_minimums() {
  local pin="$1"
  shift
  minimum_claims "$@" | grep -v -F -- "needs Claude Code $pin or newer"
}

test_ci_pins_a_major_minor_patch_claude_code_build() {
  local pinned
  pinned=$(pinned_version)
  is_one_build "$pinned" \
    || fail "$PIN_HOME gives '${pinned:-<none found>}'," \
      "expected one MAJOR.MINOR.PATCH version"
}

test_at_least_one_plugin_readme_states_a_minimum() {
  [[ -n "$(minimum_claims)" ]] \
    || fail "no plugins/*/README.md says 'needs Claude Code X or newer';" \
      "at least one must state the minimum"
}

test_every_stated_minimum_is_the_pinned_build() {
  local pinned stale
  pinned=$(pinned_version)
  stale=$(stale_minimums "$pinned" | paste -s -d ';' -)
  [[ -z "$stale" ]] \
    || fail "README minimums differ from the pin ${pinned:-<none found>} ($PIN_HOME): $stale." \
      "Change each to 'needs Claude Code $pinned or newer', or move the pin in the same change"
}

# The fixture tests below prove the helpers the three checks above rely on. Their READMEs live in
# $TEST_DIR, outside $REPO_ROOT, so the expected paths are absolute.

test_a_reformatted_pin_reads_as_no_pin() {
  printf '%s\n' "include: '[{\"channel\": \"pinned\", \"version\": \"2.1.330\"}]'" \
    > "$TEST_DIR/ci.yml"
  local pinned
  pinned=$(pinned_version "$TEST_DIR/ci.yml")
  [[ -z "$pinned" ]] \
    || fail "a pin with spaces after the colons read as '$pinned', expected nothing"
  ! is_one_build "$pinned" || fail "an unreadable pin passed as one build"
}

test_two_pinned_entries_are_not_one_build() {
  printf '%s\n' \
    '[{"channel":"pinned","version":"2.1.330"},{"channel":"pinned","version":"2.1.331"}]' \
    > "$TEST_DIR/ci.yml"
  local pinned
  pinned=$(pinned_version "$TEST_DIR/ci.yml")
  [[ "$pinned" == $'2.1.330\n2.1.331' ]] \
    || fail "two pins read as '$pinned', expected both versions on two lines"
  ! is_one_build "$pinned" || fail "two pins passed as one build"
}

test_a_stale_minimum_wrapped_across_two_lines_is_reported() {
  printf '%s\n' 'It needs Claude Code' '2.1.302 or newer, whose pane it uses.' \
    > "$TEST_DIR/README.md"
  local stale expected="$TEST_DIR/README.md:needs Claude Code 2.1.302 or newer"
  stale=$(stale_minimums 2.1.330 "$TEST_DIR/README.md")
  [[ "$stale" == "$expected" ]] || fail "a wrapped stale claim came out as '$stale'"
}

test_a_claim_wrapped_inside_a_blockquote_is_read() {
  printf '%s\n' '> It needs Claude' '>   Code 2.1.330 or newer.' > "$TEST_DIR/README.md"
  local claims expected="$TEST_DIR/README.md:needs Claude Code 2.1.330 or newer"
  claims=$(minimum_claims "$TEST_DIR/README.md")
  [[ "$claims" == "$expected" ]] \
    || fail "a claim wrapped in a blockquote came out as '$claims'"
}

test_a_stale_minimum_wrapped_in_a_crlf_readme_is_reported() {
  printf 'It needs Claude Code\r\n2.1.302 or newer.\r\n' > "$TEST_DIR/README.md"
  local stale expected="$TEST_DIR/README.md:needs Claude Code 2.1.302 or newer"
  stale=$(stale_minimums 2.1.330 "$TEST_DIR/README.md")
  [[ "$stale" == "$expected" ]] \
    || fail "a stale claim wrapped in a CRLF README came out as '$stale'"
}

test_a_stale_minimum_wrapped_in_a_nested_blockquote_is_reported() {
  printf '%s\n' '> > It needs Claude' '> > Code 2.1.302 or newer.' > "$TEST_DIR/README.md"
  local stale expected="$TEST_DIR/README.md:needs Claude Code 2.1.302 or newer"
  stale=$(stale_minimums 2.1.330 "$TEST_DIR/README.md")
  [[ "$stale" == "$expected" ]] \
    || fail "a stale claim wrapped in a nested blockquote came out as '$stale'"
}

test_a_minimum_that_only_starts_with_the_pin_is_stale() {
  printf '%s\n' 'It needs Claude Code 2.1.330 or newer.' > "$TEST_DIR/README.md"
  local stale expected="$TEST_DIR/README.md:needs Claude Code 2.1.330 or newer"
  stale=$(stale_minimums 2.1.33 "$TEST_DIR/README.md")
  [[ "$stale" == "$expected" ]] \
    || fail "2.1.330 against a pin of 2.1.33 came out as '$stale'"
}

test_every_claim_in_every_readme_is_listed_with_its_file() {
  printf '%s\n' \
    'needs Claude Code 2.1.330 or newer, and later needs Claude Code 2.1.302 or newer' \
    > "$TEST_DIR/a.md"
  printf '%s\n' 'needs Claude Code 2.1.311 or newer' > "$TEST_DIR/b.md"
  local claims expected
  expected="$TEST_DIR/a.md:needs Claude Code 2.1.330 or newer"$'\n'
  expected+="$TEST_DIR/a.md:needs Claude Code 2.1.302 or newer"$'\n'
  expected+="$TEST_DIR/b.md:needs Claude Code 2.1.311 or newer"
  claims=$(minimum_claims "$TEST_DIR/a.md" "$TEST_DIR/b.md")
  [[ "$claims" == "$expected" ]] || fail "claims from two files came out as '$claims'"
}

test_a_readme_without_a_claim_yields_no_claims() {
  printf '%s\n' 'The tests pass against Claude Code 2.1.311.' > "$TEST_DIR/README.md"
  local claims
  claims=$(minimum_claims "$TEST_DIR/README.md")
  [[ -z "$claims" ]] || fail "a README with no minimum gave claims: '$claims'"
}

run_tests "$@"
