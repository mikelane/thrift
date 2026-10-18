#!/usr/bin/env bash
# Sourced by release-config.test.sh.
#
# release_config_problems <root>: prints one line per problem in the release-please files under
# <root>, and nothing when they are sound. Each plugin in .claude-plugin/marketplace.json needs a
# package in release-please-config.json whose component is the plugin's name (the tag prefix), an
# entry in .release-please-manifest.json, and a manifest version equal to the version in its
# plugin.json.
release_config_problems() {
  local root=$1 name source dir component manifest_version plugin_version
  while IFS=$'\t' read -r name source; do
    dir=${source#./}
    if component=$(jq -er --arg dir "$dir" '.packages[$dir] | objects | .component // "(none)"' \
      "$root/release-please-config.json" 2>/dev/null); then
      [[ "$component" == "$name" ]] \
        || echo "$dir: component is $component but the marketplace name is $name"
    else
      echo "$dir has no package in release-please-config.json"
    fi
    manifest_version=$(jq -er --arg dir "$dir" '.[$dir]' "$root/.release-please-manifest.json" 2>/dev/null) \
      || { echo "$dir has no entry in .release-please-manifest.json"; continue; }
    plugin_version=$(jq -er '.version' "$root/$dir/.claude-plugin/plugin.json" 2>/dev/null) \
      || { echo "$dir has no readable plugin.json with a version"; continue; }
    [[ "$manifest_version" == "$plugin_version" ]] \
      || echo "$dir: manifest says $manifest_version but plugin.json says $plugin_version"
  done < <(jq -r '.plugins[] | "\(.name)\t\(.source)"' "$root/.claude-plugin/marketplace.json")
}
