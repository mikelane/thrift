#!/usr/bin/env bash
# Regression harness for the canary path in .github/workflows/ci.yml: the "open canary issues"
# (`report`) job and the `scripts/check.sh` run that feeds it.
#
# The `report` job checks out nothing, so its script has to stay inline in ci.yml. This harness
# pulls the real step scripts out of ci.yml and runs them under `bash -eo pipefail`, the shell
# Actions uses, with a stub `gh` and a stub `claude` and `tsc`. No network and no API key.
#
# Usage: .github/tests/canary-report.sh [name-fragment]   (runs the tests whose name contains it)
# CANARY_CI_YML points the harness at another copy of ci.yml, which is how the extraction guard
# is exercised: a step that was renamed or re-indented makes this script exit 2.
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$HERE/../.." && pwd)
CI_YML=${CANARY_CI_YML:-$REPO_ROOT/.github/workflows/ci.yml}
CHECK_SH=$REPO_ROOT/scripts/check.sh
FILTER=${1:-}

REPORT_STEP='Open an issue for each plugin the new build breaks'
RECORD_STEP='Record the Claude Code version for the canary issue job'
CHECK_STEP='Check every plugin with scripts/check.sh'

for tool in jq openssl; do
  command -v "$tool" > /dev/null || { echo "The harness needs $tool on PATH." >&2; exit 2; }
done

# Prints the body of one step's `run:` from a workflow file, de-indented. Exits 1, and says why,
# when the step is not found at the indentation the workflow uses, so a renamed or re-indented
# step fails the harness instead of leaving it with nothing to test.
extract_step() {
  local ci_yml="$1" step_name="$2" script
  script=$(awk -v want="      - name: $step_name" '
    state == 0 { if ($0 == want) state = 1; next }
    state == 1 {
      if ($0 == "        run: |") { state = 2; next }
      if (index($0, "        run: ") == 1) { print substr($0, 14); exit }
      if ($0 ~ /^      - / || $0 ~ /^  [A-Za-z]/) exit
      next
    }
    state == 2 {
      if ($0 == "") { print ""; next }
      if (substr($0, 1, 10) == "          ") { print substr($0, 11); next }
      exit
    }' "$ci_yml")
  if [[ -z "$script" ]]; then
    echo "Could not extract the step '$step_name' from $ci_yml. Was it renamed or re-indented?" >&2
    return 1
  fi
  printf '%s\n' "$script"
}

# Prints the value of one `KEY: value` setting of the report step.
workflow_setting() {
  local value
  value=$(sed -n "s/^          $1: //p" "$CI_YML" | head -n 1)
  [[ -n "$value" ]] || { echo "Could not read $1 from $CI_YML." >&2; return 1; }
  printf '%s\n' "$value"
}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

extract_or_die() {
  local step_name="$1" must_contain="$2" target="$3"
  extract_step "$CI_YML" "$step_name" > "$target" || exit 2
  grep -qF -- "$must_contain" "$target" || {
    echo "The step '$step_name' no longer contains '$must_contain', so the harness would test the wrong script." >&2
    exit 2
  }
}
extract_or_die "$REPORT_STEP" 'gh issue create' "$WORK/report.sh"
extract_or_die "$RECORD_STEP" 'claude-version' "$WORK/record.sh"
extract_or_die "$CHECK_STEP" 'scripts/check.sh' "$WORK/check-step.sh"
MAX_ISSUES=$(workflow_setting MAX_ISSUES) || exit 2
MAX_FENCE=$(workflow_setting MAX_FENCE) || exit 2

# ---------------------------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------------------------
STUBS=$WORK/stubs
mkdir -p "$STUBS"

# `gh issue list` applies --limit and --jq like the real CLI. A --search query reads an index that
# lags behind the issues themselves, so the stub answers it with nothing.
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
    limit=30 search='' expr='.'
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --limit) limit=$2; shift ;;
        --search) search=$2; shift ;;
        --jq) expr=$2; shift ;;
      esac
      shift
    done
    [ -z "${GH_LIST_FAIL:-}" ] || exit 1
    titles=$GH_OPEN_TITLES
    [ -z "$search" ] || titles=/dev/null
    jq -R '{title: .}' "$titles" | jq -s ".[:$limit]" | jq -r "$expr"
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
listed() { [[ " ${1:-} " == *" $2 "* ]]; }
if [ "${1:-}" = --version ]; then echo "${STUB_VERSION:-2.1.300} (Claude Code)"; exit 0; fi
if [ "${1:-}" = -p ]; then
  dir=$4
  name=$(basename "$dir")
  config_state=missing
  [ -d "${CLAUDE_CONFIG_DIR:-/nonexistent}" ] && config_state=empty
  [ -z "$(ls -A "${CLAUDE_CONFIG_DIR:-/nonexistent}" 2> /dev/null)" ] || config_state=not-empty
  echo "GENENV plugin=$name api_key=${ANTHROPIC_API_KEY-unset} oauth=${CLAUDE_CODE_OAUTH_TOKEN-unset} config=${CLAUDE_CONFIG_DIR-unset} config_state=$config_state" >> "$STUB_LOG"
  listed "${STUB_NO_DECLS:-}" "$name" || {
    mkdir -p "$dir/.claude-plugin/types/claude-code"
    : > "$dir/.claude-plugin/types/claude-code/index.d.ts"
  }
  echo "Not logged in"
  exit 1
