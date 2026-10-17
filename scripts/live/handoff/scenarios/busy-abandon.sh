#!/usr/bin/env bash
# Busy abandon: the band's hand-off button is pressed while the session is idle, a peer message
# starts a turn while the note is being written, and that turn starts background work. The handoff
# waits for the turn, finds the work at the last check, and must stop without clearing: a `none`
# record with reason background_busy, the prompt typed during the wait back in the box
# (held_restore in_box), and the old session, compacted before the clear, still resumable.
#
# (Pressing the button while a turn is already running defers the press until the turn ends and
# then refuses it on the spot, which is a different and shorter path.)
#
# The peer is a second claude session (no plugin) that SendMessages the first. The first runs a
# foreground `sleep` so the turn outlasts the note, then starts a background `sleep`.

PEER_TASK='Run `sleep 14` in the foreground first. Then start `sleep 90` as a background task with run_in_background. Then reply with the word done.'
HELD_PROMPT='held while waiting'

scenario_run() {
  handoff_prepare '{"compactBeforeClear": true, "handoffContextTokens": 20000}'
  start_peer_messenger b
  start_waiting_handoff a b "$PEER_TASK"
  submit a "$HELD_PROMPT"
  wait_for 'the prompt to be held' log_has a 'held a prompt for the handoff'
  # Every evaluation logs a `none` record, so only the reason shows that the abandon has happened.
  # A clear ends the wait too, so a plugin that clears instead of stopping is a FAIL, not a timeout.
  wait_for 'the handoff to stop or clear' handoff_ended

  local old_id
  old_id=$(records_with none | jq -r '.session_id' | tail -n 1)
  show_records none
  show_records cleared
  show_log a 'waiting for a running turn|resumed after the wait|held a prompt|cc_turn_origin'
  show_pane a 'after the abandon'
  show_box a 'after the abandon'
  section "old session transcript $old_id"
  transcript_summary "$old_id"

  check 'the handoff stopped with reason background_busy' 'no none record with reason background_busy' \
    record_has_reason background_busy
  check 'the handoff did not clear' 'a cleared record was written' no_cleared_record
  check 'the held prompt went back (held_restore in_box)' "held_restore was: $(held_restore_of_abandon)" \
    held_prompt_in_box
  check 'the held prompt is in the prompt box' "the box holds [$(box_text a | tr '\n' ' ')]" \
    box_shows a "$HELD_PROMPT"
  check 'the old session transcript holds the compaction (claude --resume reopens it compacted)' \
    "no compaction marker in the transcript of $old_id" transcript_is_compacted "$old_id"
}

no_cleared_record() { [[ "$(record_count cleared)" == 0 ]]; }

transcript_is_compacted() {
  local path
  path=$(transcript_path "$1")
  [[ -n "$path" ]] && grep -qE '"compact_boundary"|"isCompactSummary"' "$path"
}
transcript_summary() {
  local path
  path=$(transcript_path "$1")
  if [[ -z "$path" ]]; then
    echo "no transcript file '${1:-<no session id>}.jsonl' under $(transcripts_dir | sed "s|$HOME|~|")"
    return
  fi
  printf '%s\n' "${path##*/}"
  grep -oE '"compact_boundary"|"isCompactSummary":true' "$path" | sort | uniq -c || true
}
