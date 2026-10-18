#!/usr/bin/env bash
# Sourced by release-merge.test.sh and by the merge step of .github/workflows/release-merge.yml.
#
# release_merge_allowlist <config>: prints each file a release PR may change: the manifest, and for
# every package in release-please-config.json its changelog and its extra-files.
release_merge_allowlist() {
  jq -r '
    ".release-please-manifest.json",
    (.packages | to_entries[] | .key as $dir | .value as $pkg
      | "\($dir)/\($pkg["changelog-path"] // "CHANGELOG.md")",
        ($pkg["extra-files"][]? | (if type == "string" then . else .path end) | "\($dir)/\(.)"))
  ' "$1"
}

# release_merge_problems <pr.json> <changed-files> <config> <repo> <base> <bot-login> <tested-sha>:
# prints one line per reason the PR must not be merged, and nothing when it may be.
# <pr.json> is the REST pull request object, <changed-files> lists one path per line.
release_merge_problems() {
  local pr=$1 files=$2 config=$3 repo=$4 base=$5 bot=$6 tested_sha=$7 allowed value file
  value=$(jq -r '.state' "$pr")
  [[ "$value" == open ]] || echo "the PR is $value, not open"
  value=$(jq -r '.base.ref' "$pr")
  [[ "$value" == "$base" ]] || echo "the PR targets $value, not $base"
  value=$(jq -r '.head.repo.full_name // "(deleted)"' "$pr")
  [[ "$value" == "$repo" ]] || echo "the PR head is in $value, not $repo"
  value=$(jq -r '.head.ref' "$pr")
  [[ "$value" == release-please--* ]] || echo "the PR branch $value does not start with release-please--"
  value=$(jq -r '.user.login' "$pr")
  [[ "$value" == "$bot" ]] || echo "the PR author is $value, not $bot"
  value=$(jq -r '.head.sha' "$pr")
  [[ "$value" == "$tested_sha" ]] || echo "the PR head is $value but CI tested $tested_sha"
  allowed=$(release_merge_allowlist "$config") || { echo "cannot read the allowlist from $config"; return; }
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    grep -qxF -- "$file" <<<"$allowed" || echo "$file is not a file a release PR changes"
  done <"$files"
}
