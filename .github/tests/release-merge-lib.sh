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
# base keeps a second PR from the same branch to another base from taking its place. --method GET
# is required: `gh api` turns -f fields into a POST, which would try to create a pull request.
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

# release_merge_sibling_problem <repo> <head-ref> <number>: prints a reason when an open PR other than
# <number> has <head-ref> as its head in <repo> (head=<owner>:<branch> matches only this repository,
# and the jq filter checks again). A run's pull_requests cannot say which PR triggered it, so with a
# sibling no CI run can be tied to one PR. A lookup that fails prints a reason too: fail closed.
release_merge_sibling_problem() {
  local siblings
  siblings=$(set -o pipefail; gh api --paginate --method GET "repos/$1/pulls?state=open&head=${1%%/*}:$2&per_page=100" \
    | jq -r --arg repo "$1" --arg ref "$2" --argjson number "$3" '.[]
        | select(.number != $number and .head.ref == $ref and .head.repo.full_name == $repo)
        | "#\(.number)"' | paste -sd, -) || { echo "cannot list the open PRs from $2"; return; }
  [[ -z "$siblings" ]] || echo "another open PR shares the branch $2: $siblings"
}

# release_merge_problems <pr.json> <changed-files> <config> <repo> <base> <bot-login> <tested-sha>:
# prints one line per reason the PR must not be merged, and nothing when it may be.
# <pr.json> is the REST pull request object, <changed-files> lists one path per line.
release_merge_problems() {
  local pr=$1 files=$2 config=$3 repo=$4 base=$5 bot=$6 tested_sha=$7 allowed file
  local pr_state pr_base_ref head_repo head_ref pr_author head_sha
  pr_state=$(jq -r '.state' "$pr")
  [[ "$pr_state" == open ]] || echo "the PR is $pr_state, not open"
  [[ "$(jq -r '.draft // false' "$pr")" == false ]] || echo "the PR is a draft"
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
  release_merge_sibling_problem "$repo" "$head_ref" "$(jq -r '.number' "$pr")"
  allowed=$(release_merge_allowlist "$config") || { echo "cannot read the allowlist from $config"; return; }
  # A failed `<"$files"` skips the loop and prints no problem, which would pass every file.
  [[ -r "$files" ]] || { echo "cannot read the changed files from $files"; return; }
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    grep -qxF -- "$file" <<<"$allowed" || echo "$file is not a file a release PR changes"
  done <"$files"
}

# release_merge_ci_passed <repo> <sha> <head-ref> <number> <base>: succeeds only when the latest CI
# run for the pull request event at <sha> has concluded with success. A run counts only when it is
# the workflow file .github/workflows/ci.yml (not a workflow that merely has the display name CI),
# ran for a head in <repo> itself (not a fork that pushed the same commit), on branch <head-ref>,
# and for pull request <number> into <base>. The runs API lists every open PR at the run's head, "not
# necessarily the pull requests that triggered the run", so only a run listing exactly that one PR
# counts; a run listing none or several counts for none (the gate refuses a PR that shares its
# head branch with another open PR, so this never strands a lone release PR). Of
# two runs created in the same second the higher id is the later. No run, a run
# still going, a failed run, and a success that is older than a later failure return 1. A lookup
# that fails (API error, unreadable response) returns 2, so it is not mistaken for "no run yet".
# The lookup reads with $RUNS_TOKEN (the workflow's own token, actions: read), not the App token,
# whose permissions do not include Actions.
release_merge_ci_passed() {
  local runs conclusion
  runs=$(GH_TOKEN=${RUNS_TOKEN-} gh api --paginate --method GET "repos/$1/actions/runs?head_sha=$2&event=pull_request&per_page=100") || return 2
  conclusion=$(jq -rs --arg repo "$1" --arg ref "$3" --argjson number "$4" --arg base "$5" '
    [.[].workflow_runs[]
     | select(.path == ".github/workflows/ci.yml"
              and .head_repository.full_name == $repo
              and .head_branch == $ref
              and ((.pull_requests // []) | length == 1
                   and .[0].number == $number and .[0].base.ref == $base))]
    | sort_by(.created_at, .id) | last | .conclusion // empty' <<<"$runs") || return 2
  [[ "$conclusion" == success ]]
}

# release_merge_sweep <repo> <base>: prints "<number> <head-sha>" for each open release-please PR
# in <repo> that targets <base> and whose head commit has passed CI. A head with no CI run yet, or
# one still running, is left out with a line on stderr saying why: its own CI completion triggers
# the merge. A PR whose CI lookup fails is left out too, but the sweep goes on with the others and
# exits non-zero at the end, so a 403 or an outage turns the job red instead of reading as "nothing
# to merge". The body is a subshell with pipefail, so a failed PR list fails the sweep whatever
# options the caller set.
release_merge_sweep() (
  set -o pipefail
  local number sha ref
  gh api --paginate --method GET "repos/$1/pulls?state=open&base=$2&per_page=100" \
    | jq -r --arg repo "$1" '.[] | select(.state == "open" and .head.repo.full_name == $repo
        and (.head.ref | startswith("release-please--"))) | "\(.number) \(.head.sha) \(.head.ref)"' \
    | {
        local lookup_failed=0
        while read -r number sha ref; do
          if release_merge_ci_passed "$1" "$sha" "$ref" "$number" "$2"; then
            echo "$number $sha"
          elif [[ $? == 1 ]]; then
            echo "Skipping PR #$number at $sha: no successful CI run for it alone at that head (none yet, still running, failed, or another open PR shares its branch)." >&2
          else
            echo "Cannot read the CI runs of PR #$number at $sha; rerun this job later." >&2
            lookup_failed=1
          fi
        done
        return "$lookup_failed"
      }
)

# release_merge_lost_race <repo> <number> <sha>: after a failed merge, succeeds (and says why) when
# the other trigger got there first: the PR is no longer open, or its head moved off <sha>. Fails
# for any other cause, so a real merge failure still fails the job.
release_merge_lost_race() {
  local state_and_head state head
  state_and_head=$(set -o pipefail; gh api "repos/$1/pulls/$2" | jq -r '[.state, .head.sha] | join(" ")') || return 1
  read -r state head <<<"$state_and_head"
  if [[ "$state" != open ]]; then
    echo "PR #$2 is $state: another run merged it first."
  elif [[ "$head" != "$3" ]]; then
    echo "PR #$2 head moved to $head since CI tested $3."
  else
    return 1
  fi
}
