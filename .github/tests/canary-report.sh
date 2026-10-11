#!/usr/bin/env bash
# Regression harness for the canary path in .github/workflows/ci.yml: the "open canary issues"
# (`report`) job and the `scripts/check.sh` run that feeds it.
#
# The `report` job checks out nothing, so its script has to stay inline in ci.yml. This harness
# pulls the real step scripts out of ci.yml and runs each under the shell Actions gives it: the
# report step declares `shell: bash`, so `bash -eo pipefail`, and the others have no `shell:` key,
# so `bash -e`. Extraction fails if a step gains or changes a key the harness does not model. A stub
# `gh`, a stub `claude` and a stub `tsc` stand in for the real tools. No network and no API key.
#
# Usage: .github/tests/canary-report.sh [name-fragment]   (runs the tests whose name contains it)
# CANARY_CI_YML points the harness at another copy of ci.yml, which is how the extraction guard
# is exercised: a step that was renamed or re-indented makes this script exit 2.
set -uo pipefail
# A relative `cd` searches CDPATH and prints where it lands, which would corrupt HARNESS_DIR.
unset CDPATH

HARNESS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$HARNESS_DIR/../.." && pwd)
CI_YML=${CANARY_CI_YML:-$REPO_ROOT/.github/workflows/ci.yml}
CHECK_SH=$REPO_ROOT/scripts/check.sh
TEST_NAME_FILTER=${1:-}

REPORT_STEP='Open an issue for each plugin the new build breaks'
RECORD_STEP='Record the Claude Code version for the canary issue job'
CHECK_STEP='Check every plugin with scripts/check.sh'

for tool in jq openssl; do
  command -v "$tool" > /dev/null || { echo "The harness needs $tool on PATH. Install it, then run the harness again." >&2; exit 2; }
done

# Prints the body of one step's `run:` from a workflow file, de-indented. Exits 1, and says why,
# when the step is not found at the indentation the workflow uses, is found more than once, or has
# a key the harness does not model, so a renamed, re-indented, duplicated or conditional step fails
# the harness instead of testing a script that Actions would not run, or would run differently.
#
# The third argument lists the step's keys, one per line, besides `name` and `run`:
#   key        allowed, any value
#   key=value  allowed only with exactly that value
#   +key=value required as well
# Every key at the step's indentation, before or after `run`, must be listed.
extract_step() {
  local ci_yml="$1" step_name="$2" spec="$3" script occurrences status=0
  occurrences=$(grep -cxF -- "      - name: $step_name" "$ci_yml" || true)
  if [[ "$occurrences" -gt 1 ]]; then
    echo "The step '$step_name' appears $occurrences times in $ci_yml, so the harness cannot tell which one runs. Give each step a unique name." >&2
    return 1
  fi
  script=$(SPEC="$spec" awk -v want="      - name: $step_name" '
    BEGIN {
      count = split(ENVIRON["SPEC"], entries, "\n")
      for (i = 1; i <= count; i++) {
        entry = entries[i]
        if (entry == "") continue
        required = (substr(entry, 1, 1) == "+")
        if (required) entry = substr(entry, 2)
        eq = index(entry, "=")
        key = eq ? substr(entry, 1, eq - 1) : entry
        if (eq) value[key] = substr(entry, eq + 1)
        allowed[key] = 1
        if (required) needed[key] = 1
      }
      allowed["run"] = 1
      state = 0
    }
    function check_key(    key) {
      key = $0
      sub(/^        /, "", key)
      sub(/:.*/, "", key)
      seen[key] = 1
      if (!(key in allowed)) problem = "has the key \"" key "\", which the harness does not model"
      else if ((key in value) && $0 != "        " key ": " value[key]) problem = "has \"" key "\" set to something other than \"" value[key] "\""
    }
    state == 4 { next }
    state == 0 { if ($0 == want) state = 1; next }
    $0 ~ /^      - / || $0 ~ /^  [A-Za-z]/ { state = 4; next }
    state == 2 {
      if ($0 ~ /^ *$/) { print ""; next }
      if (substr($0, 1, 10) == "          ") { print substr($0, 11); next }
      state = 3
    }
    $0 ~ /^        [A-Za-z_-]+:/ {
      check_key()
      if (state == 1 && $0 == "        run: |") state = 2
      else if (state == 1 && index($0, "        run: ") == 1) { print substr($0, 14); state = 3 }
    }
    END {
      if (state == 0) exit
      if (problem == "") for (key in needed) if (!(key in seen)) problem = "lacks the key \"" key "\""
      if (problem != "") { print problem > "/dev/stderr"; exit 3 }
    }' "$ci_yml" 2> "$WORK_DIR/extract.err") || status=$?
  if [[ "$status" == 3 ]]; then
    echo "The step '$step_name' in $ci_yml $(cat "$WORK_DIR/extract.err"). If the change is intended, update the step's key list in $HARNESS_DIR/canary-report.sh." >&2
    return 1
  fi
  if [[ "$status" != 0 ]]; then
    echo "Could not read the step '$step_name' from $ci_yml: awk exited $status: $(cat "$WORK_DIR/extract.err")" >&2
    return 1
  fi
  if [[ -z "$script" ]]; then
    echo "Could not extract the step '$step_name' from $ci_yml: no step has that name at six spaces of indentation with a run block. If it was renamed or moved, update $HARNESS_DIR/canary-report.sh to match." >&2
    return 1
  fi
  printf '%s\n' "$script"
}

REPORT_SPEC=$'env\n+shell=bash'
# shellcheck disable=SC2016 # the workflow expression is matched literally
RECORD_SPEC=$'+if=always() && (github.event_name == \'schedule\' || github.event_name == \'workflow_dispatch\') && matrix.channel == \'latest\''
CHECK_SPEC=$'env'
extract_report_step() { extract_step "$1" "$REPORT_STEP" "$REPORT_SPEC"; }

# Prints the value of one `KEY: value` setting of the report step's env.
read_report_step_setting() {
  local ci_yml="$1" key="$2" value
  value=$(awk -v want="      - name: $REPORT_STEP" -v key="          $key: " '
    $0 == want { inside = 1; next }
    inside && ($0 ~ /^      - / || $0 ~ /^  [A-Za-z]/) { exit }
    inside && index($0, key) == 1 { print substr($0, length(key) + 1); exit }' "$ci_yml")
  [[ -n "$value" ]] || { echo "Could not read $key from the report step's env in $ci_yml. Restore the setting, or update $HARNESS_DIR/canary-report.sh to match." >&2; return 1; }
  printf '%s\n' "$value"
}

WORK_DIR=$(mktemp -d) || { echo 'mktemp -d failed, so the harness has nowhere to work.' >&2; exit 2; }
trap 'rm -rf "$WORK_DIR"' EXIT

extract_or_die() {
  local step_name="$1" spec="$2" must_contain="$3" target="$4"
  extract_step "$CI_YML" "$step_name" "$spec" > "$target" || exit 2
  grep -qF -- "$must_contain" "$target" || {
    echo "The step '$step_name' no longer contains '$must_contain', so the harness would test the wrong script. If the step changed on purpose, update the expected text in $HARNESS_DIR/canary-report.sh." >&2
    exit 2
  }
}
extract_or_die "$REPORT_STEP" "$REPORT_SPEC" 'gh issue create' "$WORK_DIR/report.sh"
extract_or_die "$RECORD_STEP" "$RECORD_SPEC" 'claude-version' "$WORK_DIR/record.sh"
extract_or_die "$CHECK_STEP" "$CHECK_SPEC" 'scripts/check.sh' "$WORK_DIR/check-step.sh"
MAX_ISSUES=$(read_report_step_setting "$CI_YML" MAX_ISSUES) || exit 2
MAX_FENCE=$(read_report_step_setting "$CI_YML" MAX_FENCE) || exit 2

# ---------------------------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------------------------
STUBS=$WORK_DIR/stubs
mkdir -p "$STUBS"

# `gh issue list` applies --limit and --jq like the real CLI.
cat > "$STUBS/gh" <<'EOF'
#!/usr/bin/env bash
echo "gh $*" >> "$GH_CALLS"
case "$1 $2" in
  "api "*)
    [ -z "${GH_API_FAIL:-}" ] || exit 1
    cat "$GH_PLUGINS"
    ;;
  "issue list")
    shift 2
    limit=30 expr='.'
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --limit) limit=$2; shift ;;
        --jq) expr=$2; shift ;;
      esac
      shift
    done
    [ -z "${GH_LIST_FAIL:-}" ] || exit 1
    jq -R '{title: .}' "$GH_OPEN_TITLES" | jq -s ".[:$limit]" | jq -r "$expr"
    ;;
  "issue create")
    if [ -f "${GH_FAIL_CREATE_TITLES:-/nonexistent}" ] && grep -qxF -- "$4" "$GH_FAIL_CREATE_TITLES"; then
      echo "stub gh: refusing to create $4" >&2
      exit 1
    fi
    echo "https://github.com/o/r/issues/1"
    ;;