fi
name=$(basename "$3")
if [ "$2" = validate ]; then
  listed "${STUB_VALIDATE_FAIL:-}" "$name" && { echo "validate refused $name"; exit 1; }
  echo ok; exit 0
fi
if [ "$2" = test ]; then
  listed "${STUB_TEST_FAIL:-}" "$name" && { echo "(fail) a test in $name"; exit 1; }
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
FAILED=0
DETAILS=''
total=0
failures=0

fail() {
  FAILED=1
  DETAILS="${DETAILS}    - $*"$'\n'
}
assert_rc() { [[ "$RC" == "$1" ]] || fail "exit code was $RC, expected $1"; }
assert_rc_nonzero() { [[ "$RC" != 0 ]] || fail 'exit code was 0, expected a failure'; }
assert_out_has() { grep -qaF -- "$1" "$OUT" || fail "output lacks: $1"; }
assert_out_lacks() { ! grep -qaF -- "$1" "$OUT" || fail "output has: $1"; }
assert_file_has() { grep -qaF -- "$2" "$1" || fail "${1#"$T"/} lacks: $2"; }
assert_file_lacks() { ! grep -qaF -- "$2" "$1" || fail "${1#"$T"/} has: $2"; }
assert_file_exists() { [[ -e "$1" ]] || fail "${1#"$T"/} does not exist"; }
assert_no_file() { [[ ! -e "$1" ]] || fail "${1#"$T"/} exists"; }
gh_call_count() { grep -c -- "^gh $1" "$GH_CALLS" || true; }
assert_gh_calls() {
  local count
  count=$(gh_call_count "$1")
  [[ "$count" == "$2" ]] || fail "gh '$1' ran $count times, expected $2"
}
assert_fence_lines() { # assert_fence_lines <file> <fence> <count>
  local count
  count=$(grep -acxF -- "$2" "$1" || true)
  [[ "$count" == "$3" ]] || fail "expected $3 lines of exactly ${#2} backticks in ${1#"$T"/}, found $count"
}

repeat_char() { head -c "$2" /dev/zero | tr '\0' "$1"; }
backtick_run() { repeat_char '`' "$1"; }

# Gives each test its own runner temp directory with a clean artifact, as `check (latest)` leaves it.
setup() {
  T=$(mktemp -d "$WORK/t.XXXXXX")
  FAILURES=$T/failures
  OUT=$T/out
  GH_CALLS=$T/gh-calls
  GH_OPEN_TITLES=$T/open-titles
  GH_PLUGINS=$T/repo-plugins
  GH_FAIL_CREATE_TITLES=$T/fail-create-titles
  mkdir -p "$FAILURES"
  : > "$GH_CALLS"
  : > "$GH_OPEN_TITLES"
  : > "$GH_FAIL_CREATE_TITLES"
  printf '%s\n' handoff a b c d e f g h p1 p2 p3 p4 p5 p6 p7 p8 > "$GH_PLUGINS"
  touch "$FAILURES/checked"
  echo 2.1.300 > "$FAILURES/claude-version"
}

add_log() { printf '%s\n' "${2:-boom}" > "$FAILURES/$1.txt"; }
mark_open() { echo "Claude Code 2.1.300 breaks $1" >> "$GH_OPEN_TITLES"; }

# run_report <true|false> [VAR=value ...]: the extracted report script, as Actions runs it.
run_report() {
  local dry_run="$1" locale=C.UTF-8
  shift
  # macOS has no C.UTF-8, and its tr rejects invalid UTF-8 under a UTF-8 locale. The runner is
  # Linux, so only the macOS run of this harness falls back to the C locale.
  [[ "$(uname -s)" != Darwin ]] || locale=C
  RC=0
  (cd "$T" && env \
    RUNNER_TEMP="$T" GH_REPO=o/r GITHUB_SHA=abc123 DRY_RUN="$dry_run" \
    MAX_ISSUES="$MAX_ISSUES" MAX_FENCE="$MAX_FENCE" \
    GITHUB_SERVER_URL=https://github.com GITHUB_REPOSITORY=o/r GITHUB_RUN_ID=42 \
    GH_CALLS="$GH_CALLS" GH_OPEN_TITLES="$GH_OPEN_TITLES" GH_PLUGINS="$GH_PLUGINS" \
    GH_FAIL_CREATE_TITLES="$GH_FAIL_CREATE_TITLES" PATH="$STUBS:$PATH" LC_ALL="$locale" \
    ${1+"$@"} \
    "$BASH" --noprofile --norc -eo pipefail "$WORK/report.sh") > "$OUT" 2>&1 || RC=$?
}

