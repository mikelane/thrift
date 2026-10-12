#!/usr/bin/env bash
# Shared by the *.test.sh files. Sourcing it pulls the canary step scripts out of
# .github/workflows/ci.yml, writes the stub `gh`, `claude` and `tsc`, and defines the asserts and
# the runners. A test file defines test_* functions and ends with `run_tests "$@"`.
#
# CANARY_CI_YML points the harness at another copy of ci.yml, which is how the extraction guard
# is exercised: a step that was renamed or re-indented makes the sourcing test file exit 2.
# No -e: a test that fails records it with `fail` and the file goes on to the next test.
set -uo pipefail
# A relative `cd` searches CDPATH and prints where it lands, which would corrupt HARNESS_DIR.
unset CDPATH

HARNESS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$HARNESS_DIR/../.." && pwd)
CI_YML=${CANARY_CI_YML:-$REPO_ROOT/.github/workflows/ci.yml}
CHECK_SH=$REPO_ROOT/scripts/check.sh
[[ -r "$CI_YML" ]] || { echo "Cannot read the workflow $CI_YML, so the harness has no step scripts to test." >&2; exit 2; }

for tool in jq openssl; do
  command -v "$tool" > /dev/null || { echo "The harness needs $tool on PATH. Install it, then run the harness again." >&2; exit 2; }
done

WORK_DIR=$(mktemp -d) || { echo 'mktemp -d failed, so the harness has nowhere to work.' >&2; exit 2; }
trap 'rm -rf "$WORK_DIR"' EXIT

# shellcheck source=canary-extract-lib.sh
source "$HARNESS_DIR/canary-extract-lib.sh"
# shellcheck source=canary-stubs-lib.sh
source "$HARNESS_DIR/canary-stubs-lib.sh"

check_job_condition "$CI_YML" report "$REPORT_JOB_IF" || exit 2
extract_or_die "$CI_YML" report "$REPORT_STEP" "$REPORT_SPEC" 'gh issue create' "$WORK_DIR/report.sh"
extract_or_die "$CI_YML" check "$RECORD_STEP" "$RECORD_SPEC" 'claude-version' "$WORK_DIR/record.sh"
extract_or_die "$CI_YML" check "$CHECK_STEP" "$CHECK_SPEC" 'scripts/check.sh' "$WORK_DIR/check-step.sh"
MAX_ISSUES=$(read_report_step_setting "$CI_YML" MAX_ISSUES) || exit 2
MAX_FENCE=$(read_report_step_setting "$CI_YML" MAX_FENCE) || exit 2

STUBS=$WORK_DIR/stubs
write_stubs

# ---------------------------------------------------------------------------------------------
# Test plumbing
# ---------------------------------------------------------------------------------------------
TEST_COUNT=0
FAILED_TEST_COUNT=0

fail() {
  DID_TEST_FAIL=1
  FAILURE_DETAILS="${FAILURE_DETAILS}    - $*"$'\n'
}
assert_exit_code() { [[ "$EXIT_CODE" == "$1" ]] || fail "exit code was $EXIT_CODE, expected $1"; }
assert_exit_code_nonzero() { [[ "$EXIT_CODE" != 0 ]] || fail 'exit code was 0, expected a failure'; }
assert_out_has() { grep -qaF -- "$1" "$OUTPUT" || fail "output lacks: $1"; }
assert_out_lacks() { ! grep -qaF -- "$1" "$OUTPUT" || fail "output has: $1"; }
# Appends the first lines of a file to the failure details, prefixed so no line can start a
# workflow command in the CI log.
show_file() {
  if [[ ! -r "$1" ]]; then
    FAILURE_DETAILS="${FAILURE_DETAILS}        | (${1#"$TEST_DIR"/} does not exist or cannot be read)"$'\n'
    return
  fi
  FAILURE_DETAILS="${FAILURE_DETAILS}$(sed 's/^/        | /' "$1" | head -n 20)"$'\n'
}
assert_file_has() { grep -qaF -- "$2" "$1" || { fail "${1#"$TEST_DIR"/} lacks: $2"; show_file "$1"; }; }
assert_file_lacks() { ! grep -qaF -- "$2" "$1" || { fail "${1#"$TEST_DIR"/} has: $2"; show_file "$1"; }; }
assert_file_exists() { [[ -e "$1" ]] || fail "${1#"$TEST_DIR"/} does not exist"; }
assert_no_file() { [[ ! -e "$1" ]] || fail "${1#"$TEST_DIR"/} exists"; }
assert_gh_call_count() {
  local count
  count=$(count_lines -- "^gh $1" "$GH_CALLS") || { fail "could not read the gh call log ${GH_CALLS#"$TEST_DIR"/} to count gh '$1'"; return; }
  [[ "$count" == "$2" ]] || fail "gh '$1' ran $count times, expected $2"
}
assert_fence_lines() { # assert_fence_lines <file> <fence> <count>
  local count
  count=$(count_lines -axF -- "$2" "$1") || { fail "could not read ${1#"$TEST_DIR"/} to count its fence lines"; return; }
  [[ "$count" == "$3" ]] || fail "expected $3 lines of exactly ${#2} backticks in ${1#"$TEST_DIR"/}, found $count"
}

