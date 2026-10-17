#!/usr/bin/env bash
# #67 (scenario 6 of #58, the `/clear` and `/resume` items of #43): a person's own `/clear` or
# `/resume` typed while a handoff is in flight, in the two places it can be: during the pre-clear
# compaction (compactBeforeClear) and during the wait for a running turn. Four handoffs, one per
# combination, each in a session of its own, so the records of one cannot be taken for another's.
#
# What the run judges is the outcome the plugin must get right whatever the engine does with the command
# (runs it at once, or queues it behind the handoff's own work):
# - exactly one record ends the handoff: a `cleared` record, or a `none` record with reason session_ended;
# - that record names the session the handoff started in, and carries `effective_mode` ask;
# - no record reports a failure (clear_failed, handoff_failed, no_handoff_written);
# - the session ended once for each clear or resume that ran, and after a clear the handoff note reached
#   exactly one transcript, which is not the resumed session's (an abandon as session_ended carries no note,
#   so no transcript holds it).
# - in the cases typed during the compaction, the command was typed before the compaction finished: the
#   engine logs nothing when a typed command arrives, so the run reads the log right after typing, and a
#   compaction that had already ended then is a FAIL (the case would only cover "after the compaction").
# The `/clear` cases also pin who cleared. A `/clear` during the compaction is queued behind the
# handoff's own clear (#43), so `cleared_by` is `handoff`; during the wait it is the person's own clear,
# so it is `person`. The `/resume` cases print which of the two paths the run took and judge only the
# invariants above, because #43 never recorded what the engine does with `/resume`.
#
# A `compaction_failed` record is not a failure here: during the wait, the command typed in the turn is
# queued and runs the moment the turn ends, so the handoff's compaction meets "a turn is in flight" (seen
# on 2.1.302). The handoff then goes on to its clear. The record is printed, not judged.
#
# The `/resume` target is a session of its own that has had one turn and has exited.

SLEEP_TASK='Run `sleep 14` in the foreground, then reply with the word done.'
ENDING_RECORD='.action == "cleared" or (.action == "none" and .trigger_values.reason == "session_ended")'
FAILURE_RECORD='.action == "none" and (.trigger_values.reason as $reason | ["clear_failed", "handoff_failed", "no_handoff_written"] | index($reason) != null)'
CASE_BASE=0
CASE_ID=''
CASE_LABEL=''
CASE_PHASE=''
COMPACTION_ENDED_AT_TYPING=0
# The engine's own lines for the compaction the handoff starts (seen on 2.1.302): `$.session.compact` logs
# "compacting" when it starts, and the forked compaction agent logs "finished" when it ends.
COMPACTION_STARTED='\$\.session\.compact \(handoff\): compacting'
COMPACTION_ENDED='Forked agent \[reactive-compact\] finished'
NOTE_WRITTEN='Forked agent \[plugin_model_fork\] finished'

scenario_run() {
  handoff_prepare '{"compactBeforeClear": true, "handoffContextTokens": 20000}'
  start_peer_messenger b
  start_resume_target r
  run_case 'clear during the compaction' c1 compaction '/clear' cleared_by_handoff 2
  run_case 'resume during the compaction' c2 compaction "/resume $RESUME_TARGET_ID" show_ending_path 2
  run_case 'clear during the wait' c3 wait '/clear' cleared_by_person 1
  run_case 'resume during the wait' c4 wait "/resume $RESUME_TARGET_ID" show_ending_path 2
}

new_session_id() { uuidgen | tr '[:upper:]' '[:lower:]'; }
session_gone() { ! tmux has-session -t "=$(session_of "$1")" 2>/dev/null; }

# start_resume_target <name>: a session with a known id and one turn, which then exits, so its
# transcript can be resumed.
start_resume_target() {
  RESUME_TARGET_ID=$(new_session_id)
  live_start "$1" --model haiku --session-id "$RESUME_TARGET_ID"
  say_apple "$1"
  submit "$1" '/exit'
  wait_for "the resume target '$1' to exit" session_gone "$1"
}