# A copy of the repo with check.sh, a stub tsc and a stub claude, and the given plugin directories.
make_repo() {
  REPO=$T/repo
  mkdir -p "$REPO/scripts" "$REPO/node_modules/.bin" "$REPO/bin" "$REPO/plugins" "$T/tmp" "$T/home"
  cp "$CHECK_SH" "$REPO/scripts/check.sh"
  chmod +x "$REPO/scripts/check.sh"
  cp "$STUBS/tsc" "$REPO/node_modules/.bin/tsc"
  cp "$STUBS/claude" "$REPO/bin/claude"
  rm -f "$FAILURES/checked" "$FAILURES/claude-version"
  rm -f "$FAILURES/checked" "$FAILURES/claude-version"
  STUB_LOG=$T/stub-calls
  : > "$STUB_LOG"
  local plugin
  for plugin in "$@"; do mkdir -p "$REPO/plugins/$plugin/.claude-plugin"; done
}

# run_check <script> [VAR=value ...] -- [argument ...]: the script runs from the repo root with a
# caller environment that holds credentials, to show check.sh keeps them away from the engine.
run_check() {
  local script="$1" settings=() setting
  shift
  while [[ "$1" != -- ]]; do settings+=("$1"); shift; done
  shift
  { printf 'STUB_LOG=%q\n' "$STUB_LOG"
    for setting in ${settings[@]+"${settings[@]}"}; do
      [[ "$setting" == STUB_* ]] && printf '%s=%q\n' "${setting%%=*}" "${setting#*=}"
    done; } > "$REPO/bin/stub.env"
  cp "$REPO/bin/stub.env" "$REPO/node_modules/.bin/stub.env"
  RC=0
  (cd "$REPO" && env \
    PATH="$REPO/bin:/usr/bin:/bin" HOME="$T/home" TMPDIR="$T/tmp" \
    ANTHROPIC_API_KEY=leaked CLAUDE_CODE_OAUTH_TOKEN=leaked CLAUDE_CONFIG_DIR=/caller-config \
    ${settings[@]+"${settings[@]}"} \
    "$BASH" --noprofile --norc -eo pipefail "$script" ${1+"$@"}) > "$OUT" 2>&1 || RC=$?
}
run_check_script() { run_check "$REPO/scripts/check.sh" "$@"; }
run_check_step() { run_check "$WORK/check-step.sh" "$@"; }

run_record_step() {
  RC=0
  (cd "$T" && env RUNNER_TEMP="$T" PATH="$1" "$BASH" --noprofile --norc -eo pipefail "$WORK/record.sh") > "$OUT" 2>&1 || RC=$?
}

# ---------------------------------------------------------------------------------------------
# Extraction guard
# ---------------------------------------------------------------------------------------------
test_extraction_finds_the_report_step_in_the_real_workflow() {
  extract_step "$CI_YML" "$REPORT_STEP" > "$T/out" 2>&1 || fail 'extraction failed'
  assert_file_has "$T/out" 'gh issue create'
}
test_extraction_fails_when_the_step_is_renamed() {
  sed 's/- name: Open an issue for each plugin/- name: Open issues for each plugin/' "$CI_YML" > "$T/ci.yml"
  extract_step "$T/ci.yml" "$REPORT_STEP" > "$T/out" 2>&1 && fail 'extraction passed on a renamed step'
  return 0
}
test_extraction_fails_when_the_workflow_is_re_indented() {
  sed 's/^/  /' "$CI_YML" > "$T/ci.yml"
  extract_step "$T/ci.yml" "$REPORT_STEP" > "$T/out" 2>&1 && fail 'extraction passed on a re-indented workflow'
  return 0
}
test_extraction_fails_when_the_run_block_is_replaced_by_a_uses_step() {
  sed 's/^        run: |$/        with: |/' "$CI_YML" > "$T/ci.yml"
  extract_step "$T/ci.yml" "$REPORT_STEP" > "$T/out" 2>&1 && fail 'extraction passed with no run block'
  return 0
}
test_harness_exits_2_when_the_workflow_it_is_pointed_at_lost_a_step() {
  sed 's/- name: Open an issue for each plugin/- name: Open issues for each plugin/' "$CI_YML" > "$T/ci.yml"
  RC=0
  CANARY_CI_YML="$T/ci.yml" "$BASH" "${BASH_SOURCE[0]}" nothing-matches > "$OUT" 2>&1 || RC=$?
  assert_rc 2
  assert_out_has 'Could not extract the step'
}
test_report_job_checks_out_nothing_and_keeps_its_script_inline() {
  local job
  job=$(awk '/^  report:/{f=1;next} f&&/^  [A-Za-z]/{exit} f' "$CI_YML")
  [[ "$job" != *'actions/checkout'* ]] || fail 'the report job checks out the repository'
  [[ "$job" != *'scripts/'* ]] || fail 'the report job runs a script from the repository'
}