repeat_char() { head -c "$2" /dev/zero | tr '\0' "$1"; }
repeat_backticks() { repeat_char '`' "$1"; }

# Gives each test its own runner temp directory with a clean artifact, as `check (latest)` leaves it.
setup() {
  # An empty TEST_DIR would point every fixture path below at the filesystem root.
  TEST_DIR=$(mktemp -d "$WORK_DIR/t.XXXXXX") || { echo 'mktemp -d failed for a test directory.' >&2; exit 2; }
  FAILURE_LOG_DIR=$TEST_DIR/failures
  OUTPUT=$TEST_DIR/out
  GH_CALLS=$TEST_DIR/gh-calls
  GH_OPEN_TITLES=$TEST_DIR/open-titles
  GH_PLUGINS=$TEST_DIR/repo-plugins
  GH_FAIL_CREATE_TITLES=$TEST_DIR/fail-create-titles
  mkdir -p "$FAILURE_LOG_DIR"
  : > "$GH_CALLS"
  : > "$GH_OPEN_TITLES"
  : > "$GH_FAIL_CREATE_TITLES"
  printf '%s\n' handoff a b c d e f p1 p2 p3 p4 p5 p6 p7 p8 > "$GH_PLUGINS"
  touch "$FAILURE_LOG_DIR/checked"
  echo 2.1.300 > "$FAILURE_LOG_DIR/claude-version"
}

add_failure_log() { printf '%s\n' "${2:-boom}" > "$FAILURE_LOG_DIR/$1.txt"; }
mark_issue_open() { echo "Claude Code 2.1.300 breaks $1" >> "$GH_OPEN_TITLES"; }

# run_report <true|false> [VAR=value ...]: the extracted report script, as Actions runs it.
run_report() {
  local dry_run="$1" locale=C.UTF-8
  shift
  # macOS has no C.UTF-8, and its tr rejects invalid UTF-8 under a UTF-8 locale. The runner is
  # Linux, so only the macOS run of this harness falls back to the C locale.
  [[ "$(uname -s)" != Darwin ]] || locale=C
  EXIT_CODE=0
  (cd "$TEST_DIR" && env \
    RUNNER_TEMP="$TEST_DIR" GH_REPO=o/r GITHUB_SHA=abc123 DRY_RUN="$dry_run" \
    MAX_ISSUES="$MAX_ISSUES" MAX_FENCE="$MAX_FENCE" \
    GITHUB_SERVER_URL=https://github.com GITHUB_REPOSITORY=o/r GITHUB_RUN_ID=42 \
    GH_CALLS="$GH_CALLS" GH_OPEN_TITLES="$GH_OPEN_TITLES" GH_PLUGINS="$GH_PLUGINS" \
    GH_FAIL_CREATE_TITLES="$GH_FAIL_CREATE_TITLES" PATH="$STUBS:$PATH" LC_ALL="$locale" \
    ${1+"$@"} \
    "$BASH" --noprofile --norc -eo pipefail "$WORK_DIR/report.sh") > "$OUTPUT" 2>&1 || EXIT_CODE=$?
}

# A copy of the repo with check.sh, a stub tsc and a stub claude, and the given plugin directories.
make_repo() {
  REPO_COPY=$TEST_DIR/repo
  mkdir -p "$REPO_COPY/scripts" "$REPO_COPY/node_modules/.bin" "$REPO_COPY/bin" "$REPO_COPY/plugins" "$TEST_DIR/tmp" "$TEST_DIR/home"
  cp "$CHECK_SH" "$REPO_COPY/scripts/check.sh"
  chmod +x "$REPO_COPY/scripts/check.sh"
  cp "$STUBS/tsc" "$REPO_COPY/node_modules/.bin/tsc"
  cp "$STUBS/claude" "$REPO_COPY/bin/claude"
  rm -f "$FAILURE_LOG_DIR/checked" "$FAILURE_LOG_DIR/claude-version"
  STUB_LOG=$TEST_DIR/stub-calls
  : > "$STUB_LOG"
  local plugin
  for plugin in "$@"; do mkdir -p "$REPO_COPY/plugins/$plugin/.claude-plugin"; done
}

