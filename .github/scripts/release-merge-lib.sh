#!/usr/bin/env bash
# Sourced by the release-merge*.test.sh files and by the merge step of .github/workflows/release-merge.yml.
#
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

# release_merge_run_record_verdict <repo> <run-id> <number> <base>: reports, as its return code, whether
# the CI run <run-id> recorded that it ran for pull request <number> into <base>. ci.yml's pr-record
# job writes the record from the run's own pull_request event (issue #117); the runs API's
# pull_requests cannot say which PR triggered a run. Returns 0 when the record names that PR and
# base. Returns 1 when it does not count (an unreadable record, one naming another PR or base, or
# no run id) and 3 when the run has no unexpired pr-record artifact (a run still going may not have
# uploaded it yet, so release_merge_ci_outcome waits on it); both set release_merge_run_record_detail
# to why, as a phrase that follows "run <id> " or "the CI run <id> ". Returns 2 when a lookup fails (the artifact list, the
# download, a temp file, or no unzip), which the caller must not read as "does not count", and
# sets release_merge_run_record_detail to a whole phrase naming the lookup and the run. Reads with
# $RUNS_TOKEN, as release_merge_ci_outcome does.
# Sets release_merge_run_record_named to the record when it names another PR or base, and to nothing
# otherwise.
# SAFETY: a base branch's own ci.yml could write any record it likes. Only someone with write
# access can create that branch, and the gate's author, SHA and file-allowlist checks still apply.
release_merge_run_record_verdict() {
  local artifact_id record record_path zip_path byte_count nul_free_count read_status=0
  release_merge_run_record_detail=
  release_merge_run_record_named=
  record=
  if [[ -z "$2" ]]; then
    release_merge_run_record_detail="is unknown (no run id)"
    return 1
  fi
  command -v unzip >/dev/null || {
    release_merge_run_record_detail="unzip is not installed, so the pr-record of CI run $2 cannot be read"
    echo "$release_merge_run_record_detail" >&2
    return 2
  }
  artifact_id=$(set -o pipefail
    GH_TOKEN=${RUNS_TOKEN-} gh api --paginate --method GET "repos/$1/actions/runs/$2/artifacts?name=pr-record&per_page=100" \
      | jq -rs '[.[].artifacts[] | select(.name == "pr-record" and (.expired | not))] | sort_by(.id) | last | .id // empty') || {
    release_merge_run_record_detail="cannot list the artifacts of CI run $2"
    return 2
  }
  if [[ -z "$artifact_id" ]]; then
    release_merge_run_record_detail="has no pr-record artifact"
    return 3
  fi
  zip_path=$(mktemp "${work_dir:-${TMPDIR:-/tmp}}/pr-record.XXXXXX") || { release_merge_run_record_detail="cannot create a temp file for the pr-record of CI run $2"; return 2; }
  GH_TOKEN=${RUNS_TOKEN-} gh api "repos/$1/actions/artifacts/$artifact_id/zip" >"$zip_path" || {
    rm -f "$zip_path"
    release_merge_run_record_detail="cannot download the pr-record (artifact $artifact_id) of CI run $2"
    return 2
  }
  record_path=$(mktemp "${work_dir:-${TMPDIR:-/tmp}}/pr-record.XXXXXX") || {
    rm -f "$zip_path"
    release_merge_run_record_detail="cannot create a temp file for the pr-record of CI run $2"
    return 2
  }
  # pipefail here, whatever the caller set: a failed unzip must not hide behind head's success.
  # One byte past the limit tells a record that fits from one that was cut. The bytes go to a file
  # and are counted there: a bash string would drop NUL bytes and under-measure the record.
  (set -o pipefail; unzip -p "$zip_path" pr-record.json 2>/dev/null | head -c 4097 >"$record_path") || read_status=1
  rm -f "$zip_path"
  if (( read_status == 0 )); then
    byte_count=$(LC_ALL=C wc -c <"$record_path") || read_status=1
    nul_free_count=$(LC_ALL=C tr -d '\000' <"$record_path" | LC_ALL=C wc -c) || read_status=1
    (( byte_count <= 4096 && byte_count == nul_free_count )) || read_status=1
  fi
  if (( read_status == 0 )); then
    record=$(jq -sc 'if length == 1 then .[0] else error("not a record") end
                     | if type == "object" and (.number | type) == "number" and (.base | type) == "string"
                       then {number, base} else error("not a record") end' "$record_path" 2>/dev/null) || read_status=1
  fi
  rm -f "$record_path"
  # jq given only whitespace prints nothing and exits 0, so an empty record is unreadable too.
  [[ -n "$record" ]] || read_status=1
  if (( read_status != 0 )); then
    release_merge_run_record_detail="has an unreadable pr-record"
    return 1
  fi
  if jq -e --argjson number "$3" --arg base "$4" '.number == $number and .base == $base' <<<"$record" >/dev/null; then
    return 0
  fi
  release_merge_run_record_named=$record
  release_merge_run_record_detail="has a pr-record naming $record"
  return 1
}

# release_merge_ci_outcome <repo> <sha> <head-ref> <number> <base>: reports, as its return code,
# how the latest CI run for pull request <number> into <base> at <sha> ended. A run counts only
# when it is the workflow file .github/workflows/ci.yml (not a workflow that merely has the display
# name CI), ran for a head in <repo> itself (not a fork that pushed the same commit), on branch
# <head-ref>, as a pull_request event, and its pr-record artifact names <number> and <base> (see
# release_merge_run_record_verdict). The runs API's pull_requests is not used: it lists every open PR
# at the run's head, "not necessarily the pull requests that triggered the run", and omits a PR
# that has since closed. A run with no readable record, or a record naming another PR, counts for
# none; its reason goes to release_merge_ci_skip_reasons, one line per run. The one exception is a run
# with no record yet that is still going or did not succeed, which may be this PR's: the lookup
# returns 3 or 4 for it rather than count an older run. Of two runs created in the
# same second the higher id is the later. Returns 0 on success, 1 when no run counts, 3 when the
# latest run is still going, and 4 when it failed (a success older than a later failure is a
# failure). A lookup that fails (API error, unreadable response, the record lookup) returns 2, so
# it is not mistaken for "no run yet". Sets release_merge_ci_conclusion to what the latest run
# concluded, for the caller that reports a return of 4. On a return of 2 from a record lookup,
# release_merge_run_record_detail names it (it is empty when the runs lookup itself failed).
# Sets release_merge_ci_run_id to the id of the run it chose, which the sweep hands to the gate, and
# release_merge_ci_decoy_runs to one line for each run it skipped because its record names another PR.
# The lookup reads with $RUNS_TOKEN (the workflow's own token, actions: read), not the App token,
# whose permissions do not include Actions.
release_merge_ci_outcome() {
  local runs candidate_runs run_id run_conclusion record_status
  release_merge_ci_conclusion=
  release_merge_ci_run_id=
  release_merge_ci_skip_reasons=
  release_merge_ci_decoy_runs=
  release_merge_run_record_detail=
  runs=$(GH_TOKEN=${RUNS_TOKEN-} gh api --paginate --method GET "repos/$1/actions/runs?head_sha=$2&event=pull_request&per_page=100") || return 2
  candidate_runs=$(jq -rs --arg repo "$1" --arg ref "$3" '
    [.[].workflow_runs[]
     | select(.path == ".github/workflows/ci.yml"
              and .head_repository.full_name == $repo
              and .head_branch == $ref)]
    | sort_by(.created_at, .id) | reverse | .[]
    | "\(.id) \(if .conclusion == null then "running" else .conclusion end)"' <<<"$runs") || return 2
  release_merge_ci_conclusion=none
  # The list comes in on fd 3, so nothing the record lookup runs (gh, unzip) can read it from stdin.
  while read -r run_id run_conclusion <&3; do
    [[ -n "$run_id" ]] || continue
    release_merge_run_record_verdict "$1" "$run_id" "$4" "$5" && record_status=0 || record_status=$?
    # A run with no record yet, or one whose record cannot be read (a download cut short), may be
    # this PR's, so an older run must not stand in for it (fail closed): one still going holds the
    # PR, and a finished one that did not succeed reports its conclusion. A finished successful run
    # with no usable record is skipped, as one naming another PR is.
    if { [[ "$record_status" == 3 ]] || [[ "$record_status" == 1 && -z "$release_merge_run_record_named" ]]; } \
       && [[ "$run_conclusion" != success ]]; then
      release_merge_ci_conclusion=$run_conclusion
      release_merge_ci_run_id=$run_id
      break
    fi
    case "$record_status" in
      0) release_merge_ci_conclusion=$run_conclusion; release_merge_ci_run_id=$run_id; break ;;
      1|3) release_merge_ci_skip_reasons+="run $run_id $release_merge_run_record_detail"$'\n'
           [[ -z "$release_merge_run_record_named" ]] || release_merge_ci_decoy_runs+="run $run_id $release_merge_run_record_detail"$'\n' ;;
      *) release_merge_ci_conclusion=; return 2 ;;
    esac
  done 3<<<"$candidate_runs"
  case "$release_merge_ci_conclusion" in
    success) return 0 ;;
    none) return 1 ;;
    running) return 3 ;;
    *) return 4 ;;
  esac
}

