#!/usr/bin/env bash
# Sourced by the release-merge*.test.sh files and by the merge step of .github/workflows/release-merge.yml.

# The CI-run lookups and the sweep, and the merge-failure helpers, live beside this file. The merge
# job sparse-checks-out each file by name, so any new file in this directory must be added to
# release-merge.yml and to .github/tests/release-merge-workflow.expected.json too.
release_merge_lib_dir=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd) || return 1
# release_merge_load_sibling <file>: sources <file> from this directory. Whatever goes wrong, the step
# stops before any gate runs, on bash 3.2 and 5 alike. Only a missing or unreadable sibling also gets
# an ::error annotation naming the file. A sibling that fails while loading (a syntax error, a failing
# command, an unset variable) stops the step non-zero with no annotation: `source` is a plain
# statement so set -e stays in force inside the sibling, which `source "$file" || ...` or
# `[[ ... ]] && source "$file"` would suspend on bash 5.
release_merge_load_sibling() {
  local file=$release_merge_lib_dir/$1
  if [[ ! -r "$file" ]]; then
    echo "::error title=Release merge failed::cannot load $file"
    return 1
  fi
  # shellcheck disable=SC1090 # the two siblings are named by the calls below
  source "$file"
}
# The status check is its own statement, not `|| return 1` on the load: that would suspend set -e inside
# the sibling on bash 5. Under set -e a failed load exits the shell; without it, this line stops the source.
release_merge_load_sibling release-merge-ci-lookup.sh
(( $? == 0 )) || return 1
release_merge_load_sibling release-merge-failure.sh
(( $? == 0 )) || return 1