# run_case <label> <name> <compaction|wait> <typed command> <expectation> <session ends>: one handoff in
# a session named <name>, the command typed once the handoff is in the phase, then the judgement.
# <session ends> is how many times the session ends when the handoff clears: its own clear (when it
# runs) and the command. A handoff that ends as session_ended runs no clear and carries no note, so the
# session ends once, for the command, and no transcript holds the note.
run_case() {
  local label=$1 name=$2 phase=$3 typed=$4 expectation=$5 expected_ends=$6
  CASE_LABEL=$label
  CASE_PHASE=$phase
  CASE_ID=$(new_session_id)
  if [[ "$phase" == compaction ]]; then
    handoff_start "$name" --session-id "$CASE_ID"
    say_apple "$name"
    CASE_BASE=$(decision_lines)
    local notes_before
    notes_before=$(log_count "$name" "$NOTE_WRITTEN")
    submit "$name" '/handoff'
    wait_for "the note of '$name' to be written" log_has_more_than "$name" "$NOTE_WRITTEN" "$notes_before"
    wait_for "the compaction of '$name' to start" log_has "$name" "$COMPACTION_STARTED"
  else
    CASE_BASE=$(decision_lines)
    start_waiting_handoff "$name" b "$SLEEP_TASK" --session-id "$CASE_ID"
  fi
  submit "$name" "$typed"
  COMPACTION_ENDED_AT_TYPING=$(log_count "$name" "$COMPACTION_ENDED")
  wait_for "the handoff of '$name' to end ($label)" handoff_has_ended
  # Not a wait_for: a command the engine drops would otherwise end the run in an ERROR, not a FAIL.
  settle_until session_ends_reach "$name" "$(ends_expected "$expected_ends")"
  show_case "$name"
  judge_case "$name" "$expectation" "$expected_ends"
}

# settle_until <command...>: polls the command for at most SETTLE_SECONDS and returns either way.
SETTLE_SECONDS=20
settle_until() {
  local deadline=$((SECONDS + SETTLE_SECONDS))
  until "$@"; do
    ((SECONDS < deadline)) || return 0
    sleep "$LIVE_POLL"
  done
}
# ends_expected <session ends when the handoff clears>: one when the handoff ended as session_ended.
ends_expected() {
  if [[ "$(ending_field .trigger_values.reason)" == session_ended ]]; then echo 1; else echo "$1"; fi
}
session_ends() { log_count "$1" 'handoff@inline session\.end settled'; }
session_ends_reach() { (($(session_ends "$1") >= $2)); }

ending_records() { records_after "$CASE_BASE" "$ENDING_RECORD"; }
handoff_has_ended() { [[ -n "$(ending_records)" ]]; }
ending_record_count() { ending_records | grep -c . || true; }

# The records of the case, one line each, and what the debug log says of the command and the clears.
show_case() {
  section "$CASE_LABEL: records after the start of the handoff (session $CASE_ID)"
  records_after "$CASE_BASE" true | jq -c '{ts, session_id, action, reason: .trigger_values.reason, cleared_by: .trigger_values.cleared_by, compacted: .trigger_values.compacted_before_clear, held_restore: .trigger_values.held_restore, effective_mode: .trigger_values.effective_mode}' || true
  show_log "$1" 'command\.run|reactive-compact|session\.end|resumed after the wait|waiting for a running turn' 16
  show_pane "$1" "$CASE_LABEL"
}