esac
EOF

# The stub engine reads its settings from a file beside it, because check.sh runs the declaration
# step under `env -i`, which strips STUB_* from the environment.
cat > "$STUBS/claude" <<'EOF'
#!/usr/bin/env bash
[ -f "$(dirname "$0")/stub.env" ] && . "$(dirname "$0")/stub.env"
echo "claude $*" >> "$STUB_LOG"
is_listed() { [[ " ${1:-} " == *" $2 "* ]]; }
if [ "${1:-}" = --version ]; then echo "${STUB_VERSION:-2.1.300} (Claude Code)"; exit 0; fi
if [ "${1:-}" = -p ]; then
  dir=$4
  name=$(basename "$dir")
  config_state=missing
  [ -d "${CLAUDE_CONFIG_DIR:-/nonexistent}" ] && config_state=empty
  [ -z "$(ls -A "${CLAUDE_CONFIG_DIR:-/nonexistent}" 2> /dev/null)" ] || config_state=not-empty
  echo "GENENV plugin=$name api_key=${ANTHROPIC_API_KEY-unset} oauth=${CLAUDE_CODE_OAUTH_TOKEN-unset} config=${CLAUDE_CONFIG_DIR-unset} config_state=$config_state" >> "$STUB_LOG"
  is_listed "${STUB_NO_TYPE_DECLARATIONS:-}" "$name" || {
    mkdir -p "$dir/.claude-plugin/types/claude-code"
    : > "$dir/.claude-plugin/types/claude-code/index.d.ts"
  }
  echo "Not logged in"
  exit 1
fi
name=$(basename "$3")
if [ "$2" = validate ]; then
  is_listed "${STUB_VALIDATE_FAIL:-}" "$name" && { echo "validate refused $name"; exit 1; }
  echo ok; exit 0
fi
if [ "$2" = test ]; then
  marker=absent
  [ ! -e "${CHECK_LOG_DIR:-/nonexistent}/checked" ] || marker=present
  echo "MARKER plugin=$name checked=$marker" >> "$STUB_LOG"
  is_listed "${STUB_TEST_FAIL:-}" "$name" && { echo "(fail) a test in $name"; exit 1; }
  echo "(pass) a test"; exit 0
fi
exit 2
EOF

cat > "$STUBS/tsc" <<'EOF'
#!/usr/bin/env bash
[ -f "$(dirname "$0")/stub.env" ] && . "$(dirname "$0")/stub.env"
echo "tsc $*" >> "$STUB_LOG"
name=$(basename "$2")
if [[ " ${STUB_TSC_FAIL:-} " == *" $name "* ]]; then
  echo "$2/test/x.ts: error TS2578: Unused '@ts-expect-error' directive."
  exit 2
fi
exit 0
EOF
chmod +x "$STUBS/gh" "$STUBS/claude" "$STUBS/tsc"

