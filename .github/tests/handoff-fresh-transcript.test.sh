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

# write_transcript <file> <jsonl-lines...>
write_transcript() { local file=$1; shift; printf '%s\n' "$@" >"$file"; }

STRING_USER='{"type":"user","message":{"content":"five"}}'
BLOCKS_USER='{"type":"user","message":{"content":[{"type":"text","text":"si"},{"type":"text","text":"x"}]}}'
TOOL_RESULT_USER='{"type":"user","message":{"content":[{"type":"tool_result","content":"ignored"}]}}'
ASSISTANT='{"type":"assistant","message":{"content":[{"type":"text","text":"five"}]}}'

test_user_texts_reads_a_string_content() {
  local T got
  T=$(mktemp -d)
  write_transcript "$T/t.jsonl" "$STRING_USER"
  got=$(transcript_user_texts "$T/t.jsonl")
  rm -rf "$T"
  report test_user_texts_reads_a_string_content "$got" '"five"'
}

test_user_texts_joins_the_text_blocks_of_an_array_content() {
  local T got
  T=$(mktemp -d)
  write_transcript "$T/t.jsonl" "$BLOCKS_USER"
  got=$(transcript_user_texts "$T/t.jsonl")
  rm -rf "$T"
  report test_user_texts_joins_the_text_blocks_of_an_array_content "$got" '"six"'
}

test_user_texts_skips_assistant_entries() {
  local T got
  T=$(mktemp -d)
  write_transcript "$T/t.jsonl" "$ASSISTANT" "$STRING_USER"
  got=$(transcript_user_texts "$T/t.jsonl")
  rm -rf "$T"
  report test_user_texts_skips_assistant_entries "$got" '"five"'
}

test_user_texts_fails_when_the_transcript_is_missing() {
  local got status=0
  got=$(transcript_user_texts /nonexistent/t.jsonl 2>/dev/null) || status=$?
  report test_user_texts_fails_when_the_transcript_is_missing "$status:$got" "1:"
}

test_has_user_text_matches_the_whole_text_only() {
  local T status=0
  T=$(mktemp -d)
  write_transcript "$T/t.jsonl" '{"type":"user","message":{"content":"fivesix"}}'
  transcript_has_user_text "$T/t.jsonl" five || status=$?
  rm -rf "$T"
  report test_has_user_text_matches_the_whole_text_only "$status" 1
}

test_has_user_text_finds_a_text_among_several_entries() {
  local T status=0
  T=$(mktemp -d)
  write_transcript "$T/t.jsonl" "$TOOL_RESULT_USER" "$STRING_USER" "$BLOCKS_USER"
  transcript_has_user_text "$T/t.jsonl" six || status=$?
  rm -rf "$T"
  report test_has_user_text_finds_a_text_among_several_entries "$status" 0
}

test_has_user_text_fails_when_the_transcript_is_missing() {
  local status=0
  transcript_has_user_text /nonexistent/t.jsonl five 2>/dev/null || status=$?
  report test_has_user_text_fails_when_the_transcript_is_missing "$status" 1
}

test_has_user_text_starting_matches_a_prefix() {
  local T status=0
  T=$(mktemp -d)
  write_transcript "$T/t.jsonl" '{"type":"user","message":{"content":"SCHEDTOKEN: run these"}}'
  transcript_has_user_text_starting "$T/t.jsonl" 'SCHEDTOKEN:' || status=$?
  rm -rf "$T"
  report test_has_user_text_starting_matches_a_prefix "$status" 0
}

test_has_user_text_starting_does_not_match_a_prefix_inside_the_text() {
  local T status=0
  T=$(mktemp -d)
  write_transcript "$T/t.jsonl" '{"type":"user","message":{"content":"I said SCHEDTOKEN: no"}}'
  transcript_has_user_text_starting "$T/t.jsonl" 'SCHEDTOKEN:' || status=$?
  rm -rf "$T"
  report test_has_user_text_starting_does_not_match_a_prefix_inside_the_text "$status" 1
}

run_tests "$@"
