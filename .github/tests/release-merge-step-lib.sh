#!/usr/bin/env bash
# Helpers shared by the release-merge-step, -ci-path and -run test files.
# Sourced after canary-report-lib.sh and release-merge-stubs-lib.sh.


# run_merge_step <command>...: runs a lib function the way the workflow step does (set -euo
# pipefail, the step's variables), leaving its output in $OUTPUT and its status in $EXIT_CODE.
run_merge_step() {
  mkdir -p "$TEST_DIR/work"
  stub_gh
  (
    set -euo pipefail
    BASE=main BOT_LOGIN=$BOT OWNER=mikelane work_dir=$TEST_DIR/work RELEASE_MERGE_CONFIG=$CONFIG "$@"
  ) >"$OUTPUT" 2>&1
  # shellcheck disable=SC2034 # read by assert_exit_code in canary-report-lib.sh
  EXIT_CODE=$?
}

# assert_out_line <line>: the output has <line> as a whole line, so nothing may follow or precede it.
assert_out_line() { grep -qaxF -- "$1" "$OUTPUT" || fail "output has no line: $1"; }

# assert_out_line_count <fixed-string> <count>: <count> lines of the output contain <fixed-string>.
assert_out_line_count() {
  local count
  count=$(grep -caF -- "$1" "$OUTPUT")
  [[ "$count" == "$2" ]] || fail "$count output lines have [$1], expected $2"
}

# with_failing_mktemp <prefix> <command>...: runs the command with a mktemp that fails for the
# template <prefix>.XXXXXX and makes every other temp file as usual. run_merge_step runs it in a
# subshell, so the stub does not outlive the test.
with_failing_mktemp() {
  FAILING_MKTEMP_PREFIX=$1
  shift
  mktemp() { [[ "$1" != */"$FAILING_MKTEMP_PREFIX".* ]] && command mktemp "$@"; }
  "$@"
}

# run_ci_path [run-id]: release_merge_run as the CI-completion step runs it: trigger CI, the release
# branch, tested SHA $SHA_A, and CI run 211 unless <run-id> says otherwise.
run_ci_path() {
  TRIGGER=CI BRANCH=$RELEASE_BRANCH CI_TESTED_SHA="$SHA_A" CI_RUN_ID=${1:-211} run_merge_step release_merge_run
}
