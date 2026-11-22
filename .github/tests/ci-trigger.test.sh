#!/usr/bin/env bash
# The branches: [main] filter stops an ordinary PR into another base from triggering a CI run. It does not
# bound a run's pull_requests list, and a base with an unfiltered ci.yml can still trigger one (CLAUDE.md
# release-merge paragraph; issue #117). The workflow is parsed with Ruby (Psych), which reads a bare `on` key as
# boolean true, so the trigger table is read under the key "true".
# Usage: ci-trigger.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"

CI_WORKFLOW="$REPO_ROOT/.github/workflows/ci.yml"

# ci_trigger_json <jq-filter>: the filter applied to the parsed `on` table. A YAML or Ruby error prints
# nothing and fails, so every check below fails closed.
ci_trigger_json() {
  ruby -ryaml -rjson -e '
    begin
      doc = YAML.safe_load(File.read(ARGV.fetch(0)), aliases: true)
      abort "#{ARGV[0]} has no top-level mapping" unless doc.is_a?(Hash)
      abort "#{ARGV[0]} has no top-level on: key" unless doc.key?(true) || doc.key?("on")
      puts JSON.generate(doc.fetch(true) { doc.fetch("on") })
    rescue StandardError => e
      warn "cannot parse #{ARGV[0]}: #{e.class}: #{e.message}"
      exit 1
    end' "$CI_WORKFLOW" | jq -c "$1"
}

test_ci_runs_for_pull_requests_into_main_only() {
  local branches
  branches=$(ci_trigger_json '.pull_request.branches')
  [[ "$branches" == '["main"]' ]] \
    || fail "ci.yml's pull_request branches are '${branches:-<unreadable>}', expected [\"main\"]"
}

run_tests "$@"