# ---------------------------------------------------------------------------------------------
# Test plumbing
# ---------------------------------------------------------------------------------------------
DID_TEST_FAIL=0
FAILURE_DETAILS=''
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
  FAILURE_DETAILS="${FAILURE_DETAILS}$(sed 's/^/        | /' "$1" 2> /dev/null | head -n 20)"$'\n'
}
assert_file_has() { grep -qaF -- "$2" "$1" || { fail "${1#"$TEST_DIR"/} lacks: $2"; show_file "$1"; }; }
assert_file_lacks() { ! grep -qaF -- "$2" "$1" || { fail "${1#"$TEST_DIR"/} has: $2"; show_file "$1"; }; }
assert_file_exists() { [[ -e "$1" ]] || fail "${1#"$TEST_DIR"/} does not exist"; }
assert_no_file() { [[ ! -e "$1" ]] || fail "${1#"$TEST_DIR"/} exists"; }
gh_call_count() { grep -c -- "^gh $1" "$GH_CALLS" || true; }
assert_gh_call_count() {
  local count
  count=$(gh_call_count "$1")
  [[ "$count" == "$2" ]] || fail "gh '$1' ran $count times, expected $2"
}
assert_fence_lines() { # assert_fence_lines <file> <fence> <count>
  local count
  count=$(grep -acxF -- "$2" "$1" || true)
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

# run_check <script> [VAR=value ...] -- [argument ...]: the script runs from the repo root with a
# caller environment that holds credentials, to show check.sh keeps them away from the engine.
# write_stub_env [VAR=value ...]: the STUB_* settings the stubs read, beside each stub.
write_stub_env() {
  local setting
  { printf 'STUB_LOG=%q\n' "$STUB_LOG"
    for setting in "$@"; do
      [[ "$setting" != STUB_* ]] || printf '%s=%q\n' "${setting%%=*}" "${setting#*=}"
    done; } > "$REPO_COPY/bin/stub.env"
  cp "$REPO_COPY/bin/stub.env" "$REPO_COPY/node_modules/.bin/stub.env"
}

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

# ---------------------------------------------------------------------------------------------
# Extraction guard
# ---------------------------------------------------------------------------------------------
test_extraction_finds_the_report_step_in_the_real_workflow() {
  extract_report_step "$CI_YML" > "$TEST_DIR/out" 2>&1 || fail 'extraction failed'
  assert_file_has "$TEST_DIR/out" 'gh issue create'
}
test_extraction_fails_when_the_step_is_renamed() {
  sed 's/- name: Open an issue for each plugin/- name: Open issues for each plugin/' "$CI_YML" > "$TEST_DIR/ci.yml"
  extract_report_step "$TEST_DIR/ci.yml" > "$OUTPUT" 2>&1 && fail 'extraction passed on a renamed step'
  assert_out_has 'Could not extract the step'
  return 0
}
test_extraction_fails_when_the_step_name_appears_twice() {
  { cat "$CI_YML"; printf '  decoy:\n    steps:\n      - name: %s\n        run: |\n          gh issue create\n' "$REPORT_STEP"; } > "$TEST_DIR/ci.yml"
  extract_report_step "$TEST_DIR/ci.yml" > "$OUTPUT" 2>&1 && fail 'extraction passed with the step name in two places'
  assert_out_has 'appears 2 times'
  return 0
}
test_extraction_fails_when_the_workflow_is_re_indented() {
  sed 's/^/  /' "$CI_YML" > "$TEST_DIR/ci.yml"
  extract_report_step "$TEST_DIR/ci.yml" > "$OUTPUT" 2>&1 && fail 'extraction passed on a re-indented workflow'
  assert_out_has 'Could not extract the step'
  return 0
}
test_extraction_fails_when_the_run_block_is_replaced_by_a_uses_step() {
  sed 's/^        run: |$/        with: |/' "$CI_YML" > "$TEST_DIR/ci.yml"
  extract_report_step "$TEST_DIR/ci.yml" > "$OUTPUT" 2>&1 && fail 'extraction passed with no run block'
  assert_out_has 'has the key "with"'
  return 0
}
test_extraction_fails_when_the_report_step_gains_an_if_condition() {
  sed "s/^      - name: ${REPORT_STEP}\$/&\\
        if: false/" "$CI_YML" > "$TEST_DIR/ci.yml"
  grep -qxF '        if: false' "$TEST_DIR/ci.yml" || { fail 'the fixture did not add the if: line'; return; }
  extract_report_step "$TEST_DIR/ci.yml" > "$OUTPUT" 2>&1 && fail 'extraction passed on a step that never runs'
  assert_out_has 'has the key "if"'
  return 0
}
test_extraction_fails_when_the_report_step_loses_its_shell_key() {
  grep -vxF '        shell: bash' "$CI_YML" > "$TEST_DIR/ci.yml"
  extract_report_step "$TEST_DIR/ci.yml" > "$OUTPUT" 2>&1 && fail 'extraction passed with no shell key, so Actions would drop pipefail'
  assert_out_has 'lacks the key "shell"'
  return 0
}
test_extraction_fails_when_the_report_step_runs_under_another_shell() {
  sed 's/^        shell: bash$/        shell: sh/' "$CI_YML" > "$TEST_DIR/ci.yml"
  extract_report_step "$TEST_DIR/ci.yml" > "$OUTPUT" 2>&1 && fail 'extraction passed with shell: sh'
  assert_out_has 'has "shell" set to something other than "bash"'
  return 0
}
test_extraction_fails_when_a_key_follows_the_run_block() {
  # shellcheck disable=SC2016 # the sed pattern holds a literal $
  sed 's/^          exit "\$problems"$/&\
        continue-on-error: true/' "$CI_YML" > "$TEST_DIR/ci.yml"
  grep -qxF '        continue-on-error: true' "$TEST_DIR/ci.yml" || { fail 'the fixture did not add the key'; return; }
  extract_report_step "$TEST_DIR/ci.yml" > "$OUTPUT" 2>&1 && fail 'extraction passed with a key after the run block'
  assert_out_has 'has the key "continue-on-error"'
  return 0
}
test_extraction_keeps_a_whitespace_only_line_shorter_than_the_indentation() {
  extract_report_step "$CI_YML" > "$TEST_DIR/expected"
  awk '{ print } /^          failures="\$RUNNER_TEMP\/failures"$/ { getline; print "   " }' "$CI_YML" > "$TEST_DIR/ci.yml"
  grep -qx '   ' "$TEST_DIR/ci.yml" || { fail 'the fixture did not add the whitespace-only line'; return; }
  extract_report_step "$TEST_DIR/ci.yml" > "$TEST_DIR/out" 2>&1 || fail 'extraction failed on a short whitespace-only line'
  cmp -s "$TEST_DIR/out" "$TEST_DIR/expected" || fail 'the script extracted around the whitespace-only line differs from the original'
}
test_reading_a_report_step_setting_ignores_the_same_key_in_another_step() {
  sed "s/^          CLAUDE_CODE_VERSION: .*\$/&\\
          MAX_FENCE: 1/" "$CI_YML" > "$TEST_DIR/ci.yml"
  grep -qxF '          MAX_FENCE: 1' "$TEST_DIR/ci.yml" || { fail 'the fixture did not add the decoy'; return; }
  [[ "$(read_report_step_setting "$TEST_DIR/ci.yml" MAX_FENCE)" == "$MAX_FENCE" ]] || fail 'MAX_FENCE was read from another step'
}
test_harness_exits_2_when_the_workflow_it_is_pointed_at_lost_a_step() {
  sed 's/- name: Open an issue for each plugin/- name: Open issues for each plugin/' "$CI_YML" > "$TEST_DIR/ci.yml"
  EXIT_CODE=0
  CANARY_CI_YML="$TEST_DIR/ci.yml" "$BASH" "${BASH_SOURCE[0]}" nothing-matches > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  assert_exit_code 2
  assert_out_has 'Could not extract the step'
}
test_report_job_checks_out_nothing_and_keeps_its_script_inline() {
  local job
  job=$(awk '/^  report:/{f=1;next} f&&/^  [A-Za-z]/{exit} f' "$CI_YML")
  [[ "$job" == *"- name: $REPORT_STEP"* ]] || { fail 'no report job holding the report step was found'; return; }
  [[ "$job" != *'actions/checkout'* ]] || fail 'the report job checks out the repository'
  [[ "$job" != *'scripts/'* ]] || fail 'the report job runs a script from the repository'
}

# ---------------------------------------------------------------------------------------------
# Report job: which logs become issues
# ---------------------------------------------------------------------------------------------
test_live_run_opens_an_issue_titled_with_the_version_and_plugin() {
  add_failure_log handoff
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create --title Claude Code 2.1.300 breaks handoff --body-file' 1
  assert_gh_call_count 'api repos/o/r/contents/plugins?ref=abc123 ' 1
  assert_out_lacks 'dry run'
}
test_dry_run_prints_the_issue_instead_of_opening_it() {
  add_failure_log handoff 'tsc error TS2322'
  run_report true
  assert_exit_code 0
  assert_out_has 'dry run: would open an issue titled: Claude Code 2.1.300 breaks handoff'
  assert_out_has 'TS2322'
  assert_gh_call_count 'issue create' 0
}
test_dry_run_with_no_failure_logs_says_there_is_nothing_to_open() {
  run_report true
  assert_exit_code 0
  assert_out_has 'dry run: no failure logs, nothing to open'
}
test_live_run_with_no_failure_logs_opens_nothing_and_passes() {
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create' 0
}
test_issue_body_names_the_canary_and_links_the_run() {
  add_failure_log handoff
  run_report true
  assert_file_has "$TEST_DIR/issue-body.md" "The canary ran handoff's checks against Claude Code 2.1.300"
  assert_file_has "$TEST_DIR/issue-body.md" 'https://github.com/o/r/actions/runs/42'
}
test_log_with_a_bad_name_is_skipped_and_the_job_fails_but_a_good_log_is_opened() {
  add_failure_log handoff
  add_failure_log 'Bad Name'
  add_failure_log -lead
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 1
  assert_gh_call_count 'issue create --title Claude Code 2.1.300 breaks handoff ' 1
  assert_out_has 'Skipping an untrusted log: Bad\ Name'
  assert_out_has 'Skipping an untrusted log: -lead'
}
test_log_named_after_a_unicode_lookalike_is_skipped() {
  add_failure_log "hand$(printf '\xc3\xb6')ff"
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Skipping an untrusted log'
}
# The repository lists both names, so only the name pattern stands between them and an issue.
test_log_whose_name_breaks_the_name_pattern_is_skipped_even_when_the_repository_lists_it() {
  printf '%s\n' Upper -lead > "$GH_PLUGINS"
  add_failure_log Upper
  add_failure_log -lead
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Skipping an untrusted log: Upper'
  assert_out_has 'Skipping an untrusted log: -lead'
}
test_log_name_with_an_embedded_newline_is_skipped_and_cannot_start_a_workflow_command() {
  add_failure_log $'a\n::error::forged'
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  ! grep -q '^::error::' "$OUTPUT" || fail 'a forged workflow command starts a line of output'
}
test_log_name_that_only_matches_after_command_substitution_trims_a_newline_is_skipped() {
  add_failure_log $'handoff\n'
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Skipping an untrusted log'
}
test_log_for_a_plugin_missing_from_the_repository_is_skipped() {
  add_failure_log ghost
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Skipping an untrusted log: ghost'
}
test_log_named_after_a_prefix_of_a_real_plugin_is_skipped() {
  add_failure_log hand
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Skipping an untrusted log: hand'
}
test_symlinked_log_is_skipped() {
  echo secret > "$TEST_DIR/target"
  ln -s "$TEST_DIR/target" "$FAILURE_LOG_DIR/handoff.txt"
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Skipping an untrusted log: handoff'
}
test_log_that_is_a_directory_is_skipped() {
  mkdir "$FAILURE_LOG_DIR/handoff.txt"
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Skipping an untrusted log: handoff'
}
test_failure_to_list_the_repository_plugins_opens_nothing_and_fails() {
  add_failure_log handoff
  run_report false GH_API_FAIL=1
  assert_exit_code 1
  assert_out_has 'Failed to list the plugins in the repository, so no issue can be opened. Rerun the job.'
  assert_gh_call_count 'issue create' 0
}

# ---------------------------------------------------------------------------------------------
# Report job: the cap and the dedupe
# ---------------------------------------------------------------------------------------------
test_cap_opens_the_maximum_and_fails_naming_the_rest() {
  local i
  for i in 1 2 3 4 5 6 7 8; do add_failure_log "p$i" x; done
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' "$MAX_ISSUES"
  assert_out_has "Opened $MAX_ISSUES issues, the cap; $((8 - MAX_ISSUES)) more failing plugins were left unopened"
}
test_dry_run_cap_says_would_open() {
  local i
  for i in 1 2 3 4 5 6 7 8; do add_failure_log "p$i" x; done
  run_report true
  assert_exit_code 1
  assert_out_has "Would open $MAX_ISSUES issues, the cap; $((8 - MAX_ISSUES)) more failing plugins were left unopened"
  assert_gh_call_count 'issue create' 0
}
test_bad_name_and_cap_together_fail_and_still_open_the_maximum() {
  local i
  for i in 1 2 3 4 5 6 7; do add_failure_log "p$i" x; done
  add_failure_log BAD x
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' "$MAX_ISSUES"
  assert_out_has 'Skipping an untrusted log: BAD'
  assert_out_has "Opened $MAX_ISSUES issues, the cap; $((7 - MAX_ISSUES)) more failing plugins were left unopened"
}
test_open_issue_whose_title_merely_contains_the_canary_title_does_not_block_a_new_one() {
  add_failure_log handoff
  echo 'Re: Claude Code 2.1.300 breaks handoff badly' >> "$GH_OPEN_TITLES"
  echo 'Claude Code 2.1.300 breaks handoff-extras' >> "$GH_OPEN_TITLES"
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create' 1
}
test_open_issue_for_another_version_does_not_block_a_new_one() {
  add_failure_log handoff
  echo 'Claude Code 2.1.299 breaks handoff' >> "$GH_OPEN_TITLES"
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create --title Claude Code 2.1.300 breaks handoff ' 1
}
test_failure_to_list_issues_skips_that_plugin_and_fails() {
  add_failure_log handoff
  run_report false GH_LIST_FAIL=1
  assert_exit_code 1
  assert_out_has 'Failed to list issues for Claude Code 2.1.300 breaks handoff'
  assert_gh_call_count 'issue create' 0
}

# ---------------------------------------------------------------------------------------------
# Report job: the marker and the version
# ---------------------------------------------------------------------------------------------
test_missing_checked_marker_fails_with_a_message_even_when_there_are_no_logs() {
  rm "$FAILURE_LOG_DIR/checked"
  run_report true
  assert_exit_code 1
  assert_out_has 'did not reach the plugin checks'
}
test_missing_checked_marker_still_opens_the_issues_it_has_logs_for_and_fails() {
  rm "$FAILURE_LOG_DIR/checked"
  add_failure_log handoff
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 1
}
test_empty_version_opens_nothing_and_fails() {
  : > "$FAILURE_LOG_DIR/claude-version"
  add_failure_log handoff
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Unexpected Claude Code version'
}
test_version_file_holding_a_second_line_opens_nothing_and_fails() {
  printf '2.1.300\nevil' > "$FAILURE_LOG_DIR/claude-version"
  add_failure_log handoff
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Unexpected Claude Code version'
}
test_missing_version_file_opens_nothing_and_fails() {
  rm "$FAILURE_LOG_DIR/claude-version"
  add_failure_log handoff
  run_report false
  assert_exit_code 1
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Unexpected Claude Code version'
}
test_version_with_a_suffix_is_rejected() {
  echo '2.1.300-beta' > "$FAILURE_LOG_DIR/claude-version"
  run_report true
  assert_exit_code 1
  assert_out_has 'Unexpected Claude Code version'
}
test_version_with_one_component_is_accepted() {
  echo 3 > "$FAILURE_LOG_DIR/claude-version"
  add_failure_log handoff
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create --title Claude Code 3 breaks handoff' 1
}
# %q does not escape ':', so a version that starts with '::' is safe only because the text before
# it on the same line keeps the runner from reading the line as a workflow command.
test_invalid_version_is_printed_after_a_text_prefix_so_it_cannot_start_a_workflow_command() {
  printf '::error::forged\n::warning::forged' > "$FAILURE_LOG_DIR/claude-version"
  run_report true
  assert_exit_code 1
  assert_out_has 'Unexpected Claude Code version: '
  ! grep -q '^::' "$OUTPUT" || fail 'a line of output starts with ::'
  assert_out_has 'Canary summary: mode=dry-run version='
}

# ---------------------------------------------------------------------------------------------
# Report job: creating issues
# ---------------------------------------------------------------------------------------------
test_failed_issue_creation_is_reported_and_fails_the_job() {
  add_failure_log handoff
  echo 'Claude Code 2.1.300 breaks handoff' > "$GH_FAIL_CREATE_TITLES"
  run_report false
  assert_exit_code 1
  assert_out_has 'Failed to create an issue for Claude Code 2.1.300 breaks handoff'
}

# ---------------------------------------------------------------------------------------------
# Report job: the log inside the issue body
# ---------------------------------------------------------------------------------------------
test_plain_log_gets_a_three_backtick_fence() {
  add_failure_log handoff
  run_report true
  assert_fence_lines "$TEST_DIR/issue-body.md" '```' 2
}
test_log_with_a_three_backtick_line_gets_a_longer_fence() {
  printf 'error\n```\n@someone please look at #1\n' > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  assert_fence_lines "$TEST_DIR/issue-body.md" '````' 2
}
test_log_with_a_five_backtick_run_gets_a_six_backtick_fence() {
  printf 'a\n`````\n@someone\n' > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  assert_fence_lines "$TEST_DIR/issue-body.md" '``````' 2
}
test_log_with_tildes_does_not_need_a_longer_fence() {
  printf 'a\n~~~\nb\n' > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  assert_fence_lines "$TEST_DIR/issue-body.md" '```' 2
}
test_fence_holds_when_the_log_has_invalid_utf8() {
  printf 'error \xff\n```\n@someone [click](https://evil.example)\n' > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  assert_fence_lines "$TEST_DIR/issue-body.md" '````' 2
}
test_nul_bytes_are_stripped_from_the_body_and_the_fence_outgrows_the_log_backticks() {
  printf 'error \0\n```\n@someone\n' > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  assert_fence_lines "$TEST_DIR/issue-body.md" '````' 2
  [[ "$(tr -cd '\000' < "$TEST_DIR/issue-body.md" | wc -c | tr -d ' ')" == 0 ]] || fail 'the body still holds a NUL byte'
  assert_file_has "$TEST_DIR/issue-body.md" '@someone'
}
test_fence_holds_when_the_tail_cuts_a_multibyte_character() {
  # 3 + 59983 + 15 bytes: the 60000-byte tail starts on the second byte of the 3-byte character.
  { printf '\xe2\x9c\x93'; repeat_char a 59983; printf '\n```\n@someone\n'; } > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  assert_fence_lines "$TEST_DIR/issue-body.md" '````' 2
}
test_fence_closes_on_its_own_line_when_the_log_has_no_trailing_newline() {
  printf 'no newline at the end' > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  assert_fence_lines "$TEST_DIR/issue-body.md" '```' 2
  assert_file_has "$TEST_DIR/issue-body.md" 'no newline at the end'
}
test_log_with_a_backtick_run_one_short_of_the_limit_is_included_in_a_fence_of_the_limit() {
  { repeat_char a 59000; echo; repeat_backticks $((MAX_FENCE - 1)); echo; } > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  assert_file_lacks "$TEST_DIR/issue-body.md" 'withheld'
  assert_fence_lines "$TEST_DIR/issue-body.md" "$(repeat_backticks "$MAX_FENCE")" 2
  [[ "$(wc -c < "$TEST_DIR/issue-body.md")" -le 65536 ]] || fail 'the body is over 65536 characters'
}
test_log_with_a_backtick_run_at_the_limit_is_withheld_and_links_the_run() {
  { echo before; repeat_backticks "$MAX_FENCE"; echo; echo @someone; } > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  assert_file_has "$TEST_DIR/issue-body.md" 'withheld'
  assert_file_has "$TEST_DIR/issue-body.md" 'https://github.com/o/r/actions/runs/42'
  assert_file_lacks "$TEST_DIR/issue-body.md" '@someone'
}
test_eighty_kilobyte_plain_log_keeps_the_body_under_the_github_limit() {
  awk 'BEGIN { for (i = 0; i < 1300; i++) printf "line %d %s\n", i, "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }' > "$FAILURE_LOG_DIR/handoff.txt"
  [[ "$(wc -c < "$FAILURE_LOG_DIR/handoff.txt")" -ge 80000 ]] || fail 'the fixture is under 80 KB'
  run_report true
  [[ "$(wc -c < "$TEST_DIR/issue-body.md")" -le 65536 ]] || fail 'the body is over 65536 characters'
  assert_file_has "$TEST_DIR/issue-body.md" 'line 1299'
}
test_passing_test_lines_do_not_push_the_failing_test_out_of_the_tail() {
  { awk 'BEGIN { for (i = 0; i < 3000; i++) print "(pass) a test that passed" }'; echo '(fail) the test that broke'; } > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  assert_file_has "$TEST_DIR/issue-body.md" '(fail) the test that broke'
  assert_file_lacks "$TEST_DIR/issue-body.md" '(pass) '
}
test_untrusted_log_is_printed_between_stop_commands_markers() {
  printf 'boom\n::error::injected\n' > "$FAILURE_LOG_DIR/handoff.txt"
  run_report true
  local start token end injected
  start=$(grep -an '^::stop-commands::' "$OUTPUT" | head -n 1 | cut -d: -f1)
  token=$(sed -n "${start:-0}p" "$OUTPUT" | sed 's/^::stop-commands:://')
  [[ "$token" =~ ^[0-9a-f]{32}$ ]] || fail "the stop-commands token is not 32 hex characters: $token"
  end=$(grep -anxF "::${token}::" "$OUTPUT" | head -n 1 | cut -d: -f1)
  injected=$(grep -anxF '::error::injected' "$OUTPUT" | head -n 1 | cut -d: -f1)
  [[ -n "$start" && -n "$end" && -n "$injected" ]] || { fail 'a marker or the injected line is missing'; return; }
  { [[ "$start" -lt "$injected" ]] && [[ "$injected" -lt "$end" ]]; } || fail 'the log is not between the markers'
}
test_live_run_prints_no_untrusted_body() {
  printf 'boom\n::error::injected\n' > "$FAILURE_LOG_DIR/handoff.txt"
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create --title Claude Code 2.1.300 breaks handoff ' 1
  assert_out_lacks '::error::injected'
  assert_out_lacks '::stop-commands::'
}

# ---------------------------------------------------------------------------------------------
# The check step that records the version
# ---------------------------------------------------------------------------------------------
test_record_step_writes_the_bare_version_the_report_validates() {
  rm "$FAILURE_LOG_DIR/claude-version"
  mkdir -p "$TEST_DIR/bin" && cp "$STUBS/claude" "$TEST_DIR/bin/claude"
  printf 'STUB_LOG=%q\nSTUB_VERSION=2.1.411\n' "$TEST_DIR/stub-calls" > "$TEST_DIR/bin/stub.env"
  run_record_step "$TEST_DIR/bin:/usr/bin:/bin"
  assert_exit_code 0
  [[ "$(cat "$FAILURE_LOG_DIR/claude-version")" == 2.1.411 ]] || fail 'claude-version is not the bare version'
}
test_record_step_fails_and_leaves_no_version_when_claude_is_missing() {
  rm "$FAILURE_LOG_DIR/claude-version"
  run_record_step '/usr/bin:/bin'
  assert_exit_code_nonzero
  assert_no_file "$FAILURE_LOG_DIR/claude-version"
}

# ---------------------------------------------------------------------------------------------
# scripts/check.sh in CHECK_LOG_DIR mode
# ---------------------------------------------------------------------------------------------
test_ci_step_runs_check_sh_with_a_log_directory_the_report_job_reads() {
  # shellcheck disable=SC2016 # the workflow expression is matched literally
  grep -qF 'CHECK_LOG_DIR: ${{ runner.temp }}/failures' "$CI_YML" || fail 'the check step does not set CHECK_LOG_DIR to runner.temp/failures'
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURE_LOG_DIR" --
  assert_exit_code 0
  assert_file_exists "$FAILURE_LOG_DIR/checked"
}
test_failing_plugin_keeps_its_log_and_a_passing_plugin_log_is_removed() {
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURE_LOG_DIR" STUB_TSC_FAIL=a --
  assert_exit_code 1
  assert_file_has "$FAILURE_LOG_DIR/a.txt" 'FAILED: plugins/a: tsc -p exited 2'
  assert_file_has "$STUB_LOG" 'claude plugin test plugins/b'
  assert_no_file "$FAILURE_LOG_DIR/b.txt"
  assert_out_has 'FAILED: plugins/a: tsc -p exited 2'
}
test_checked_marker_is_written_after_every_plugin_is_tried_even_when_one_fails() {
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURE_LOG_DIR" STUB_TSC_FAIL=a --
  assert_exit_code 1
  assert_file_exists "$FAILURE_LOG_DIR/checked"
  assert_file_has "$STUB_LOG" 'tsc -p plugins/b'
  assert_file_has "$STUB_LOG" 'MARKER plugin=b checked=absent'
}
test_checked_marker_is_written_when_every_plugin_passes_and_no_log_remains() {
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURE_LOG_DIR" --
  assert_exit_code 0
  assert_file_exists "$FAILURE_LOG_DIR/checked"
  assert_no_file "$FAILURE_LOG_DIR/a.txt"
}
test_validate_failure_stops_that_plugin_before_tsc_and_keeps_the_log() {
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURE_LOG_DIR" STUB_VALIDATE_FAIL=a --
  assert_exit_code 1
  assert_file_has "$FAILURE_LOG_DIR/a.txt" 'FAILED: plugins/a: claude plugin validate exited 1'
  assert_file_lacks "$STUB_LOG" 'tsc -p plugins/a'
}
test_type_declaration_failure_lands_in_the_plugin_log() {
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURE_LOG_DIR" STUB_NO_TYPE_DECLARATIONS=a --
  assert_exit_code 1
  assert_file_has "$FAILURE_LOG_DIR/a.txt" 'The engine wrote no type declarations for plugins/a'
  assert_file_has "$FAILURE_LOG_DIR/a.txt" 'FAILED: plugins/a: type declarations exited 1'
  assert_file_lacks "$STUB_LOG" 'tsc -p plugins/a'
}
test_stale_type_declarations_are_removed_before_the_engine_regenerates_them() {
  make_repo a
  mkdir -p "$REPO_COPY/plugins/a/.claude-plugin/types/claude-code"
  echo stale > "$REPO_COPY/plugins/a/.claude-plugin/types/claude-code/index.d.ts"
  run_check_step CHECK_LOG_DIR="$FAILURE_LOG_DIR" STUB_NO_TYPE_DECLARATIONS=a --
  assert_exit_code 1
  assert_no_file "$REPO_COPY/plugins/a/.claude-plugin/types/claude-code/index.d.ts"
}
test_report_opens_a_canary_issue_for_a_type_declaration_failure() {
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURE_LOG_DIR" STUB_NO_TYPE_DECLARATIONS=a --
  mkdir -p "$TEST_DIR/bin" && cp "$STUBS/claude" "$TEST_DIR/bin/claude"
  printf 'STUB_LOG=%q\nSTUB_VERSION=2.1.300\n' "$TEST_DIR/stub-calls" > "$TEST_DIR/bin/stub.env"
  run_record_step "$TEST_DIR/bin:/usr/bin:/bin"
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create --title Claude Code 2.1.300 breaks a --body-file' 1
  assert_file_has "$TEST_DIR/issue-body.md" 'type declarations'
}
test_report_opens_a_canary_issue_for_a_tsc_failure_and_none_for_a_passing_plugin() {
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURE_LOG_DIR" STUB_TSC_FAIL=b --
  mkdir -p "$TEST_DIR/bin" && cp "$STUBS/claude" "$TEST_DIR/bin/claude"
  printf 'STUB_LOG=%q\nSTUB_VERSION=2.1.300\n' "$TEST_DIR/stub-calls" > "$TEST_DIR/bin/stub.env"
  run_record_step "$TEST_DIR/bin:/usr/bin:/bin"
  printf '%s\n' a b > "$GH_PLUGINS"
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create' 1
  assert_gh_call_count 'issue create --title Claude Code 2.1.300 breaks b' 1
  assert_file_has "$TEST_DIR/issue-body.md" 'TS2578'
}
test_unknown_plugin_name_writes_a_no_such_plugin_log_and_the_marker() {
  make_repo a b
  run_check_script CHECK_LOG_DIR="$FAILURE_LOG_DIR" -- nope
  assert_exit_code 1
  assert_file_has "$FAILURE_LOG_DIR/nope.txt" 'No such plugin: plugins/nope'
  assert_file_exists "$FAILURE_LOG_DIR/checked"
}
test_unknown_plugin_name_with_a_trailing_slash_writes_its_log_under_the_bare_name() {
  make_repo a b
  run_check_script CHECK_LOG_DIR="$FAILURE_LOG_DIR" -- nope/
  assert_exit_code 1
  assert_file_has "$FAILURE_LOG_DIR/nope.txt" 'No such plugin: plugins/nope'
  assert_file_exists "$FAILURE_LOG_DIR/checked"
}
test_failing_plugin_given_with_a_trailing_slash_keeps_its_log_under_the_bare_name() {
  make_repo a b
  run_check_script CHECK_LOG_DIR="$FAILURE_LOG_DIR" STUB_TSC_FAIL=a -- a/
  assert_exit_code 1
  assert_file_has "$FAILURE_LOG_DIR/a.txt" 'FAILED: plugins/a: tsc -p exited 2'
}
test_empty_plugin_name_writes_a_log_instead_of_only_the_marker() {
  make_repo a
  run_check_script CHECK_LOG_DIR="$FAILURE_LOG_DIR" -- ''
  assert_exit_code 1
  assert_file_has "$FAILURE_LOG_DIR/.txt" 'No such plugin'
}
test_missing_plugins_directory_exits_1_with_no_marker() {
  make_repo
  rmdir "$REPO_COPY/plugins"
  run_check_script CHECK_LOG_DIR="$FAILURE_LOG_DIR" --
  assert_exit_code 1
  assert_out_has 'No plugins found under'
  assert_no_file "$FAILURE_LOG_DIR/checked"
}
test_empty_plugins_directory_exits_1_with_no_marker() {
  make_repo
  run_check_script CHECK_LOG_DIR="$FAILURE_LOG_DIR" --
  assert_exit_code 1
  assert_out_has 'No plugins found under'
  assert_no_file "$FAILURE_LOG_DIR/checked"
}
test_missing_tsc_exits_1_and_says_how_to_install_it() {
  make_repo a
  rm "$REPO_COPY/node_modules/.bin/tsc"
  run_check_script CHECK_LOG_DIR="$FAILURE_LOG_DIR" --
  assert_exit_code 1
  assert_out_has "Run 'npm ci'"
  assert_no_file "$FAILURE_LOG_DIR/checked"
}

# ---------------------------------------------------------------------------------------------
# scripts/check.sh in local mode, and its arguments
# ---------------------------------------------------------------------------------------------
test_local_run_stops_at_the_first_failing_plugin() {
  make_repo a b
  run_check_script STUB_TSC_FAIL=a --
  assert_exit_code_nonzero
  assert_file_has "$STUB_LOG" 'tsc -p plugins/a'
  assert_out_has 'FAILED: plugins/a: tsc -p exited 2'
  assert_file_lacks "$STUB_LOG" 'plugins/b'
}
test_local_run_passes_when_every_plugin_passes() {
  make_repo a b
  run_check_script --
  assert_exit_code 0
  assert_file_has "$STUB_LOG" 'claude plugin test plugins/b'
}
test_local_run_checks_only_the_plugins_named() {
  make_repo a b
  run_check_script -- b
  assert_exit_code 0
  assert_file_has "$STUB_LOG" 'claude plugin test plugins/b'
  assert_file_lacks "$STUB_LOG" 'plugins/a'
}
test_local_run_from_another_directory_still_finds_the_plugins() {
  make_repo a
  write_stub_env
  EXIT_CODE=0
  (cd "$TEST_DIR" && env PATH="$REPO_COPY/bin:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" "$BASH" "$REPO_COPY/scripts/check.sh" a) > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  assert_exit_code 0
  assert_file_has "$STUB_LOG" 'claude plugin test plugins/a'
}
test_local_run_by_relative_path_ignores_an_exported_cdpath() {
  make_repo a
  write_stub_env
  mkdir -p "$TEST_DIR/decoy/scripts"
  EXIT_CODE=0
  (cd "$REPO_COPY" && env CDPATH="$TEST_DIR/decoy" PATH="$REPO_COPY/bin:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" "$BASH" scripts/check.sh a) > "$OUTPUT" 2>&1 || EXIT_CODE=$?
  assert_exit_code 0
  assert_file_has "$STUB_LOG" 'claude plugin test plugins/a'
}
test_engine_type_generation_runs_without_credentials_or_the_callers_config() {
  make_repo a b
  run_check_script CHECK_LOG_DIR="$FAILURE_LOG_DIR" --
  assert_exit_code 0
  assert_file_has "$STUB_LOG" 'GENENV plugin=a api_key=unset oauth=unset'
  assert_file_has "$STUB_LOG" 'GENENV plugin=b api_key=unset oauth=unset'
  assert_file_lacks "$STUB_LOG" '/caller-config'
  assert_file_has "$STUB_LOG" 'config_state=empty'
}
test_engine_type_generation_config_directory_is_removed_when_the_run_ends() {
  make_repo a b
  run_check_script STUB_TSC_FAIL=b --
  # macOS mktemp ignores TMPDIR, so the directory is found through the path the engine was given.
  local config_dir
  config_dir=$(sed -n 's/^GENENV plugin=a .* config=\([^ ]*\) .*/\1/p' "$STUB_LOG")
  [[ "$config_dir" == /* ]] || { fail "the engine was given no absolute config directory: '$config_dir'"; return; }
  [[ ! -e "$config_dir" ]] || fail "check.sh left its config directory behind: $config_dir"
  [[ -z "$(find "$TEST_DIR/tmp" -mindepth 1)" ]] || fail "check.sh left entries in TMPDIR: $(find "$TEST_DIR/tmp" -mindepth 1)"
}

test_invalid_version_dry_run_does_not_claim_there_were_no_failure_logs() {
  echo 'Claude Code 2.1.300' > "$FAILURE_LOG_DIR/claude-version"
  add_failure_log handoff
  run_report true
  assert_exit_code 1
  assert_out_has 'failing_logs=1'
  assert_out_lacks 'no failure logs'
}
test_invalid_version_run_says_how_many_failing_logs_it_left_unopened() {
  echo bad > "$FAILURE_LOG_DIR/claude-version"
  add_failure_log handoff
  add_failure_log a
  run_report false
  assert_exit_code 1
  assert_out_has 'Opening no issues for 2 failing logs because the version is invalid.'
}

test_cap_count_after_a_failed_creation_counts_only_the_issues_that_opened() {
  local plugin
  for plugin in a b c d; do add_failure_log "$plugin" x; done
  echo 'Claude Code 2.1.300 breaks a' > "$GH_FAIL_CREATE_TITLES"
  run_report false MAX_ISSUES=2
  assert_out_has 'Opened 2 issues, the cap; 1 more failing plugins were left unopened: d'
}
test_failed_issue_creation_does_not_use_up_the_cap() {
  local plugin
  for plugin in a b c; do add_failure_log "$plugin" x; done
  echo 'Claude Code 2.1.300 breaks a' > "$GH_FAIL_CREATE_TITLES"
  run_report false MAX_ISSUES=2
  assert_exit_code 1
  assert_gh_call_count 'issue create --title Claude Code 2.1.300 breaks b' 1
  assert_gh_call_count 'issue create --title Claude Code 2.1.300 breaks c' 1
  assert_out_lacks 'left unopened'
}

test_dedupe_finds_an_open_issue_beyond_the_first_page_of_results() {
  local i
  for i in $(seq 1 40); do echo "Unrelated issue $i" >> "$GH_OPEN_TITLES"; done
  add_failure_log handoff
  mark_issue_open handoff
  run_report false
  assert_gh_call_count 'issue create' 0
}
test_dedupe_reads_the_issue_listing_and_not_the_lagging_search_index() {
  add_failure_log handoff
  mark_issue_open handoff
  run_report false
  assert_gh_call_count 'issue create' 0
  ! grep -q -- '--search' "$GH_CALLS" || fail 'the dedupe queried the search index'
}
test_dedupe_runs_before_the_cap_so_an_open_issue_is_not_counted_as_left_unopened() {
  local plugin
  for plugin in a b c d e f; do add_failure_log "$plugin" x; done
  mark_issue_open f
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create' 5
  assert_out_lacks 'left unopened'
}
test_dry_run_reports_an_issue_that_is_already_open() {
  add_failure_log handoff
  mark_issue_open handoff
  run_report true
  assert_exit_code 0
  assert_out_has 'dry run: issue already open for Claude Code 2.1.300 breaks handoff'
}
test_open_issue_with_the_exact_title_is_not_opened_again() {
  add_failure_log handoff
  mark_issue_open handoff
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create' 0
  assert_out_has 'Issue already open for Claude Code 2.1.300 breaks handoff; not opening another.'
}

test_dot_dot_name_is_rejected() {
  make_repo a
  run_check_script -- ..
  assert_exit_code 1
  assert_out_has 'Invalid plugin name'
}
test_doubled_plugins_prefix_is_rejected() {
  make_repo a
  run_check_script -- plugins/plugins/a
  assert_exit_code 1
  assert_out_has 'Invalid plugin name'
}
test_nested_name_is_rejected() {
  make_repo a
  mkdir -p "$REPO_COPY/plugins/a/b"
  run_check_script -- a/b
  assert_exit_code 1
  assert_out_has 'Invalid plugin name'
}
test_parent_directory_name_is_rejected_before_any_check_runs() {
  make_repo a
  mkdir -p "$REPO_COPY/x/.claude-plugin"
  run_check_script -- ../x
  assert_exit_code 1
  assert_out_has 'Invalid plugin name'
  assert_file_lacks "$STUB_LOG" 'plugins/../x'
}
test_plugins_prefix_in_log_mode_writes_the_log_under_the_bare_name() {
  make_repo a b
  run_check_script CHECK_LOG_DIR="$FAILURE_LOG_DIR" STUB_TSC_FAIL=a -- plugins/a
  assert_exit_code 1
  assert_file_has "$FAILURE_LOG_DIR/a.txt" 'FAILED: plugins/a: tsc -p exited 2'
}
test_plugins_prefix_is_accepted_the_same_as_the_bare_name() {
  make_repo a b
  run_check_script -- plugins/a
  assert_exit_code 0
  assert_file_has "$STUB_LOG" 'claude plugin test plugins/a'
  assert_file_lacks "$STUB_LOG" 'plugins/plugins'
}
test_rejected_name_in_log_mode_writes_a_log_inside_the_log_directory() {
  make_repo a
  mkdir -p "$REPO_COPY/x/.claude-plugin"
  run_check_script CHECK_LOG_DIR="$FAILURE_LOG_DIR" -- ../x
  assert_exit_code 1
  assert_file_has "$FAILURE_LOG_DIR/.._x.txt" 'Invalid plugin name'
  assert_file_exists "$FAILURE_LOG_DIR/checked"
}

test_dot_name_is_rejected_instead_of_checking_the_plugins_directory() {
  make_repo a
  run_check_script -- .
  assert_exit_code 1
  assert_out_has 'Invalid plugin name'
  assert_file_lacks "$STUB_LOG" 'plugin validate plugins/.'
}

test_all_pass_log_still_opens_an_issue_as_the_ci_yml_comment_promises() {
  add_failure_log handoff '(pass) every line passed'
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create --title Claude Code 2.1.300 breaks handoff' 1
}
test_empty_log_still_opens_an_issue() {
  : > "$FAILURE_LOG_DIR/handoff.txt"
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create --title Claude Code 2.1.300 breaks handoff' 1
}

# run_report_with_failing_grep <pattern> <dry_run>: a grep given exactly that pattern exits 2, as
# on a read error. Every other grep runs normally.
run_report_with_failing_grep() {
  mkdir -p "$TEST_DIR/bin"
  # shellcheck disable=SC2016 # the wrapper's $@ and $arg expand when the wrapper runs
  printf '#!/usr/bin/env bash\nfor arg in "$@"; do [ "$arg" != "$GREP_FAIL_PATTERN" ] || { echo "grep: read error" >&2; exit 2; }; done\nexec %q "$@"\n' \
    "$(command -v grep)" > "$TEST_DIR/bin/grep"
  chmod +x "$TEST_DIR/bin/grep"
  run_report "$2" PATH="$TEST_DIR/bin:$STUBS:$PATH" GREP_FAIL_PATTERN="$1"
}
test_read_error_while_dropping_passing_lines_skips_the_plugin_and_fails_the_job() {
  add_failure_log handoff
  run_report_with_failing_grep '^(pass) ' false
  assert_exit_code 1
  assert_out_has 'Failed to read the log for handoff; not opening an issue.'
  assert_gh_call_count 'issue create' 0
}
test_read_error_while_measuring_backtick_runs_skips_the_plugin_and_fails_the_job() {
  add_failure_log handoff
  run_report_with_failing_grep '`*' false
  assert_exit_code 1
  assert_out_has 'Failed to read the log for handoff; not opening an issue.'
  assert_gh_call_count 'issue create' 0
}
test_read_error_on_a_log_does_not_stop_the_job_before_the_next_log() {
  add_failure_log a
  add_failure_log b
  run_report_with_failing_grep '`*' false
  assert_exit_code 1
  assert_out_has 'Failed to read the log for a;'
  assert_out_has 'Failed to read the log for b;'
}
test_plugin_is_found_among_a_listing_larger_than_a_pipe_buffer() {
  local i
  for i in $(seq 1 20000); do echo "zz-plugin-$i"; done > "$GH_PLUGINS"
  echo handoff >> "$GH_PLUGINS"
  add_failure_log handoff
  run_report false
  assert_exit_code 0
  assert_gh_call_count 'issue create' 1
}

# ---------------------------------------------------------------------------------------------
for test_function in $(declare -F | awk '{print $3}' | grep '^test_'); do
  [[ -z "$TEST_NAME_FILTER" || "$test_function" == *"$TEST_NAME_FILTER"* ]] || continue
  DID_TEST_FAIL=0
  FAILURE_DETAILS=''
  setup
  "$test_function"
  TEST_COUNT=$((TEST_COUNT + 1))
  if [[ "$DID_TEST_FAIL" == 0 ]]; then
    echo "PASS $test_function"
  else
    FAILED_TEST_COUNT=$((FAILED_TEST_COUNT + 1))
    echo "FAIL $test_function"
    printf '%s' "$FAILURE_DETAILS"
    # The end of the output is where the report script says what it decided.
    echo '      last lines of output:'
    sed 's/^/        | /' "$OUTPUT" 2> /dev/null | tail -n 30
    FAILED_TEST_NAMES="${FAILED_TEST_NAMES:-}    $test_function"$'\n'
  fi
done
echo "$((TEST_COUNT - FAILED_TEST_COUNT)) of $TEST_COUNT passed"
[[ -z "${FAILED_TEST_NAMES:-}" ]] || printf 'Failed tests:\n%s' "$FAILED_TEST_NAMES"
[[ "$TEST_COUNT" -gt 0 ]] || { echo "No tests ran. No test name contains '$TEST_NAME_FILTER'." >&2; exit 1; }
[[ "$FAILED_TEST_COUNT" == 0 ]]