# ---------------------------------------------------------------------------------------------
# Report job: which logs become issues
# ---------------------------------------------------------------------------------------------
test_live_run_opens_an_issue_titled_with_the_version_and_plugin() {
  add_log handoff
  run_report false
  assert_rc 0
  assert_gh_calls 'issue create --title Claude Code 2.1.300 breaks handoff --body-file' 1
  assert_out_lacks 'dry run'
}
test_dry_run_prints_the_issue_instead_of_opening_it() {
  add_log handoff 'tsc error TS2322'
  run_report true
  assert_rc 0
  assert_out_has 'dry run: would open an issue titled: Claude Code 2.1.300 breaks handoff'
  assert_out_has 'TS2322'
  assert_gh_calls 'issue create' 0
}
test_dry_run_with_no_failure_logs_says_there_is_nothing_to_open() {
  run_report true
  assert_rc 0
  assert_out_has 'dry run: no failure logs, nothing to open'
}
test_live_run_with_no_failure_logs_opens_nothing_and_passes() {
  run_report false
  assert_rc 0
  assert_gh_calls 'issue create' 0
}
test_issue_body_names_the_canary_and_links_the_run() {
  add_log handoff
  run_report true
  assert_file_has "$T/issue-body.md" "The canary ran handoff's checks against Claude Code 2.1.300"
  assert_file_has "$T/issue-body.md" 'https://github.com/o/r/actions/runs/42'
}
test_log_with_a_bad_name_is_skipped_and_the_job_fails_but_a_good_log_is_opened() {
  add_log handoff
  add_log 'Bad Name'
  add_log -lead
  run_report false
  assert_rc 1
  assert_gh_calls 'issue create' 1
  assert_out_has 'Skipping an untrusted log: Bad\ Name'
}
test_log_named_after_a_unicode_lookalike_is_skipped() {
  add_log "hand$(printf '\xc3\xb6')ff"
  run_report false
  assert_rc 1
  assert_gh_calls 'issue create' 0
}
test_log_name_with_an_embedded_newline_is_skipped_and_cannot_start_a_workflow_command() {
  add_log $'a\n::error::forged'
  run_report false
  assert_rc 1
  assert_gh_calls 'issue create' 0
  ! grep -q '^::error::' "$OUT" || fail 'a forged workflow command starts a line of output'
}
test_log_name_that_only_matches_after_command_substitution_trims_a_newline_is_skipped() {
  add_log $'handoff\n'
  run_report false
  assert_rc 1
  assert_gh_calls 'issue create' 0
  assert_out_has 'Skipping an untrusted log'
}
test_log_for_a_plugin_missing_from_the_repository_is_skipped() {
  add_log ghost
  run_report false
  assert_rc 1
  assert_gh_calls 'issue create' 0
  assert_out_has 'Skipping an untrusted log: ghost'
}
test_log_named_after_a_prefix_of_a_real_plugin_is_skipped() {
  add_log hand
  run_report false
  assert_rc 1
  assert_gh_calls 'issue create' 0
}
test_symlinked_log_is_skipped() {
  echo secret > "$T/target"
  ln -s "$T/target" "$FAILURES/handoff.txt"
  run_report false
  assert_rc 1
  assert_gh_calls 'issue create' 0
  assert_out_has 'Skipping an untrusted log: handoff'
}
test_log_that_is_a_directory_is_skipped() {
  mkdir "$FAILURES/handoff.txt"
  run_report false
  assert_rc 1
  assert_gh_calls 'issue create' 0
}
test_failure_to_list_the_repository_plugins_opens_nothing_and_fails() {
  add_log handoff
  run_report false GH_API_FAIL=1
  assert_rc 1
  assert_out_has 'Failed to list the plugins in the repository.'
  assert_gh_calls 'issue create' 0
}

# ---------------------------------------------------------------------------------------------
# Report job: the cap and the dedupe
# ---------------------------------------------------------------------------------------------
test_cap_opens_the_maximum_and_fails_naming_the_rest() {
  local i
  for i in 1 2 3 4 5 6 7 8; do add_log "p$i" x; done
  run_report false
  assert_rc 1
  assert_gh_calls 'issue create' "$MAX_ISSUES"
  assert_out_has "Opened $MAX_ISSUES issues, the cap; $((8 - MAX_ISSUES)) more failing plugins were left unopened"
}
test_dry_run_cap_says_would_open() {
  local i
  for i in 1 2 3 4 5 6 7 8; do add_log "p$i" x; done
  run_report true
  assert_rc 1
  assert_out_has "Would open $MAX_ISSUES issues, the cap"
}
test_bad_name_and_cap_together_fail_and_still_open_the_maximum() {
  local i
  for i in 1 2 3 4 5 6 7; do add_log "p$i" x; done
  add_log BAD x
  run_report false
  assert_rc 1
  assert_gh_calls 'issue create' "$MAX_ISSUES"
  assert_out_has 'BAD'
}
test_open_issue_whose_title_only_contains_the_title_does_not_block_a_new_one() {
  add_log handoff
  echo 'Re: Claude Code 2.1.300 breaks handoff badly' >> "$GH_OPEN_TITLES"
  echo 'Claude Code 2.1.300 breaks handoff-extras' >> "$GH_OPEN_TITLES"
  run_report false
  assert_rc 0
  assert_gh_calls 'issue create' 1
}
test_open_issue_for_another_version_does_not_block_a_new_one() {
  add_log handoff
  echo 'Claude Code 2.1.299 breaks handoff' >> "$GH_OPEN_TITLES"
  run_report false
  assert_gh_calls 'issue create' 1
}
test_failure_to_list_issues_skips_that_plugin_and_fails() {
  add_log handoff
  run_report false GH_LIST_FAIL=1
  assert_rc 1
  assert_out_has 'Failed to list issues for Claude Code 2.1.300 breaks handoff'
  assert_gh_calls 'issue create' 0
}

