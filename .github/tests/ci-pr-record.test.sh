#!/usr/bin/env bash
# ci.yml writes the pr-record artifact the release-merge gate reads (issue #117): the PR number and
# base ref taken from the run's own pull_request event. The workflow is parsed with Ruby (Psych).
# Usage: ci-pr-record.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"

CI_WORKFLOW="$REPO_ROOT/.github/workflows/ci.yml"

# record_job_json <jq-filter>: the filter applied to the parsed `pr-record` job. A YAML or Ruby
# error prints nothing and fails, so every check below fails closed.
record_job_json() {
  ruby -ryaml -rjson -e '
    begin
      doc = YAML.safe_load(File.read(ARGV.fetch(0)), aliases: true)
      puts JSON.generate(doc.fetch("jobs").fetch("pr-record"))
    rescue StandardError => e
      warn "cannot read the pr-record job of #{ARGV[0]}: #{e.class}: #{e.message}"
      exit 1
    end' "$CI_WORKFLOW" | jq -c "$1"
}

assert_record_job() {
  local got
  got=$(record_job_json "$1") || fail "$2: cannot read the pr-record job"
  [[ "$got" == "$3" ]] || fail "$2: got '${got:-<unreadable>}', expected '$3'"
}

test_the_pr_record_job_runs_only_for_pull_request_events() {
  assert_record_job '.if' 'the job condition' '"github.event_name == '"'"'pull_request'"'"'"'
}

test_the_pr_record_job_grants_only_contents_read() {
  assert_record_job '.permissions' 'the job permissions' '{"contents":"read"}'
}

test_the_pr_record_job_takes_the_number_and_base_from_its_own_event() {
  assert_record_job '[.steps[] | select(.env.PR_NUMBER?) | .env]' 'the record step env' \
    '[{"PR_NUMBER":"${{ github.event.pull_request.number }}","PR_BASE":"${{ github.event.pull_request.base.ref }}"}]'
}

test_the_pr_record_job_never_puts_an_expression_in_a_run_script() {
  assert_record_job '[.steps[] | .run? // "" | contains("${{")] | any' 'expressions in run scripts' 'false'
}

test_the_pr_record_job_uploads_an_artifact_named_pr_record() {
  assert_record_job '[.steps[] | select(.uses? // "" | startswith("actions/upload-artifact@")) | .with.name]' \
    'the uploaded artifact names' '["pr-record"]'
}

# The upload path must be the file the script writes, or every release PR is refused for want of a
# record; if-no-files-found: error turns that mistake into a red CI run instead.
test_the_pr_record_job_uploads_the_file_the_script_writes_and_fails_when_it_is_missing() {
  assert_record_job '[.steps[] | select(.uses? // "" | startswith("actions/upload-artifact@")) | .with]' \
    'the upload settings' \
    '[{"name":"pr-record","path":"${{ runner.temp }}/pr-record/pr-record.json","retention-days":30,"if-no-files-found":"error"}]'
}

# run_record_script <number> <base>: runs the record step's script as Actions runs a step with no
# `shell:` (bash -e), with $TEST_DIR as RUNNER_TEMP.
run_record_script() {
  local script
  script=$(record_job_json '.steps[] | select(.env.PR_NUMBER?) | .run' | jq -r .) || fail "cannot read the script"
  RUNNER_TEMP=$TEST_DIR PR_NUMBER=$1 PR_BASE=$2 bash -e -c "$script"
}

test_the_pr_record_file_holds_the_number_and_base_as_json() {
  run_record_script 42 main
  [[ "$(jq -c . "$TEST_DIR/pr-record/pr-record.json")" == '{"number":42,"base":"main"}' ]] \
    || fail "the record is [$(cat "$TEST_DIR/pr-record/pr-record.json")]"
}

# A base ref is chosen by whoever opens the PR: quotes and $( ) must land in the record as text.
test_the_pr_record_file_holds_a_base_with_quotes_and_a_command_substitution_verbatim() {
  run_record_script 42 'x"$(touch pwned)'
  [[ "$(jq -r .base "$TEST_DIR/pr-record/pr-record.json")" == 'x"$(touch pwned)' ]] \
    || fail "the record is [$(cat "$TEST_DIR/pr-record/pr-record.json")]"
  assert_no_file "$PWD/pwned"
}

run_tests "$@"
