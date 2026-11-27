#!/usr/bin/env bash
# The whole of release-please.yml. The workflow is parsed with Ruby (Psych, the YAML 1.1 reader every
# runner has) and the WHOLE parsed document is compared with release-please-workflow.expected.json, so
# an edit to an action pin, an App-token input, the environment, a permission or a trigger fails a test.
# ANY CHANGE TO release-please.yml MUST UPDATE release-please-workflow.expected.json IN THE SAME PR. The
# failing test prints the diff; regenerate the fixture with:
#   ruby -ryaml -rjson -e 'puts JSON.generate(YAML.safe_load(File.read(".github/workflows/release-please.yml"), aliases: true))' | jq -S . > .github/tests/release-please-workflow.expected.json
# Usage: release-please-workflow.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"

WORKFLOW=$REPO_ROOT/.github/workflows/release-please.yml
EXPECTED_WORKFLOW=$HARNESS_DIR/release-please-workflow.expected.json

# workflow_json [file]: the workflow as one line of JSON. A YAML or Ruby error prints nothing and
# fails, so every check below fails closed. Psych reads a bare `on` key as boolean true, which JSON
# spells "true"; the fixture keeps that key as Psych emits it.
workflow_json() {
  ruby -ryaml -rjson -e '
    begin
      puts JSON.generate(YAML.safe_load(File.read(ARGV.fetch(0)), aliases: true))
    rescue StandardError, SyntaxError => e
      warn "cannot parse #{ARGV[0]}: #{e.class}"
      exit 1
    end' "${1:-$WORKFLOW}"
}

# workflow_is_pinned [file]: succeeds when the parsed workflow equals the fixture exactly.
workflow_is_pinned() {
  local got
  got=$(workflow_json "${1:-}" | jq -S .) || return 1
  [[ "$got" == "$(jq -S . "$EXPECTED_WORKFLOW")" ]]
}

# write_variant_workflow <old> <new>: writes the workflow with its one occurrence of <old> replaced by <new>
# to VARIANT, and fails when <old> is not in the file, so a variant can never be the unedited workflow.
write_variant_workflow() {
  VARIANT=$TEST_DIR/variant.yml
  python3 -I - "$WORKFLOW" "$VARIANT" "$1" "$2" <<'PY'
import sys
text = open(sys.argv[1], newline="").read()
if text.count(sys.argv[3]) != 1:
    sys.exit("expected exactly one " + repr(sys.argv[3]))
open(sys.argv[2], "w", newline="").write(text.replace(sys.argv[3], sys.argv[4]))
PY
}

# refuses_variant <old> <new> <what the variant does>: fails the test when the pinned check passes.
refuses_variant() {
  write_variant_workflow "$1" "$2" || fail "could not build the variant where $3"
  workflow_json "$VARIANT" >/dev/null || fail "the variant where $3 does not parse, so refusing it proves nothing"
  workflow_is_pinned "$VARIANT" && fail "the check passed a workflow where $3"
  return 0
}

test_the_whole_parsed_workflow_equals_the_expected_fixture() {
  workflow_is_pinned && return 0
  diff <(jq -S . "$EXPECTED_WORKFLOW") <(workflow_json | jq -S .) >&2
  fail 'release-please.yml differs from release-please-workflow.expected.json; update the fixture if the change is intended'
}

test_the_unedited_workflow_is_what_the_variants_start_from() {
  write_variant_workflow 'config-file: release-please-config.json' 'config-file: release-please-config.json'
  workflow_is_pinned "$VARIANT" || fail 'the unedited workflow failed the check'
}

test_a_variant_of_text_the_workflow_lacks_cannot_be_built() {
  write_variant_workflow 'no-such-key: anywhere' 'other: value' 2>/dev/null \
    && fail 'built a variant from text the workflow does not hold, which is the unedited workflow'
  return 0
}

test_a_variant_of_text_the_workflow_holds_twice_cannot_be_built() {
  write_variant_workflow ': write' ': read' 2>/dev/null \
    && fail 'built a variant from text the workflow holds more than once'
  return 0
}

test_a_workflow_with_another_app_token_action_pin_is_refused() {
  refuses_variant 'create-github-app-token@f418cff399f7aef4c2f0ad47e25ca7a6abbdd6fc' \
    'create-github-app-token@0000000000000000000000000000000000000000' \
    'the App-token action is pinned to another commit'
}

test_a_workflow_with_another_release_please_action_pin_is_refused() {
  refuses_variant 'release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7' \
    'release-please-action@main' \
    'the release-please action floats on a branch'
}

test_a_workflow_with_another_client_id_input_is_refused() {
  refuses_variant 'client-id: ${{ vars.RELEASE_APP_ID }}' 'client-id: ${{ vars.OTHER_APP_ID }}' \
    'the App token is minted for another client id'
}

test_a_workflow_with_another_private_key_input_is_refused() {
  refuses_variant 'private-key: ${{ secrets.RELEASE_APP_PRIVATE_KEY }}' 'private-key: ${{ secrets.OTHER_KEY }}' \
    'the App token is minted with another private key'
}

test_a_workflow_without_the_release_environment_is_refused() {
  refuses_variant 'environment: release' 'environment: staging' \
    'the job runs outside the release environment that holds the key'
}

test_a_workflow_that_widens_the_app_token_permissions_is_refused() {
  refuses_variant 'permission-issues: write' $'permission-issues: write\n          permission-workflows: write' \
    'the App token gains a permission'
}

run_tests "$@"