# ---------------------------------------------------------------------------------------------
# Report job: the marker and the version
# ---------------------------------------------------------------------------------------------
test_missing_checked_marker_fails_with_a_message_even_when_there_are_no_logs() {
  rm "$FAILURES/checked"
  run_report true
  assert_rc 1
  assert_out_has 'did not reach the plugin checks'
}
test_missing_checked_marker_still_opens_the_issues_it_has_logs_for_and_fails() {
  rm "$FAILURES/checked"
  add_log handoff
  run_report false
  assert_rc 1
  assert_gh_calls 'issue create' 1
}
test_empty_version_opens_nothing_and_fails() {
  : > "$FAILURES/claude-version"
  add_log handoff
  run_report false
  assert_rc 1
  assert_gh_calls 'issue create' 0
}
test_version_file_holding_a_second_line_opens_nothing_and_fails() {
  printf '2.1.300\nevil' > "$FAILURES/claude-version"
  add_log handoff
  run_report false
  assert_rc 1
  assert_gh_calls 'issue create' 0
}
test_missing_version_file_opens_nothing_and_fails() {
  rm "$FAILURES/claude-version"
  add_log handoff
  run_report false
  assert_rc 1
  assert_gh_calls 'issue create' 0
}
test_version_with_a_suffix_is_rejected() {
  echo '2.1.300-beta' > "$FAILURES/claude-version"
  run_report true
  assert_rc 1
  assert_out_has 'Unexpected Claude Code version'
}
test_version_with_one_component_is_accepted() {
  echo 3 > "$FAILURES/claude-version"
  add_log handoff
  run_report false
  assert_rc 0
  assert_gh_calls 'issue create --title Claude Code 3 breaks handoff' 1
}
# %q does not escape ':', so a version that starts with '::' is safe only because the text before
# it on the same line keeps the runner from reading the line as a workflow command.
test_invalid_version_is_printed_after_a_text_prefix_so_it_cannot_start_a_workflow_command() {
  printf '::error::forged\n::warning::forged' > "$FAILURES/claude-version"
  run_report true
  assert_rc 1
  assert_out_has 'Unexpected Claude Code version: '
  ! grep -q '^::' "$OUT" || fail 'a line of output starts with ::'
  assert_out_has 'Canary summary: mode=dry-run version='
}

# ---------------------------------------------------------------------------------------------
# Report job: creating issues
# ---------------------------------------------------------------------------------------------
test_failed_issue_creation_is_reported_and_fails_the_job() {
  add_log handoff
  echo 'Claude Code 2.1.300 breaks handoff' > "$GH_FAIL_CREATE_TITLES"
  run_report false
  assert_rc 1
  assert_out_has 'Failed to create an issue for Claude Code 2.1.300 breaks handoff'
}

