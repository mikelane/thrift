#!/usr/bin/env bash
# Sourced by release-merge-lib.sh: the helpers that say how a merge attempt ended.

# release_merge_lost_race <repo> <number> <sha>: after a failed merge, succeeds (and says why) when
# the other trigger got there first: the PR is no longer open, or its head moved off <sha>. The
# message says whether it was merged or closed without merging (the same PR read gives `merged`).
# Fails for any other cause, so a real merge failure still fails the job: returns 1 when the PR is
# still open at <sha>, and 2 when its state could not be read (the response is not exactly one JSON
# object with a string `state`: `null`, `{}`, an empty body). A PR closed without being merged also
# gets a notice annotation on stderr, so it shows on the run summary (stdout stays the one message).
release_merge_lost_race() {
  local pr_fields state head merged
  pr_fields=$(set -o pipefail
    gh api "repos/$1/pulls/$2" \
      | jq -rs 'if length == 1 and (.[0] | type) == "object" and (.[0].state | type) == "string"
               then .[0] | [.state, .head.sha, (.merged // false)] | join(" ")
               else error("not one PR object") end') || return 2
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

# release_merge_merge_failure_reason <tested-sha> <lost-race-status> <stderr-file>: prints why a
# failed merge was not a lost race, for release_merge_fail: whether the PR is still open at
# <tested-sha> (<lost-race-status> 1) or its state could not be read (2), then the first non-empty
# line of gh's stderr in <stderr-file>, with the CR of a CRLF line and surrounding blanks removed so
# the annotation stays on one line. Printing only: a missing or empty file just leaves out gh's
# reason.
release_merge_merge_failure_reason() {
  local cause="the PR is still open at that commit" detail
  [[ "$2" != 2 ]] || cause="the PR's state could not be read"
  detail=$(release_merge_stderr_lines "$3" | head -n 1)
  echo "the merge command failed at $1 and $cause${detail:+: $detail}"
}

# release_merge_stderr_lines <file>: prints the non-empty lines of the stderr in <file>, each with
# the CR of a CRLF line and surrounding blanks removed, so one of them fits on an annotation line.
# A missing or unreadable file prints nothing.
release_merge_stderr_lines() {
  { LC_ALL=C tr -d '\r' <"$1"; } 2>/dev/null \
    | LC_ALL=C sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | grep . || true
}

# release_merge_gate_failure_reason <tested-sha> <stderr-file>: prints why the gate could not be
# checked, for release_merge_fail: the last non-empty line release_merge_problems left in
# <stderr-file>, which is its own reason (gh's or jq's message comes before it), then the commit.
release_merge_gate_failure_reason() {
  local detail
  detail=$(release_merge_stderr_lines "$2" | tail -n 1)
  echo "cannot check the gate${detail:+: $detail} (at $1)"
}

# release_merge_replay_stderr <file>: sends the stderr a command left in <file> to the log, as if
# the command had not been redirected, and deletes the file. /dev/null (no temp file) is left alone.
release_merge_replay_stderr() {
  [[ -f "$1" ]] || return 0
  cat "$1" >&2
  rm -f "$1"
}
