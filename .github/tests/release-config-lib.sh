#!/usr/bin/env bash
# Sourced by release-config.test.sh.
#
# release_config_problems <root>: prints one line per problem in the release-please files under
# <root>, and nothing when they are sound. Each plugin in .claude-plugin/marketplace.json needs a
# package in release-please-config.json, an entry in .release-please-manifest.json, and a manifest
# version equal to the version in its plugin.json.
release_config_problems() {
  local root=$1 source dir manifest_version plugin_version
  while IFS= read -r source; do
    dir=${source#./}
    jq -e --arg dir "$dir" '.packages | has($dir)' "$root/release-please-config.json" >/dev/null 2>&1 \
      || echo "$dir has no package in release-please-config.json"
    manifest_version=$(jq -er --arg dir "$dir" '.[$dir]' "$root/.release-please-manifest.json" 2>/dev/null) \
      || { echo "$dir has no entry in .release-please-manifest.json"; continue; }
    plugin_version=$(jq -er '.version' "$root/$dir/.claude-plugin/plugin.json" 2>/dev/null) \
      || { echo "$dir has no readable plugin.json with a version"; continue; }
    [[ "$manifest_version" == "$plugin_version" ]] \
      || echo "$dir: manifest says $manifest_version but plugin.json says $plugin_version"
  done < <(jq -r '.plugins[].source' "$root/.claude-plugin/marketplace.json")
}
