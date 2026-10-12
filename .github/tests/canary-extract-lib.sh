#!/usr/bin/env bash
# Sourced by canary-report-lib.sh. Pulls one step's `run:` out of a workflow file.
# shellcheck disable=SC2034 # the step names and specs are read by the files that source this one

REPORT_STEP='Open an issue for each plugin the new build breaks'
RECORD_STEP='Record the Claude Code version for the canary issue job'
CHECK_STEP='Check every plugin with scripts/check.sh'

# job_lines <job> <ci.yml>: the lines of one job, after its header. Every reader of a job goes
# through this, so they agree on where the job ends (see canary-job-lines.awk).
job_lines() {
  awk -v want_job="  $1:" -f "$HARNESS_DIR/canary-job-lines.awk" "$2"
}

# Prints the body of one step's `run:` from a job of a workflow file, de-indented. Exits 1, and says
# why, when the step is not found in that job at the indentation the workflow uses, is found more
# than once, or has a key the harness does not model, or a key line the harness cannot read, so a
# renamed, re-indented, moved, duplicated or conditional step fails the harness instead of testing
# a script that Actions would not run, or would run differently.
#
# The fourth argument lists the step's keys, one per line, besides `name` and `run`:
#   key        allowed, any value
#   key=value  allowed only with exactly that value
#   +key=value required as well
# Every key at the step's indentation, before or after `run`, must be listed.
extract_step() {
  local ci_yml="$1" job="$2" step_name="$3" spec="$4" script occurrences status=0
  job_lines "$job" "$ci_yml" > "$WORK_DIR/job.yml"
  occurrences=$(grep -cxF -- "      - name: $step_name" "$WORK_DIR/job.yml" || true)
  if [[ "$occurrences" -gt 1 ]]; then
    echo "The step '$step_name' appears $occurrences times in the job '$job' of $ci_yml, so the harness cannot tell which one runs. Give each step a unique name." >&2
    return 1
  fi
  script=$(SPEC="$spec" awk -v want="      - name: $step_name" -f "$HARNESS_DIR/canary-yaml-key.awk" -f "$HARNESS_DIR/canary-extract-step.awk" "$WORK_DIR/job.yml" 2> "$WORK_DIR/extract.err") || status=$?
  if [[ "$status" == 3 ]]; then
    echo "The step '$step_name' in the job '$job' of $ci_yml $(cat "$WORK_DIR/extract.err"). If the change is intended, update the step's key list in $HARNESS_DIR/canary-extract-lib.sh." >&2
    return 1
  fi
  if [[ "$status" != 0 ]]; then
    echo "Could not read the step '$step_name' from the job '$job' of $ci_yml: awk exited $status: $(cat "$WORK_DIR/extract.err")" >&2
    return 1
  fi
  if [[ -z "$script" ]]; then
    echo "Could not extract the step '$step_name' from the job '$job' of $ci_yml: no step in it has that name at six spaces of indentation with a run block. If it was renamed or moved, update $HARNESS_DIR/canary-extract-lib.sh to match." >&2
    return 1
  fi
  printf '%s\n' "$script"
}

REPORT_SPEC=$'env\n+shell=bash'
# shellcheck disable=SC2016 # the workflow expression is matched literally
RECORD_SPEC=$'+if=always() && (github.event_name == \'schedule\' || github.event_name == \'workflow_dispatch\') && matrix.channel == \'latest\''
CHECK_SPEC=$'env'
extract_report_step() { extract_step "$1" report "$REPORT_STEP" "$REPORT_SPEC"; }

# Prints the value of one `KEY: value` setting of the report step's env.
read_report_step_setting() {
  local ci_yml="$1" key="$2" value
  value=$(job_lines report "$ci_yml" | awk -v want="      - name: $REPORT_STEP" -v key="          $key: " '
    $0 == want { inside = 1; next }
    inside && $0 ~ /^      - / { exit }
    inside && index($0, key) == 1 { print substr($0, length(key) + 1); exit }')
  [[ -n "$value" ]] || { echo "Could not read $key from the report step's env in $ci_yml. Restore the setting, or update $HARNESS_DIR/canary-extract-lib.sh to match." >&2; return 1; }
  printf '%s\n' "$value"
}

extract_or_die() {
  local job="$1" step_name="$2" spec="$3" must_contain="$4" target="$5"
  # shellcheck disable=SC2153 # CI_YML is set by canary-report-lib.sh
  extract_step "$CI_YML" "$job" "$step_name" "$spec" > "$target" || exit 2
  grep -qF -- "$must_contain" "$target" || {
    echo "The step '$step_name' no longer contains '$must_contain', so the harness would test the wrong script. If the step changed on purpose, update the expected text in $HARNESS_DIR/canary-extract-lib.sh." >&2
    exit 2
  }
}

# The condition the report job runs under. Only a schedule or a manual run opens issues.
# shellcheck disable=SC2016 # the workflow expression is matched literally
REPORT_JOB_IF=$'${{ !cancelled() && (github.event_name == \'schedule\' || github.event_name == \'workflow_dispatch\') }}'

# read_job_key <job> <key> <ci.yml>: prints the value of each job-level `key:` of a job, one per line.
read_job_key() {
  job_lines "$1" "$3" | awk -v want_key="$2" -f "$HARNESS_DIR/canary-yaml-key.awk" -f "$HARNESS_DIR/canary-job-keys.awk"
}

# Exits 1, and says why, unless the job has exactly one job-level `if:` with the expected value, so
# a job that never runs, or runs on other events, fails the harness instead of passing it.
check_job_condition() {
  local ci_yml="$1" job="$2" expected="$3" values why
  grep -qxF -- "  $job:" "$ci_yml" || { echo "No job named '$job' in $ci_yml, so the harness cannot check its condition." >&2; return 1; }
  values=$(read_job_key "$job" if "$ci_yml")
  if [[ -z "$values" ]]; then why='has no "if" key'
  elif [[ "$values" == *$'\n'* ]]; then why='has "if" more than once'
  elif [[ "$values" != "$expected" ]]; then why="has \"if\" set to something other than \"$expected\""
  else return 0
  fi
  echo "The job '$job' in $ci_yml $why. If the change is intended, update REPORT_JOB_IF in $HARNESS_DIR/canary-extract-lib.sh." >&2
  return 1
}
