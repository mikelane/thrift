#!/usr/bin/env bash
# release-please wiring: every plugin in marketplace.json has a package in release-please-config.json
# and an entry in .release-please-manifest.json, and each manifest version equals the plugin's
# plugin.json version. Temp copies of the repo's JSON exercise the failure cases.
# Usage: release-config.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"
# shellcheck source=release-config-lib.sh
source "$HARNESS_DIR/release-config-lib.sh"

# copy_repo_json <root>: the files the check reads, copied from the real repo.
copy_repo_json() {
  local root=$1 plugin_json
  mkdir -p "$root/.claude-plugin"
  cp "$REPO_ROOT/.claude-plugin/marketplace.json" "$root/.claude-plugin/"
  cp "$REPO_ROOT/release-please-config.json" "$REPO_ROOT/.release-please-manifest.json" "$root/"
  while IFS= read -r plugin_json; do
    mkdir -p "$root/$(dirname "$plugin_json")"
    cp "$REPO_ROOT/$plugin_json" "$root/$plugin_json"
  done < <(cd "$REPO_ROOT" && ls plugins/*/.claude-plugin/plugin.json)
}

# edit_json <file> <jq filter>: rewrite the file in place.
edit_json() {
  local tmp="$1.tmp"
  jq "$2" "$1" >"$tmp" && mv "$tmp" "$1"
}

problems_for() { release_config_problems "$1" 2>&1; }

test_the_real_repo_has_no_problems() {
  local got
  got=$(problems_for "$REPO_ROOT")
  [[ -z "$got" ]] || fail "the repo's release-please files have problems: $got"
}

test_reports_a_plugin_missing_from_the_config() {
  local root got
  root=$(mktemp -d)
  copy_repo_json "$root"
  edit_json "$root/release-please-config.json" '.packages = {}'
  got=$(problems_for "$root")
  rm -rf "$root"
  [[ "$got" == *'plugins/handoff has no package in release-please-config.json'* ]] || fail "got [$got]"
}

test_reports_a_plugin_missing_from_the_manifest() {
  local root got
  root=$(mktemp -d)
  copy_repo_json "$root"
  echo '{}' >"$root/.release-please-manifest.json"
  got=$(problems_for "$root")
  rm -rf "$root"
  [[ "$got" == *'plugins/handoff has no entry in .release-please-manifest.json'* ]] || fail "got [$got]"
}

test_reports_a_manifest_version_that_differs_from_plugin_json() {
  local root got
  root=$(mktemp -d)
  copy_repo_json "$root"
  edit_json "$root/.release-please-manifest.json" '."plugins/handoff" = "9.9.9"'
  got=$(problems_for "$root")
  rm -rf "$root"
  [[ "$got" == *'plugins/handoff: manifest says 9.9.9 but plugin.json says'* ]] || fail "got [$got]"
}

test_reports_a_plugin_added_to_marketplace_without_release_files() {
  local root got
  root=$(mktemp -d)
  copy_repo_json "$root"
  edit_json "$root/.claude-plugin/marketplace.json" '.plugins += [{"name":"newcomer","source":"./plugins/newcomer"}]'
  mkdir -p "$root/plugins/newcomer/.claude-plugin"
  echo '{"name":"newcomer","version":"0.1.0"}' >"$root/plugins/newcomer/.claude-plugin/plugin.json"
  got=$(problems_for "$root")
  rm -rf "$root"
  [[ "$got" == *'plugins/newcomer has no package'* && "$got" == *'plugins/newcomer has no entry'* ]] || fail "got [$got]"
}

test_reports_a_marketplace_plugin_with_no_plugin_json() {
  local root got
  root=$(mktemp -d)
  copy_repo_json "$root"
  rm "$root/plugins/handoff/.claude-plugin/plugin.json"
  got=$(problems_for "$root")
  rm -rf "$root"
  [[ "$got" == *'plugins/handoff has no readable plugin.json'* ]] || fail "got [$got]"
}

# Without a component the tag loses its <name>- prefix, so two plugins would share v-tags.
test_reports_a_package_with_no_component() {
  local root got
  root=$(mktemp -d)
  copy_repo_json "$root"
  edit_json "$root/release-please-config.json" 'del(.packages."plugins/handoff".component)'
  got=$(problems_for "$root")
  rm -rf "$root"
  [[ "$got" == *'plugins/handoff: component is (none) but the marketplace name is handoff'* ]] || fail "got [$got]"
}

test_reports_a_package_whose_component_differs_from_the_marketplace_name() {
  local root got
  root=$(mktemp -d)
  copy_repo_json "$root"
  edit_json "$root/release-please-config.json" '.packages."plugins/handoff".component = "hand off"'
  got=$(problems_for "$root")
  rm -rf "$root"
  [[ "$got" == *'plugins/handoff: component is hand off but the marketplace name is handoff'* ]] || fail "got [$got]"
}

test_accepts_a_marketplace_source_without_the_leading_dot_slash() {
  local root got
  root=$(mktemp -d)
  copy_repo_json "$root"
  edit_json "$root/.claude-plugin/marketplace.json" '.plugins[0].source = "plugins/handoff"'
  got=$(problems_for "$root")
  rm -rf "$root"
  [[ -z "$got" ]] || fail "got [$got]"
}

# release-please groups every package into one PR unless this is set, once there are two or more.
test_the_config_opens_a_separate_release_pr_per_plugin() {
  local got
  got=$(jq '."separate-pull-requests"' "$REPO_ROOT/release-please-config.json")
  [[ "$got" == true ]] || fail "separate-pull-requests is $got"
}

run_tests "$@"