# write_stub_env [VAR=value ...]: the STUB_* settings the stubs read, beside each stub.
write_stub_env() {
  local setting
  { printf 'STUB_LOG=%q\n' "$STUB_LOG"
    for setting in "$@"; do
      [[ "$setting" != STUB_* ]] || printf '%s=%q\n' "${setting%%=*}" "${setting#*=}"
    done; } > "$REPO_COPY/bin/stub.env"
  cp "$REPO_COPY/bin/stub.env" "$REPO_COPY/node_modules/.bin/stub.env"
}

# run_check <script> [VAR=value ...] -- [argument ...]: the script runs from the repo root with a
# caller environment that holds credentials, to show check.sh keeps them away from the engine.
run_check() {
  local script="$1" settings=()
  shift
  while [[ "$1" != -- ]]; do settings+=("$1"); shift; done
  shift
  write_stub_env ${settings[@]+"${settings[@]}"}
  EXIT_CODE=0
  (cd "$REPO_COPY" && env \
    PATH="$REPO_COPY/bin:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" \
    ANTHROPIC_API_KEY=leaked CLAUDE_CODE_OAUTH_TOKEN=leaked CLAUDE_CONFIG_DIR=/caller-config \
    ${settings[@]+"${settings[@]}"} \
    "$BASH" --noprofile --norc -e "$script" ${1+"$@"}) > "$OUTPUT" 2>&1 || EXIT_CODE=$?
}
run_check_script() { run_check "$REPO_COPY/scripts/check.sh" "$@"; }
run_check_step() { run_check "$WORK_DIR/check-step.sh" "$@"; }

run_record_step() {
  EXIT_CODE=0
  (cd "$TEST_DIR" && env RUNNER_TEMP="$TEST_DIR" PATH="$1" "$BASH" --noprofile --norc -e "$WORK_DIR/record.sh") > "$OUTPUT" 2>&1 || EXIT_CODE=$?
}

# split_before_report_step <text>: the text goes in just before the report step, so a job header in it
# ends the report job there and the step and everything after it belong to the new job.
split_before_report_step() {
  JOB_HEADER="$1" awk -v name="      - name: $REPORT_STEP" '$0 == name { printf "%s", ENVIRON["JOB_HEADER"] } { print }' "$CI_YML" > "$TEST_DIR/ci.yml"
  cmp -s "$CI_YML" "$TEST_DIR/ci.yml" && fail 'the fixture changed nothing'
  return 0
}

# run_tests [name-fragment]: runs every test_* function whose name contains the fragment. Exits 4
# when none match, so the entry point can tell "nothing here" from a failure.
run_tests() {
  local name_filter="${1:-}" test_function
  # The names come in on fd 3, so a test that reads stdin cannot eat the rest of the list.
  while IFS= read -r test_function <&3; do
    [[ -z "$name_filter" || "$test_function" == *"$name_filter"* ]] || continue
    run_one_test "$test_function"
  done 3< <(declare -F | awk '$3 ~ /^test_/ {print $3}')
  [[ "$TEST_COUNT" -gt 0 ]] || exit 4
  echo "$((TEST_COUNT - FAILED_TEST_COUNT)) of $TEST_COUNT passed"
  [[ -z "${FAILED_TEST_NAMES:-}" ]] || printf 'Failed tests:\n%s' "$FAILED_TEST_NAMES"
  [[ "$FAILED_TEST_COUNT" == 0 ]]
}

run_one_test() {
  local test_function="$1"
  DID_TEST_FAIL=0
  FAILURE_DETAILS=''
  setup
  "$test_function" 3<&-
  TEST_COUNT=$((TEST_COUNT + 1))
  if [[ "$DID_TEST_FAIL" == 0 ]]; then
    echo "PASS $test_function"
    return
  fi
  FAILED_TEST_COUNT=$((FAILED_TEST_COUNT + 1))
  echo "FAIL $test_function"
  printf '%s' "$FAILURE_DETAILS"
  # The end of the output is where the report script says what it decided.
  if [[ -s "$OUTPUT" ]]; then
    echo '      last lines of output:'
    sed 's/^/        | /' "$OUTPUT" | tail -n 30
  else
    echo '      (the test ran nothing that wrote output)'
  fi
  FAILED_TEST_NAMES="${FAILED_TEST_NAMES:-}    $test_function"$'\n'
}
