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

test_the_pr_record_job_holds_no_token_permission_but_contents_read() {
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

test_the_pr_record_file_holds_the_number_and_base_as_json() {
  local script
  script=$(record_job_json '.steps[] | select(.env.PR_NUMBER?) | .run' | jq -r .) || fail "cannot read the script"
  RUNNER_TEMP=$TEST_DIR PR_NUMBER=42 PR_BASE=main bash -c "$script"
  [[ "$(jq -c . "$TEST_DIR/pr-record/pr-record.json")" == '{"number":42,"base":"main"}' ]] \
    || fail "the record is [$(cat "$TEST_DIR/pr-record/pr-record.json")]"
}

run_tests "$@"
