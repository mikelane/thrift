#!/usr/bin/env bash
# Sourced by release-merge.test.sh and by the merge step of .github/workflows/release-merge.yml.
#
# release_merge_allowlist <config>: prints each file a release PR may change: the manifest, and for
# every package in release-please-config.json its changelog and its extra-files.
release_merge_allowlist() {
  jq -r '
    def in_package($dir; $file):
      ($file | sub("^/"; "")) as $relative
      | if ($file | startswith("/")) or $dir == "." or $dir == "" then $relative else "\($dir)/\($relative)" end;
    . as $config
    | ".release-please-manifest.json",
      (.packages | to_entries[] | .key as $dir | .value as $pkg
        | def setting($key): $pkg[$key] // $config[$key];
          in_package($dir; setting("changelog-path") // "CHANGELOG.md"),
          (setting("version-file") // empty | in_package($dir; .)),
          (setting("extra-files")[]? | (if type == "string" then . else .path end) // empty
            | in_package($dir; .)))
  ' "$1"
}

# release_merge_open_pr_number <repo> <owner> <branch> <base>: prints the number of the open PR whose
# head is <branch> in <owner>'s copy of the repository and whose base is <base>, and nothing when
# there is none. head=<owner>:<branch> matches only a branch in this repository, never a fork's, and
# base keeps a second PR from the same branch to another base from taking its place. --method GET is required: `gh api`
# turns -f fields into a POST, which would try to create a pull request.
release_merge_open_pr_number() {
  gh api --method GET "repos/$1/pulls" -f head="$2:$3" -f base="$4" -f state=open --jq '.[0].number // empty'
}

# release_merge_changed_files: reads the JSON of the pull request files API (one array per page, as
# `gh api --paginate` prints them) and prints each changed path and each renamed file's old path,
# one per line. A path with a control character, such as a newline, prints as a JSON string, so it
# can neither split into two names nor end in a blank line, and it never matches the allowlist.
release_merge_changed_files() {
  jq -r '.[] | (.filename, (.previous_filename // empty)) | if test("[[:cntrl:]]") then @json else . end'
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