# release_merge_sweep_warn_decoys <number>: prints a warning annotation, on stderr, for each run
# release_merge_ci_outcome skipped because its pr-record names another PR (a CI run a base branch put
# on this release head, issue #117). The line carries a base ref a fork controls, so % is escaped.
release_merge_sweep_warn_decoys() {
  local decoy
  while IFS= read -r decoy; do
    [[ -z "$decoy" ]] || echo "::warning title=Release PR #$1 skipped a CI run for another PR::${decoy//\%/%25}" >&2
  done <<<"$release_merge_ci_decoy_runs"
}

# release_merge_sweep <repo> <base>: prints "<number> <head-sha> <ci-run-id>" for each open
# release-please PR in <repo> that targets <base> and whose head commit has passed CI, with the id of
# the CI run that decided it. A head with no CI run yet, or
# one still running, is left out with a line on stderr saying why: its own CI completion triggers
# the merge. A head whose latest CI run failed is left out with a warning annotation. A PR whose CI
# lookup fails is left out too, with an error annotation naming the PR, but the sweep goes on with
# the others and exits non-zero at the end, so a 403 or an outage turns the job red instead of
# reading as "nothing to merge". A failed PR list is its own error annotation and fails the sweep.
# The body is a subshell, so the sweep fails whatever options the caller set.
release_merge_sweep() (
  set -o pipefail
  local number sha ref ci_status open_prs
  open_prs=$(gh api --paginate --method GET "repos/$1/pulls?state=open&base=$2&per_page=100" | jq -c '.') || {
    echo "::error title=Release PR sweep failed::cannot list the open release PRs" >&2
    return 1
  }
  jq -r --arg repo "$1" '.[] | select(.state == "open" and .head.repo.full_name == $repo
        and (.head.ref | startswith("release-please--"))) | "\(.number) \(.head.sha) \(.head.ref)"' <<<"$open_prs" \
    | {
        local lookup_failed=0
        while read -r number sha ref; do
          release_merge_ci_outcome "$1" "$sha" "$ref" "$number" "$2" && ci_status=0 || ci_status=$?
          release_merge_sweep_warn_decoys "$number"
          case "$ci_status" in
            0) echo "$number $sha $release_merge_ci_run_id" ;;
            1) echo "Skipping PR #$number at $sha: no CI run at that head whose pr-record names it" \
                 "(none yet, or the run has no record naming this PR into $2)." >&2
               [[ -z "$release_merge_ci_skip_reasons" ]] || sed 's/^/  - /' <<<"${release_merge_ci_skip_reasons%$'\n'}" >&2 ;;
            3) echo "Skipping PR #$number at $sha: CI is still running;" \
                 "its completion triggers the merge." >&2 ;;
            4) printf '%s%s\n' "::warning title=Release PR #$number not merged::" \
                 "CI concluded ${release_merge_ci_conclusion//\%/%25} at $sha; fix it or rerun CI." >&2 ;;
            *)
              echo "::error title=Release PR #$number not merged::cannot read the CI runs at $sha${release_merge_run_record_detail:+ (${release_merge_run_record_detail//\%/%25})}" >&2
              lookup_failed=1 ;;
          esac
        done
        return "$lookup_failed"
      }
)