# release_merge_allowlist <config>: prints each file a release PR may change: the manifest, and for
# every package in release-please-config.json its changelog, its version file and its extra-files.
# A simple package's version file defaults to version.txt, as release-please's Simple strategy does
# (the effective release-type is the package's, else the top level's, else release-please's node).
release_merge_allowlist() {
  jq -r '
    def path_in_package($dir; $file):
      ($file | sub("^/"; "")) as $relative
      | if ($file | startswith("/")) or $dir == "." or $dir == "" then $relative else "\($dir)/\($relative)" end;
    . as $config
    | ".release-please-manifest.json",
      (.packages | to_entries[] | .key as $dir | .value as $pkg
        | def setting($key): $pkg[$key] // $config[$key];
          ($pkg["release-type"] // $config["release-type"] // "node") as $release_type
          | path_in_package($dir; setting("changelog-path") // "CHANGELOG.md"),
          ((setting("version-file") // (if $release_type == "simple" then "version.txt" else empty end))
            | path_in_package($dir; .)),
          (setting("extra-files")[]? | (if type == "string" then . else .path end) // empty
            | path_in_package($dir; .)))
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
# sibling no CI run could be tied to one PR by that list. This is defence in depth now that each
# run's pr-record ties it to one PR (see release_merge_run_record_verdict). A lookup that fails returns 1 with its reason on stderr,
# not a reason on stdout: a refusal is a policy decision, and a failed lookup is not one.
release_merge_sibling_problem() {
  local siblings
  siblings=$(set -o pipefail; gh api --paginate --method GET "repos/$1/pulls?state=open&head=${1%%/*}:$(jq -rn --arg v "$2" '$v|@uri')&per_page=100" \
    | jq -r --arg repo "$1" --arg ref "$2" --argjson number "$3" '.[]
        | select(.number != $number and .head.ref == $ref and .head.repo.full_name == $repo)
        | "#\(.number)"' | paste -sd, -) || { echo "cannot list the open PRs from $2" >&2; return 1; }
  [[ -z "$siblings" ]] || echo "another open PR shares the branch $2: $siblings"
}

# release_merge_problems <pr.json> <changed-files> <config> <repo> <base> <bot-login> <tested-sha> <listed>:
# prints one line per reason the PR must not be merged, and nothing when it may be.
# <pr.json> is the REST pull request object, <changed-files> lists one path per line, and <listed>
# is how many files the files API listed (its .filename entries, not the lines of <changed-files>,
# which a rename makes two). The API lists at most 3000 files, so a PR whose changed_files differs
# from <listed>, or is over 3000, has files the allowlist never saw. A lookup that
# fails (the open PR list, the allowlist, the changed-files list) returns 1 with its reason on
# stderr and prints no reason, so the caller fails the job instead of reading it as a refusal.
release_merge_problems() {
  local pr=$1 files=$2 config=$3 repo=$4 base=$5 bot=$6 tested_sha=$7 listed=$8 allowed file
  local pr_state pr_base_ref head_repo head_ref pr_author head_sha changed_files
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
  changed_files=$(jq -r '.changed_files | if type == "number" then . else "" end' "$pr")
  if [[ -z "$changed_files" ]]; then
    echo "the PR does not say how many files it changes"
  else
    (( changed_files <= 3000 )) || echo "the PR changes $changed_files files, more than the 3000 the files API lists"
    (( changed_files == listed )) || echo "the PR changes $changed_files files but the files API listed $listed"
  fi
  release_merge_sibling_problem "$repo" "$head_ref" "$(jq -r '.number' "$pr")" || return 1
  allowed=$(release_merge_allowlist "$config") || { echo "cannot read the allowlist from $config" >&2; return 1; }
  # A failed `<"$files"` skips the loop and prints no problem, which would pass every file.
  [[ -r "$files" ]] || { echo "cannot read the changed files from $files" >&2; return 1; }
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    grep -qxF -- "$file" <<<"$allowed" || echo "$file is not a file a release PR changes"
  done <"$files"
}

# release_merge_record_problem <ci-run-id> <number> <tested-sha>: appends to the caller's `problems`
# the reason the pr-record of CI run <ci-run-id> does not tie that run to PR <number> into $BASE,
# and nothing when it does. A lookup that fails prints an error annotation naming <tested-sha> and
# returns 1, as a refusal would hide it.
# shellcheck disable=SC2154 # release_merge_run_record_detail is set by the ci-lookup sibling
release_merge_record_problem() {
  local verdict
  release_merge_run_record_verdict "$REPO" "$1" "$2" "$BASE" && verdict=0 || verdict=$?
  case "$verdict" in
    0) ;;
    1|3) problems+=${problems:+$'\n'}"the CI run ${1:+$1 }$release_merge_run_record_detail" ;;
    *) release_merge_fail "$2" "cannot check the gate: $release_merge_run_record_detail (at $3)" || return 1 ;;
  esac
}

# release_merge_pr_if_gate_passes <number> <tested-sha> <ci-run-id>: runs the gate on PR <number>
# against <tested-sha>, the commit CI tested, and squash-merges it when the gate finds nothing. The
# gate also requires the pr-record of CI run <ci-run-id> to name <number> into $BASE; an empty id is
# refused. The CI path passes the triggering run, the sweep the run release_merge_ci_outcome chose
# (so a swept PR's record is downloaded twice). A refusal returns 0, so the job stays green. A
# failed lookup (including a PR response that is not exactly one JSON object), or a failed merge
# that is not a lost race, returns 1. Reads REPO, BASE, BOT_LOGIN, work_dir (a directory for temp
# files) and RELEASE_MERGE_CONFIG (the release-please config, default release-please-config.json).
# shellcheck disable=SC2154,SC2153 # the variables above come from the caller
release_merge_pr_if_gate_passes() {
  local number=$1 tested_sha=$2 ci_run_id=$3 did_merge=0 pr files raw listed problems problem merge_stderr gate_stderr gate_status
  # shellcheck disable=SC2034 # read by release_merge_annotation_title in release-merge-failure.sh
  release_merge_plugin_label=
  # The sweep calls this inside `||`, where set -e is off: each step that can fail returns.
  pr=$(mktemp "$work_dir/pr.XXXXXX") \
    || release_merge_fail "$number" "cannot create a temp file for the PR (at $tested_sha)" || return 1
  files=$(mktemp "$work_dir/files.XXXXXX") \
    || release_merge_fail "$number" "cannot create a temp file for the changed file names (at $tested_sha)" || return 1
  raw=$(mktemp "$work_dir/raw.XXXXXX") \
    || release_merge_fail "$number" "cannot create a temp file for the files API response (at $tested_sha)" || return 1
  gh api "repos/$REPO/pulls/$number" >"$pr" \
    || release_merge_fail "$number" "cannot fetch the PR (at $tested_sha)" || return 1
  # Two steps, not a pipe: a failed fetch must not read as "no changed files" without pipefail.
  gh api --paginate "repos/$REPO/pulls/$number/files" >"$raw" \
    || release_merge_fail "$number" "cannot fetch the changed files (at $tested_sha)" || return 1
  release_merge_changed_files <"$raw" >"$files" \
    || release_merge_fail "$number" "cannot read the changed files (at $tested_sha)" || return 1
  release_merge_set_plugin_label "$files"

  listed=$(jq -s '[.[][] | .filename] | length' "$raw") \
    || release_merge_fail "$number" "cannot count the changed files (at $tested_sha)" || return 1
  # A fetch that is not exactly one JSON object would otherwise read as refusals built from empty
  # fields; `jq -e` alone checks only the last value of a stream, so slurp and count.
  jq -se 'length == 1 and (.[0] | type) == "object"' "$pr" >/dev/null 2>&1 \
    || release_merge_fail "$number" "cannot parse the PR (at $tested_sha)" || return 1
  # The gate's stderr goes to a file so a failure's annotation can name the lookup that failed; it
  # is replayed to the log either way. With no temp file it goes nowhere and the annotation leaves
  # the cause out. The gate still runs.
  gate_stderr=$(mktemp "$work_dir/gate-stderr.XXXXXX") || gate_stderr=/dev/null
  problems=$(release_merge_problems "$pr" "$files" "${RELEASE_MERGE_CONFIG:-release-please-config.json}" \
    "$REPO" "$BASE" "$BOT_LOGIN" "$tested_sha" "$listed" 2>"$gate_stderr") && gate_status=0 || gate_status=$?
  if [[ "$gate_status" != 0 ]]; then
    release_merge_fail "$number" "$(release_merge_gate_failure_reason "$tested_sha" "$gate_stderr")" || true
    release_merge_replay_stderr "$gate_stderr"
    return 1
  fi
  release_merge_replay_stderr "$gate_stderr"
  release_merge_record_problem "$ci_run_id" "$number" "$tested_sha" || return 1
  rm -f "$pr" "$files" "$raw"
  # A refusal returns 0, so the job is green. Each reason also goes out as a warning
  # annotation, which shows on the run summary without opening the log. Reasons carry
  # PR-controlled text (branch, author, file paths): each log line starts with "- " so
  # none is read as a workflow command, and % is escaped as the annotation format requires.
  if [[ -n "$problems" ]]; then
    echo "Not merging PR #$number at $tested_sha:"
    while IFS= read -r problem; do
      echo "- $problem"
      echo "::warning title=$(release_merge_annotation_title "$number" "not merged")::${problem//\%/%25} (at $tested_sha)"
    done <<<"$problems"
    return 0
  fi

  echo "Merging PR #$number at $tested_sha."
  # gh's stderr goes to a file so a failure's annotation can carry its reason; with no temp file it
  # goes nowhere, and the annotation just leaves the reason out. The merge still runs.
  merge_stderr=$(mktemp "$work_dir/merge-stderr.XXXXXX") || merge_stderr=/dev/null
  # One line: the workflow test selects the merge command by its start. `did_merge` tells a real
  # merge from a lost race, which also leaves the chain successfully. $? in the annotation is the
  # lost-race lookup's status.
  gh pr merge "$number" --repo "$REPO" --admin --squash --match-head-commit "$tested_sha" </dev/null 2>"$merge_stderr" && did_merge=1 || release_merge_lost_race "$REPO" "$number" "$tested_sha" || release_merge_fail "$number" "$(release_merge_merge_failure_reason "$tested_sha" "$?" "$merge_stderr")" || { release_merge_replay_stderr "$merge_stderr"; return 1; }
  release_merge_replay_stderr "$merge_stderr"
  [[ "$did_merge" == 0 ]] || {
    echo "Merged PR #$number at $tested_sha."
    echo "::notice title=$(release_merge_annotation_title "$number" merged)::Merged PR #$number at $tested_sha."
  }
}

# release_merge_triggering_run_is_latest <number> <tested-sha> <head-ref> <ci-run-id>: succeeds when
# the CI run that triggered the merge is the run release_merge_ci_outcome chooses for PR <number> at
# <tested-sha>, the one the sweep would hand the gate. A manual rerun of an older success after a
# newer failure is not, and gets a warning annotation naming both run ids. Returns 1 for that
# refusal and 2 when the lookup fails (after an error annotation), which turns the job red. It only
# picks the run: the gate still checks that run's record at its own site.
# shellcheck disable=SC2154 # BASE comes from the caller
release_merge_triggering_run_is_latest() {
  local outcome latest
  release_merge_ci_outcome "$REPO" "$2" "$3" "$1" "$BASE" && outcome=0 || outcome=$?
  if [[ "$outcome" == 2 ]]; then
    release_merge_fail "$1" "cannot read the CI runs at $2${release_merge_run_record_detail:+ ($release_merge_run_record_detail)}" || return 2
  fi
  if [[ "$outcome" == 0 && "$release_merge_ci_run_id" == "$4" ]]; then
    return 0
  fi
  latest=${release_merge_ci_run_id:+run $release_merge_ci_run_id}
  echo "::warning title=Release PR #$1 not merged::the CI run ${4:-(unknown)} that triggered this merge is not the latest CI run at $2 for this PR (latest: ${latest:-none})"
  return 1
}

# release_merge_run: what the merge step does. When TRIGGER is "Release Please", sweeps every open
# release PR whose CI passed at its head; otherwise merges the open PR from BRANCH at
# CI_TESTED_SHA. Returns 1 when any lookup or merge failed, and goes on to the other PRs first.
# Reads REPO, OWNER, BASE, TRIGGER, BRANCH, CI_TESTED_SHA, CI_RUN_ID (the triggering run) and what
# the function above reads.
release_merge_run() {
  local failed=0 candidates number sha run_id latest_status
  if [[ "$TRIGGER" == "Release Please" ]]; then
    # A failed CI lookup for one PR must not stop the others, but it must fail the job.
    candidates=$(release_merge_sweep "$REPO" "$BASE") || failed=1
    if [[ "$failed" == 1 ]]; then
      printf '%s%s\n' "::error title=Release PR sweep failed::" \
        "A lookup failed, so a PR may not have been merged."
    fi
    if [[ -z "$candidates" ]]; then
      [[ "$failed" == 1 ]] || echo "No open release PR has passed CI at its head. Nothing to merge."
      return "$failed"
    fi
    while read -r number sha run_id; do
      release_merge_pr_if_gate_passes "$number" "$sha" "$run_id" || failed=1
    done <<<"$candidates"
    return "$failed"
  fi

  # BRANCH is the head branch of the triggering run, which a fork controls: % is escaped in the
  # annotation.
  number=$(release_merge_open_pr_number "$REPO" "$OWNER" "$BRANCH" "$BASE") || {
    printf '%s%s\n' "::error title=Release merge failed::" \
      "cannot look up the open PR from ${BRANCH//\%/%25} in $REPO"
    return 1
  }
  if [[ -z "$number" ]]; then
    echo "No open PR from $BRANCH in $REPO. Nothing to merge."
    return 0
  fi
  release_merge_triggering_run_is_latest "$number" "$CI_TESTED_SHA" "$BRANCH" "${CI_RUN_ID-}" && latest_status=0 || latest_status=$?
  case "$latest_status" in
    0) ;;
    1) return 0 ;;
    *) return 1 ;;
  esac
  release_merge_pr_if_gate_passes "$number" "$CI_TESTED_SHA" "${CI_RUN_ID-}"
}