# ---------------------------------------------------------------------------------------------
# Report job: the log inside the issue body
# ---------------------------------------------------------------------------------------------
test_plain_log_gets_a_three_backtick_fence() {
  add_log handoff
  run_report true
  assert_fence_lines "$T/issue-body.md" '```' 2
}
test_log_with_a_three_backtick_line_gets_a_longer_fence() {
  printf 'error\n```\n@someone please look at #1\n' > "$FAILURES/handoff.txt"
  run_report true
  assert_fence_lines "$T/issue-body.md" '````' 2
}
test_log_with_a_five_backtick_run_gets_a_six_backtick_fence() {
  printf 'a\n`````\n@someone\n' > "$FAILURES/handoff.txt"
  run_report true
  assert_fence_lines "$T/issue-body.md" '``````' 2
}
test_log_with_tildes_does_not_need_a_longer_fence() {
  printf 'a\n~~~\nb\n' > "$FAILURES/handoff.txt"
  run_report true
  assert_fence_lines "$T/issue-body.md" '```' 2
}
test_fence_holds_when_the_log_has_invalid_utf8() {
  printf 'error \xff\n```\n@someone [click](https://evil.example)\n' > "$FAILURES/handoff.txt"
  run_report true
  assert_fence_lines "$T/issue-body.md" '````' 2
}
test_fence_holds_when_the_log_has_a_nul_byte() {
  printf 'error \0\n```\n@someone\n' > "$FAILURES/handoff.txt"
  run_report true
  assert_fence_lines "$T/issue-body.md" '````' 2
}
test_fence_holds_when_the_tail_cuts_a_multibyte_character() {
  # 3 + 59983 + 15 bytes: the 60000-byte tail starts on the second byte of the 3-byte character.
  { printf '\xe2\x9c\x93'; repeat_char a 59983; printf '\n```\n@someone\n'; } > "$FAILURES/handoff.txt"
  run_report true
  assert_fence_lines "$T/issue-body.md" '````' 2
}
test_fence_closes_on_its_own_line_when_the_log_has_no_trailing_newline() {
  printf 'no newline at the end' > "$FAILURES/handoff.txt"
  run_report true
  assert_fence_lines "$T/issue-body.md" '```' 2
  assert_file_has "$T/issue-body.md" 'no newline at the end'
}
test_log_with_a_backtick_run_one_short_of_the_limit_is_included_in_a_fence_of_the_limit() {
  { repeat_char a 59000; echo; backtick_run $((MAX_FENCE - 1)); echo; } > "$FAILURES/handoff.txt"
  run_report true
  assert_file_lacks "$T/issue-body.md" 'withheld'
  assert_fence_lines "$T/issue-body.md" "$(backtick_run "$MAX_FENCE")" 2
  [[ "$(wc -c < "$T/issue-body.md")" -le 65536 ]] || fail 'the body is over 65536 characters'
}
test_log_with_a_backtick_run_at_the_limit_is_withheld_and_links_the_run() {
  { echo before; backtick_run "$MAX_FENCE"; echo; echo @someone; } > "$FAILURES/handoff.txt"
  run_report true
  assert_file_has "$T/issue-body.md" 'withheld'
  assert_file_has "$T/issue-body.md" 'https://github.com/o/r/actions/runs/42'
  assert_file_lacks "$T/issue-body.md" '@someone'
}
test_eighty_kilobyte_plain_log_keeps_the_body_under_the_github_limit() {
  awk 'BEGIN { for (i = 0; i < 1300; i++) printf "line %d %s\n", i, "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }' > "$FAILURES/handoff.txt"
  [[ "$(wc -c < "$FAILURES/handoff.txt")" -ge 80000 ]] || fail 'the fixture is under 80 KB'
  run_report true
  [[ "$(wc -c < "$T/issue-body.md")" -le 65536 ]] || fail 'the body is over 65536 characters'
  assert_file_has "$T/issue-body.md" 'line 1299'
}
test_passing_test_lines_do_not_push_the_failing_test_out_of_the_tail() {
  { awk 'BEGIN { for (i = 0; i < 3000; i++) print "(pass) a test that passed" }'; echo '(fail) the test that broke'; } > "$FAILURES/handoff.txt"
  run_report true
  assert_file_has "$T/issue-body.md" '(fail) the test that broke'
  assert_file_lacks "$T/issue-body.md" '(pass) '
}
test_untrusted_log_is_printed_between_stop_commands_markers() {
  printf 'boom\n::error::injected\n' > "$FAILURES/handoff.txt"
  run_report true
  local start token end injected
  start=$(grep -an '^::stop-commands::' "$OUT" | head -n 1 | cut -d: -f1)
  token=$(sed -n "${start:-0}p" "$OUT" | sed 's/^::stop-commands:://')
  [[ "$token" =~ ^[0-9a-f]{32}$ ]] || fail "the stop-commands token is not 32 hex characters: $token"
  end=$(grep -anxF "::${token}::" "$OUT" | head -n 1 | cut -d: -f1)
  injected=$(grep -anxF '::error::injected' "$OUT" | head -n 1 | cut -d: -f1)
  [[ -n "$start" && -n "$end" && -n "$injected" ]] || { fail 'a marker or the injected line is missing'; return; }
  { [[ "$start" -lt "$injected" ]] && [[ "$injected" -lt "$end" ]]; } || fail 'the log is not between the markers'
}
test_live_run_prints_no_untrusted_body() {
  printf 'boom\n::error::injected\n' > "$FAILURES/handoff.txt"
  run_report false
  assert_out_lacks '::error::injected'
  assert_out_lacks '::stop-commands::'
}

# ---------------------------------------------------------------------------------------------
# The check step that records the version
# ---------------------------------------------------------------------------------------------
test_record_step_writes_the_bare_version_the_report_validates() {
  rm "$FAILURES/claude-version"
  mkdir -p "$T/bin" && cp "$STUBS/claude" "$T/bin/claude"
  printf 'STUB_LOG=%q\nSTUB_VERSION=2.1.411\n' "$T/stub-calls" > "$T/bin/stub.env"
  run_record_step "$T/bin:/usr/bin:/bin"
  assert_rc 0
  [[ "$(cat "$FAILURES/claude-version")" == 2.1.411 ]] || fail 'claude-version is not the bare version'
}
test_record_step_fails_and_leaves_no_version_when_claude_is_missing() {
  rm "$FAILURES/claude-version"
  run_record_step '/usr/bin:/bin'
  assert_rc_nonzero
  assert_no_file "$FAILURES/claude-version"
}

