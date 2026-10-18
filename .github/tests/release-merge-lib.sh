#!/usr/bin/env bash
# Sourced by release-merge.test.sh and by the merge step of .github/workflows/release-merge.yml.
#
# release_merge_allowlist <config>: prints each file a release PR may change: the manifest, and for
# every package in release-please-config.json its changelog, its version file and its extra-files.
# A simple package's version file defaults to version.txt, as release-please's Simple strategy does
# (the effective release-type is the package's, else the top level's, else release-please's node).
release_merge_allowlist() {
  jq -r '
    def in_package($dir; $file):
      ($file | sub("^/"; "")) as $relative
      | if ($file | startswith("/")) or $dir == "." or $dir == "" then $relative else "\($dir)/\($relative)" end;
    . as $config
    | ".release-please-manifest.json",
      (.packages | to_entries[] | .key as $dir | .value as $pkg
        | def setting($key): $pkg[$key] // $config[$key];
          ($pkg["release-type"] // $config["release-type"] // "node") as $type
          | in_package($dir; setting("changelog-path") // "CHANGELOG.md"),
          ((setting("version-file") // (if $type == "simple" then "version.txt" else empty end))
            | in_package($dir; .)),
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
  local pr=$1 files=$2 config=$3 repo=$4 base=$5 bot=$6 tested_sha=$7 allowed file
  local pr_state pr_base_ref head_repo head_ref pr_author head_sha
  pr_state=$(jq -r '.state' "$pr")
  [[ "$pr_state" == open ]] || echo "the PR is $pr_state, not open"
  pr_base_ref=$(jq -r '.base.ref' "$pr")
  [[ "$pr_base_ref" == "$base" ]] || echo "the PR targets $pr_base_ref, not $base"
  head_repo=$(jq -r '.head.repo.full_name // "(deleted)"' "$pr")
  [[ "$head_repo" == "$repo" ]] || echo "the PR head is in $head_repo, not $repo"
  head_ref=$(jq -r '.head.ref' "$pr")
  [[ "$head_ref" == release-please--* ]] || echo "the PR branch $head_ref does not start with release-please--"
  pr_author=$(jq -r '.user.login' "$pr")
  [[ "$pr_author" == "$bot" ]] || echo "the PR author is $pr_author, not $bot"
  head_sha=$(jq -r '.head.sha' "$pr")
  [[ "$head_sha" == "$tested_sha" ]] || echo "the PR head is $head_sha but CI tested $tested_sha"
  allowed=$(release_merge_allowlist "$config") || { echo "cannot read the allowlist from $config"; return; }
  # A failed `<"$files"` skips the loop and prints no problem, which would pass every file.
  [[ -r "$files" ]] || { echo "cannot read the changed files from $files"; return; }
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    grep -qxF -- "$file" <<<"$allowed" || echo "$file is not a file a release PR changes"
  done <"$files"
}