judge_case() {
  local name=$1 expectation=$2 expected_ends
  expected_ends=$(ends_expected "$3")
  check "$CASE_LABEL: exactly one record ends the handoff" "$(ending_record_count) ending records: $(ending_records | tr '\n' ' ')" \
    exactly_one_ending_record
  check "$CASE_LABEL: it names the session the handoff started in" "the ending record names $(ending_field .session_id), not $CASE_ID" \
    ending_field_is .session_id "$CASE_ID"
  check "$CASE_LABEL: it carries effective_mode ask" "effective_mode was $(ending_field .trigger_values.effective_mode)" \
    ending_field_is .trigger_values.effective_mode ask
  check "$CASE_LABEL: no record reports a failure" "failure records: $(records_after "$CASE_BASE" "$FAILURE_RECORD" | tr '\n' ' ')" \
    no_failure_record
  check "$CASE_LABEL: the session ended $expected_ends time(s), once per clear or resume that ran" "it ended $(session_ends "$name") time(s)" \
    session_ends_are "$name" "$expected_ends"
  check "$CASE_LABEL: the handoff note reached exactly one transcript after a clear, none after session_ended" \
    "$(note_evidence)" note_reached_the_right_transcripts
  if [[ "$CASE_PHASE" == compaction ]]; then
    check "$CASE_LABEL: the command was typed before the compaction finished" \
      "the compaction had finished $COMPACTION_ENDED_AT_TYPING time(s) when the command was typed" typed_during_compaction
  fi
  "$expectation"
}

typed_during_compaction() { [[ "$COMPACTION_ENDED_AT_TYPING" == 0 ]]; }

session_ends_are() { [[ "$(session_ends "$1")" == "$2" ]]; }
# The transcripts of the project, other than the old session's own, holding this case's handoff note,
# found by its opening line. Fails when the old session's transcript is not found.
note_transcripts() {
  local old directory
  old=$(transcript_path "$CASE_ID")
  [[ -n "$old" ]] || return 1
  directory=$(dirname -- "$old")
  grep -lF -- "Handoff from the previous session ($CASE_ID)" "$directory"/*.jsonl 2>/dev/null | grep -vxF -- "$old" || true
}
note_evidence() {
  local transcripts
  transcripts=$(note_transcripts) || { echo "the transcript of the old session $CASE_ID was not found under $(transcripts_dir | sed "s|$HOME|~|")"; return 0; }
  if [[ -z "$transcripts" ]]; then echo 'transcripts holding the note: none'; else echo "transcripts holding the note: $(sed 's|.*/||' <<<"$transcripts" | tr '\n' ' ')"; fi
}
note_reached_the_right_transcripts() {
  local transcripts
  transcripts=$(note_transcripts) || return 1
  if [[ "$(ending_field .trigger_values.reason)" == session_ended ]]; then [[ -z "$transcripts" ]]; return; fi
  [[ "$(grep -c . <<<"$transcripts")" == 1 && "$transcripts" != *"$RESUME_TARGET_ID"* ]]
}

exactly_one_ending_record() { [[ "$(ending_record_count)" == 1 ]]; }
ending_field() { ending_records | jq -r "$1 // \"missing\"" | tail -n 1; }
ending_field_is() { [[ "$(ending_field "$1")" == "$2" ]]; }
no_failure_record() { [[ -z "$(records_after "$CASE_BASE" "$FAILURE_RECORD")" ]]; }

cleared_by_handoff() {
  check "$CASE_LABEL: the handoff's own clear ran (cleared_by handoff, compacted_before_clear)" \
    "the ending record: $(ending_records | tr '\n' ' ')" \
    ending_is_compacted_clear_by_handoff
}
cleared_by_person() {
  check "$CASE_LABEL: the person's clear ended it (cleared_by person)" "the ending record: $(ending_records | tr '\n' ' ')" \
    ending_is_cleared_by person
}
ending_is_cleared_by() {
  [[ "$(ending_field .action)" == cleared && "$(ending_field .trigger_values.cleared_by)" == "$1" ]]
}
ending_is_compacted_clear_by_handoff() {
  ending_is_cleared_by handoff && [[ "$(ending_field .trigger_values.compacted_before_clear)" == true ]]
}
# Which path the engine took is printed, not judged: ENDING_RECORD already admits only the two correct ends.
show_ending_path() {
  printf '        %s: ended with action %s, reason %s, cleared_by %s\n' "$CASE_LABEL" "$(ending_field .action)" \
    "$(ending_field .trigger_values.reason)" "$(ending_field .trigger_values.cleared_by)"
}