# ---------------------------------------------------------------------------------------------
# scripts/check.sh in CHECK_LOG_DIR mode
# ---------------------------------------------------------------------------------------------
test_ci_step_runs_check_sh_with_a_log_directory_the_report_job_reads() {
  # shellcheck disable=SC2016 # the workflow expression is matched literally
  grep -qF 'CHECK_LOG_DIR: ${{ runner.temp }}/failures' "$CI_YML" || fail 'the check step does not set CHECK_LOG_DIR to runner.temp/failures'
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURES" --
  assert_rc 0
  assert_file_exists "$FAILURES/checked"
}
test_failing_plugin_keeps_its_log_and_a_passing_plugin_log_is_removed() {
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURES" STUB_TSC_FAIL=a --
  assert_rc 1
  assert_file_has "$FAILURES/a.txt" 'FAILED: plugins/a: tsc -p exited 2'
  assert_no_file "$FAILURES/b.txt"
  assert_out_has 'FAILED: plugins/a: tsc -p exited 2'
}
test_checked_marker_is_written_after_every_plugin_is_tried_even_when_one_fails() {
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURES" STUB_TSC_FAIL=a --
  assert_rc 1
  assert_file_exists "$FAILURES/checked"
  assert_file_has "$STUB_LOG" 'tsc -p plugins/b'
}
test_checked_marker_is_written_when_every_plugin_passes_and_no_log_remains() {
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURES" --
  assert_rc 0
  assert_file_exists "$FAILURES/checked"
  assert_no_file "$FAILURES/a.txt"
}
test_validate_failure_stops_that_plugin_before_tsc_and_keeps_the_log() {
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURES" STUB_VALIDATE_FAIL=a --
  assert_rc 1
  assert_file_has "$FAILURES/a.txt" 'FAILED: plugins/a: claude plugin validate exited 1'
  assert_file_lacks "$STUB_LOG" 'tsc -p plugins/a'
}
test_type_declaration_failure_lands_in_the_plugin_log() {
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURES" STUB_NO_DECLS=a --
  assert_rc 1
  assert_file_has "$FAILURES/a.txt" 'The engine wrote no type declarations for plugins/a'
  assert_file_has "$FAILURES/a.txt" 'FAILED: plugins/a: type declarations exited 1'
  assert_file_lacks "$STUB_LOG" 'tsc -p plugins/a'
}
test_stale_type_declarations_are_removed_before_the_engine_regenerates_them() {
  make_repo a
  mkdir -p "$REPO/plugins/a/.claude-plugin/types/claude-code"
  echo stale > "$REPO/plugins/a/.claude-plugin/types/claude-code/index.d.ts"
  run_check_step CHECK_LOG_DIR="$FAILURES" STUB_NO_DECLS=a --
  assert_rc 1
  assert_no_file "$REPO/plugins/a/.claude-plugin/types/claude-code/index.d.ts"
}
test_report_opens_a_canary_issue_for_a_type_declaration_failure() {
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURES" STUB_NO_DECLS=a --
  mkdir -p "$T/bin" && cp "$STUBS/claude" "$T/bin/claude"
  printf 'STUB_LOG=%q\nSTUB_VERSION=2.1.300\n' "$T/stub-calls" > "$T/bin/stub.env"
  run_record_step "$T/bin:/usr/bin:/bin"
  run_report false
  assert_rc 0
  assert_gh_calls 'issue create --title Claude Code 2.1.300 breaks a --body-file' 1
  assert_file_has "$T/issue-body.md" 'type declarations'
}
test_report_opens_a_canary_issue_for_a_tsc_failure_and_none_for_a_passing_plugin() {
  make_repo a b
  run_check_step CHECK_LOG_DIR="$FAILURES" STUB_TSC_FAIL=b --
  mkdir -p "$T/bin" && cp "$STUBS/claude" "$T/bin/claude"
  printf 'STUB_LOG=%q\nSTUB_VERSION=2.1.300\n' "$T/stub-calls" > "$T/bin/stub.env"
  run_record_step "$T/bin:/usr/bin:/bin"
  printf '%s\n' a b > "$GH_PLUGINS"
  run_report false
  assert_rc 0
  assert_gh_calls 'issue create' 1
  assert_gh_calls 'issue create --title Claude Code 2.1.300 breaks b' 1
  assert_file_has "$T/issue-body.md" 'TS2578'
}
test_unknown_plugin_name_writes_a_no_such_plugin_log_and_the_marker() {
  make_repo a b
  run_check_script CHECK_LOG_DIR="$FAILURES" -- nope
  assert_rc 1
  assert_file_has "$FAILURES/nope.txt" 'No such plugin: plugins/nope'
  assert_file_exists "$FAILURES/checked"
}
test_unknown_plugin_name_with_a_trailing_slash_writes_its_log_under_the_bare_name() {
  make_repo a b
  run_check_script CHECK_LOG_DIR="$FAILURES" -- nope/
  assert_rc 1
  assert_file_has "$FAILURES/nope.txt" 'No such plugin: plugins/nope'
  assert_file_exists "$FAILURES/checked"
}
test_failing_plugin_given_with_a_trailing_slash_keeps_its_log_under_the_bare_name() {
  make_repo a b
  run_check_script CHECK_LOG_DIR="$FAILURES" STUB_TSC_FAIL=a -- a/
  assert_rc 1
  assert_file_has "$FAILURES/a.txt" 'FAILED: plugins/a: tsc -p exited 2'
}
test_empty_plugin_name_writes_a_log_instead_of_only_the_marker() {
  make_repo a
  run_check_script CHECK_LOG_DIR="$FAILURES" -- ''
  assert_rc 1
  assert_file_has "$FAILURES/.txt" 'No such plugin'
}
test_missing_plugins_directory_exits_1_with_no_marker() {
  make_repo
  rmdir "$REPO/plugins"
  run_check_script CHECK_LOG_DIR="$FAILURES" --
  assert_rc 1
  assert_out_has 'No plugins found under'
  assert_no_file "$FAILURES/checked"
}
test_empty_plugins_directory_exits_1_with_no_marker() {
  make_repo
  run_check_script CHECK_LOG_DIR="$FAILURES" --
  assert_rc 1
  assert_out_has 'No plugins found under'
  assert_no_file "$FAILURES/checked"
}
test_missing_tsc_exits_1_and_says_how_to_install_it() {
  make_repo a
  rm "$REPO/node_modules/.bin/tsc"
  run_check_script CHECK_LOG_DIR="$FAILURES" --
  assert_rc 1
  assert_out_has "Run 'npm ci'"
  assert_no_file "$FAILURES/checked"
}

