#!/usr/bin/env bash
# Sourced by canary-report-lib.sh. Pulls one step's `run:` out of a workflow file.
# shellcheck disable=SC2034 # the step names and specs are read by the files that source this one

REPORT_STEP='Open an issue for each plugin the new build breaks'
RECORD_STEP='Record the Claude Code version for the canary issue job'
CHECK_STEP='Check every plugin with scripts/check.sh'

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
  script=$(SPEC="$spec" awk -v want="      - name: $step_name" -f "$HARNESS_DIR/canary-extract-step.awk" "$ci_yml" 2> "$WORK_DIR/extract.err") || status=$?
  if [[ "$status" == 3 ]]; then
    echo "The step '$step_name' in $ci_yml $(cat "$WORK_DIR/extract.err"). If the change is intended, update the step's key list in $HARNESS_DIR/canary-extract-lib.sh." >&2
    return 1
  fi
  if [[ "$status" != 0 ]]; then
    echo "Could not read the step '$step_name' from $ci_yml: awk exited $status: $(cat "$WORK_DIR/extract.err")" >&2
    return 1
  fi
  if [[ -z "$script" ]]; then
    echo "Could not extract the step '$step_name' from $ci_yml: no step has that name at six spaces of indentation with a run block. If it was renamed or moved, update $HARNESS_DIR/canary-extract-lib.sh to match." >&2
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
  [[ -n "$value" ]] || { echo "Could not read $key from the report step's env in $ci_yml. Restore the setting, or update $HARNESS_DIR/canary-extract-lib.sh to match." >&2; return 1; }
  printf '%s\n' "$value"
}

extract_or_die() {
  local step_name="$1" spec="$2" must_contain="$3" target="$4"
  # shellcheck disable=SC2153 # CI_YML is set by canary-report-lib.sh
  extract_step "$CI_YML" "$step_name" "$spec" > "$target" || exit 2
  grep -qF -- "$must_contain" "$target" || {
    echo "The step '$step_name' no longer contains '$must_contain', so the harness would test the wrong script. If the step changed on purpose, update the expected text in $HARNESS_DIR/canary-extract-lib.sh." >&2
    exit 2
  }
}