# release_merge_lost_race <repo> <number> <sha>: after a failed merge, succeeds (and says why) when
# the other trigger got there first: the PR is no longer open, or its head moved off <sha>. The
# message says whether it was merged or closed without merging (the same PR read gives `merged`).
# Fails for any other cause, so a real merge failure still fails the job: returns 1 when the PR is
# still open at <sha>, and 2 when its state could not be read. A PR closed without being merged also
# gets a notice annotation on stderr, so it shows on the run summary (stdout stays the one message).
release_merge_lost_race() {
  local pr_fields state head merged
  pr_fields=$(set -o pipefail
    gh api "repos/$1/pulls/$2" \
      | jq -r '[.state, .head.sha, (.merged // false)] | join(" ")') || return 2
  read -r state head merged <<<"$pr_fields"
  if [[ "$state" != open && "$merged" == true ]]; then
    echo "PR #$2 is $state: another run merged it first."
  elif [[ "$state" != open ]]; then
    echo "PR #$2 was $state without being merged."
    echo "::notice title=Release PR #$2 not merged::PR #$2 was $state without being merged." >&2
  elif [[ "$head" != "$3" ]]; then
    echo "PR #$2 head moved to $head since CI tested $3."
  else
    return 1
  fi
}

# release_merge_fail <number> <reason>: prints an error annotation naming PR <number> and returns 1.
# Each failing step of release_merge_pr_if_gate_passes ends with it, so the log says which PR
# failed.
release_merge_fail() {
  echo "::error title=Release PR #$1 not merged::${2//\%/%25}"
  return 1
}