# ---------------------------------------------------------------------------------------------
# scripts/check.sh in local mode, and its arguments
# ---------------------------------------------------------------------------------------------
test_local_run_stops_at_the_first_failing_plugin() {
  make_repo a b
  run_check_script STUB_TSC_FAIL=a --
  assert_rc_nonzero
  assert_file_lacks "$STUB_LOG" 'plugins/b'
}
test_local_run_passes_when_every_plugin_passes() {
  make_repo a b
  run_check_script --
  assert_rc 0
  assert_file_has "$STUB_LOG" 'claude plugin test plugins/b'
}
test_local_run_checks_only_the_plugins_named() {
  make_repo a b
  run_check_script -- b
  assert_rc 0
  assert_file_lacks "$STUB_LOG" 'plugins/a'
}
test_local_run_from_another_directory_still_finds_the_plugins() {
  make_repo a
  RC=0
  (cd "$T" && env PATH="$REPO/bin:/usr/bin:/bin" HOME="$T/home" "$BASH" "$REPO/scripts/check.sh" a) > "$OUT" 2>&1 || RC=$?
  assert_rc 0
}
test_engine_type_generation_runs_without_credentials_or_the_callers_config() {
  make_repo a b
  run_check_script CHECK_LOG_DIR="$FAILURES" --
  assert_rc 0
  assert_file_has "$STUB_LOG" 'GENENV plugin=a api_key=unset oauth=unset'
  assert_file_has "$STUB_LOG" 'GENENV plugin=b api_key=unset oauth=unset'
  assert_file_lacks "$STUB_LOG" '/caller-config'
  assert_file_has "$STUB_LOG" 'config_state=empty'
}
test_engine_type_generation_config_directory_is_removed_when_the_run_ends() {
  make_repo a b
  run_check_script STUB_TSC_FAIL=b --
  [[ -z "$(find "$T/tmp" -mindepth 1)" ]] || fail "check.sh left entries in TMPDIR: $(find "$T/tmp" -mindepth 1)"
}

test_invalid_version_dry_run_does_not_claim_there_were_no_failure_logs() {
  echo 'Claude Code 2.1.300' > "$FAILURES/claude-version"
  add_log handoff
  run_report true
  assert_rc 1
  assert_out_has 'failing_logs=1'
  assert_out_lacks 'no failure logs'
}
test_invalid_version_run_says_how_many_failing_logs_it_left_unopened() {
  echo bad > "$FAILURES/claude-version"
  add_log handoff
  add_log a
  run_report false
  assert_rc 1
  assert_out_has 'Opening nothing for 2 failing logs because the version is invalid.'
}

# ---------------------------------------------------------------------------------------------
for t in $(declare -F | awk '{print $3}' | grep '^test_'); do
  [[ -z "$FILTER" || "$t" == *"$FILTER"* ]] || continue
  FAILED=0
  DETAILS=''
  setup
  "$t"
  total=$((total + 1))
  if [[ "$FAILED" == 0 ]]; then
    echo "PASS $t"
  else
    failures=$((failures + 1))
    echo "FAIL $t"
    printf '%s' "$DETAILS"
    sed 's/^/        | /' "$OUT" 2> /dev/null | head -n 12
  fi
done
echo "$((total - failures)) of $total passed"
[[ "$total" -gt 0 || -n "$FILTER" ]] || { echo 'No tests ran.' >&2; exit 1; }
[[ "$failures" == 0 ]]
