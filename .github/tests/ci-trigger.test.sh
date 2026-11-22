#!/usr/bin/env bash
# ci.yml runs on pull requests into main only, so a run's pull_requests list can never name a PR into
# another base (issue #117). The workflow is parsed with Ruby (Psych), which reads a bare `on` key as
# boolean true, so the trigger table is read under the key "true".
# Usage: ci-trigger.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"

CI_WORKFLOW=$REPO_ROOT/.github/workflows/ci.yml

# ci_trigger_json <jq-filter>: the filter applied to the parsed `on` table. A YAML or Ruby error prints
# nothing and fails, so every check below fails closed.
ci_trigger_json() {
  ruby -ryaml -rjson -e '
    begin
      doc = YAML.safe_load(File.read(ARGV.fetch(0)), aliases: true)
      puts JSON.generate(doc.fetch(true) { doc.fetch("on") })
    rescue StandardError, SyntaxError => e
      warn "cannot parse #{ARGV[0]}: #{e.class}"
      exit 1
    end' "$CI_WORKFLOW" | jq -c "$1"
}

test_ci_runs_for_pull_requests_into_main_only() {
  [[ "$(ci_trigger_json '.pull_request.branches')" == '["main"]' ]] \
    || fail "ci.yml's pull_request trigger is not limited to branches: [main]"
}

test_ci_pull_request_trigger_has_no_branch_exclusions() {
  [[ "$(ci_trigger_json '.pull_request | has("branches-ignore")')" == 'false' ]] \
    || fail "ci.yml's pull_request trigger sets branches-ignore"
}

run_tests "$@"
