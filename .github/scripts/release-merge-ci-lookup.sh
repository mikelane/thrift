#!/usr/bin/env bash
# Sourced by release-merge-lib.sh: the CI-run lookups and the sweep of the release-merge gate.

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
# Sets release_merge_run_record_detail (see above) and release_merge_run_record_named, the record
# when it names another PR or base and nothing otherwise. The record itself is the local
# release_merge_run_record_json, which release_merge_read_run_record fills in.
# SAFETY: a base branch's own ci.yml could write any record it likes. Only someone with write
# access can create that branch, and the gate's author, SHA and file-allowlist checks still apply.
release_merge_run_record_verdict() {
  local artifact_id release_merge_run_record_json
  release_merge_run_record_detail=
  release_merge_run_record_named=
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
  release_merge_read_run_record "$1" "$2" "$artifact_id" || return $?
  if jq -e --argjson number "$3" --arg base "$4" '.number == $number and .base == $base' <<<"$release_merge_run_record_json" >/dev/null; then
    return 0
  fi
  release_merge_run_record_named=$release_merge_run_record_json
  release_merge_run_record_detail="has a pr-record naming $release_merge_run_record_json"
  return 1
}

# release_merge_read_run_record <repo> <run-id> <artifact-id>: downloads the pr-record artifact
# <artifact-id> of CI run <run-id> and sets release_merge_run_record_json to its {number, base} object.
# Returns 0 when it read one, 1 when the record is unreadable and 2 when a lookup failed (a temp file
# or the download); both failures set release_merge_run_record_detail, as the verdict documents.
release_merge_read_run_record() {
  local zip_path record_path
  release_merge_run_record_json=
  zip_path=$(mktemp "${work_dir:-${TMPDIR:-/tmp}}/pr-record.XXXXXX") || { release_merge_run_record_detail="cannot create a temp file for the pr-record of CI run $2"; return 2; }
  GH_TOKEN=${RUNS_TOKEN-} gh api "repos/$1/actions/artifacts/$3/zip" >"$zip_path" || {
    rm -f "$zip_path"
    release_merge_run_record_detail="cannot download the pr-record (artifact $3) of CI run $2"
    return 2
  }
  record_path=$(mktemp "${work_dir:-${TMPDIR:-/tmp}}/pr-record.XXXXXX") || {
    rm -f "$zip_path"
    release_merge_run_record_detail="cannot create a temp file for the pr-record of CI run $2"
    return 2
  }
  release_merge_run_record_json=$(release_merge_parse_run_record "$zip_path" "$record_path") || release_merge_run_record_json=
  rm -f "$zip_path" "$record_path"
  [[ -n "$release_merge_run_record_json" ]] || { release_merge_run_record_detail="has an unreadable pr-record"; return 1; }
}

# release_merge_parse_run_record <zip> <scratch-file>: prints the {number, base} object that the pr-record.json
# in <zip> holds, using <scratch-file> to measure it, and returns 1 when the record is unreadable.
release_merge_parse_run_record() {
  local byte_count nul_free_count record
  # pipefail here, whatever the caller set: a failed unzip must not hide behind head's success.
  # One byte past the limit tells a record that fits from one that was cut. The bytes go to a file
  # and are counted there: a bash string would drop NUL bytes and under-measure the record.
  (set -o pipefail; unzip -p "$1" pr-record.json 2>/dev/null | head -c 4097 >"$2") || return 1
  byte_count=$(LC_ALL=C wc -c <"$2") || return 1
  nul_free_count=$(LC_ALL=C tr -d '\000' <"$2" | LC_ALL=C wc -c) || return 1
  (( byte_count <= 4096 && byte_count == nul_free_count )) || return 1
  record=$(jq -sc 'if length == 1 then .[0] else error("not a record") end
                   | if type == "object" and (.number | type) == "number" and (.base | type) == "string"
                     then {number, base} else error("not a record") end' "$2" 2>/dev/null) || return 1
  # jq given only whitespace prints nothing and exits 0, so an empty record is unreadable too.
  [[ -n "$record" ]] || return 1
  echo "$record"
}

# release_merge_ci_candidate_runs <repo> <head-ref>: reads the runs API response on stdin and prints
# "<id> <conclusion>" for each CI run that could be the PR's, newest first (`running` for a run with
# no conclusion yet).
release_merge_ci_candidate_runs() {
  jq -rs --arg repo "$1" --arg ref "$2" '
    [.[].workflow_runs[]
     | select(.path == ".github/workflows/ci.yml"
              and .head_repository.full_name == $repo
              and .head_branch == $ref)]
    | sort_by(.created_at, .id) | reverse | .[]
    | "\(.id) \(if .conclusion == null then "running" else .conclusion end)"'
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
  candidate_runs=$(release_merge_ci_candidate_runs "$1" "$3" <<<"$runs") || return 2
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
    [[ -z "$decoy" ]] || echo "::warning title=$(release_merge_annotation_title "$1" "skipped a CI run for another PR")::${decoy//\%/%25}" >&2
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
            4) printf '%s%s\n' "::warning title=$(release_merge_annotation_title "$number" "not merged")::" \
                 "CI concluded ${release_merge_ci_conclusion//\%/%25} at $sha; fix it or rerun CI." >&2 ;;
            *)
              echo "::error title=$(release_merge_annotation_title "$number" "not merged")::cannot read the CI runs at $sha${release_merge_run_record_detail:+ (${release_merge_run_record_detail//\%/%25})}" >&2
              lookup_failed=1 ;;
          esac
        done
        return "$lookup_failed"
      }
)