# release_merge_merge_failure_reason <tested-sha> <lost-race-status> <stderr-file>: prints why a failed
# merge was not a lost race, for release_merge_fail: whether the PR is still open at <tested-sha>
# (<lost-race-status> 1) or its state could not be read (2), then the first non-empty line of gh's
# stderr in <stderr-file>, with the CR of a CRLF line and surrounding blanks removed so the
# annotation stays on one line. Printing only: a missing or empty file just leaves out gh's reason.
release_merge_merge_failure_reason() {
  local cause="the PR is still open at that commit" detail
  [[ "$2" != 2 ]] || cause="the PR's state could not be read"
  detail=$(tr -d '\r' <"$3" 2>/dev/null | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | grep -m1 . || true)
  echo "the merge command failed at $1 and $cause${detail:+: $detail}"
}

# release_merge_replay_stderr <file>: sends the stderr a command left in <file> to the log, as if
# the command had not been redirected, and deletes the file. /dev/null (no temp file) is left alone.
release_merge_replay_stderr() {
  [[ -f "$1" ]] || return 0
  cat "$1" >&2
  rm -f "$1"
}

# release_merge_record_problem <ci-run-id> <number>: appends to the caller's `problems` the reason
# the pr-record of CI run <ci-run-id> does not tie that run to PR <number> into $BASE, and nothing
# when it does. A lookup that fails prints an error annotation and returns 1, as a refusal would
# hide it.
release_merge_record_problem() {
  local verdict
  release_merge_run_record_verdict "$REPO" "$1" "$2" "$BASE" && verdict=0 || verdict=$?
  case "$verdict" in
    0) ;;
    1|3) problems+=${problems:+$'\n'}"the CI run ${1:+$1 }$release_merge_run_record_detail" ;;
    *) release_merge_fail "$2" "cannot check the gate: $release_merge_run_record_detail" || return 1 ;;
  esac
}

# release_merge_pr_if_gate_passes <number> <tested-sha> <ci-run-id>: runs the gate on PR <number>
# against <tested-sha>, the commit CI tested, and squash-merges it when the gate finds nothing. The
# gate also requires the pr-record of CI run <ci-run-id> to name <number> into $BASE; an empty id is
# refused. The CI path passes the triggering run, the sweep the run release_merge_ci_outcome chose
# (so a swept PR's record is downloaded twice). A refusal returns 0, so the job stays green. A
# failed lookup, or a failed merge that is not a lost race, returns 1. Reads REPO, BASE, BOT_LOGIN, work_dir (a directory for temp files) and
# RELEASE_MERGE_CONFIG (the release-please config, default release-please-config.json).
# shellcheck disable=SC2154,SC2153 # the variables above come from the caller
release_merge_pr_if_gate_passes() {
  local number=$1 tested_sha=$2 ci_run_id=$3 did_merge=0 pr files raw listed problems problem merge_stderr
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

  listed=$(jq -s '[.[][] | .filename] | length' "$raw") \
    || release_merge_fail "$number" "cannot count the changed files (at $tested_sha)" || return 1
  problems=$(release_merge_problems "$pr" "$files" "${RELEASE_MERGE_CONFIG:-release-please-config.json}" \
    "$REPO" "$BASE" "$BOT_LOGIN" "$tested_sha" "$listed") \
    || release_merge_fail "$number" "cannot check the gate (at $tested_sha)" || return 1
  release_merge_record_problem "$ci_run_id" "$number" || return 1
  rm -f "$pr" "$files" "$raw"
  # A refusal returns 0, so the job is green. Each reason also goes out as a warning
  # annotation, which shows on the run summary without opening the log. Reasons carry
  # PR-controlled text (branch, author, file paths): each log line starts with "- " so
  # none is read as a workflow command, and % is escaped as the annotation format requires.
  if [[ -n "$problems" ]]; then
    echo "Not merging PR #$number at $tested_sha:"
    while IFS= read -r problem; do
      echo "- $problem"
      echo "::warning title=Release PR #$number not merged::${problem//\%/%25} (at $tested_sha)"
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
    echo "::notice title=Release PR #$number merged::Merged PR #$number at $tested_sha."
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
