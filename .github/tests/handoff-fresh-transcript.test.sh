#!/usr/bin/env bash
# scripts/live/handoff/common.sh: fresh_transcript_path finds the fresh session's transcript beside the
# old one, not in subagent transcripts or other projects. Hermetic: CLAUDE_CONFIG_DIR is a temp dir.
# Usage: handoff-fresh-transcript.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"
# shellcheck source=/dev/null
source "$REPO_ROOT/scripts/live/handoff/common.sh"

NOTE='{"type":"user","message":{"content":"Handoff from the previous session (old-1), written by"}}'

report() { [[ "$2" == "$3" ]] || fail "$1: got [$2] want [$3]"; }

# setup_layout <root>: the old session, the fresh session, and two decoys that quote the note line.
setup_layout() {
  local p=$1/projects
  mkdir -p "$p/-Users-x-dev-thrift/old-1/subagents" "$p/-Users-x-dev-thrift/fresh-2/subagents" \
    "$p/-Users-other-dev-proj/x/subagents"
  printf '%s\n' '{"type":"user","message":{"content":"say apple"}}' >"$p/-Users-x-dev-thrift/old-1.jsonl"
  printf '%s\n' "$NOTE" >"$p/-Users-x-dev-thrift/fresh-2.jsonl"
  printf '%s\n' "$NOTE" >"$p/-Users-x-dev-thrift/fresh-2/subagents/agent-b.jsonl"
  printf '%s\n' "$NOTE" >"$p/-Users-other-dev-proj/x/subagents/agent-a.jsonl"
}

test_returns_the_fresh_sibling_not_the_decoys() {
  local T got
  T=$(mktemp -d)
  setup_layout "$T"
  got=$(CLAUDE_CONFIG_DIR=$T fresh_transcript_path old-1)
  rm -rf "$T"
  report test_returns_the_fresh_sibling_not_the_decoys "$got" "$T/projects/-Users-x-dev-thrift/fresh-2.jsonl"
}

test_ignores_subagent_transcripts() {
  local T got
  T=$(mktemp -d)
  mkdir -p "$T/projects/-Users-x-dev-thrift/old-1/subagents" "$T/projects/-Users-x-dev-thrift/fresh-2/subagents"
  printf '%s\n' '{"type":"user","message":{"content":"say apple"}}' >"$T/projects/-Users-x-dev-thrift/old-1.jsonl"
  printf '%s\n' "$NOTE" >"$T/projects/-Users-x-dev-thrift/old-1/subagents/agent-a1.jsonl"
  printf '%s\n' "$NOTE" >"$T/projects/-Users-x-dev-thrift/fresh-2/subagents/agent-a2.jsonl"
  got=$(CLAUDE_CONFIG_DIR=$T fresh_transcript_path old-1)
  rm -rf "$T"
  report test_ignores_subagent_transcripts "$got" ""
}

test_returns_nothing_when_the_old_transcript_is_missing() {
  local T got
  T=$(mktemp -d)
  setup_layout "$T"
  rm -f "$T/projects/-Users-x-dev-thrift/old-1.jsonl"
  got=$(CLAUDE_CONFIG_DIR=$T fresh_transcript_path old-1)
  rm -rf "$T"
  report test_returns_nothing_when_the_old_transcript_is_missing "$got" ""
}

test_excludes_the_old_session_file() {
  local T got
  T=$(mktemp -d)
  setup_layout "$T"
  printf '%s\n' "$NOTE" >>"$T/projects/-Users-x-dev-thrift/old-1.jsonl"
  rm -f "$T/projects/-Users-x-dev-thrift/fresh-2.jsonl"
  got=$(CLAUDE_CONFIG_DIR=$T fresh_transcript_path old-1)
  rm -rf "$T"
  report test_excludes_the_old_session_file "$got" ""
}

run_tests "$@"
