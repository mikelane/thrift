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
  handoff_start a --allowedTools "Bash(sleep *)"
  handoff_start_peer b
  say_apple a
  wait_for 'the band to offer a handoff' pane_has a 'h: Hand off and clear'
  submit b 'Use ToolSearch to load the SendMessage tool, then reply with the word ready.'
  wait_for 'the peer to load SendMessage' turns_done_above b 0

  type_text b "Use the SendMessage tool to send exactly this text to the session named $(session_of a): $PEER_TASK Do nothing else."
  press a C-x Tab
  press a h
  wait_for 'the band to press hand off' log_has a 'ui\.press handoff/handoff'
  press b Enter
  wait_for 'the peer turn to start in a' log_has a 'cc_turn_origin=peer'
  wait_for 'the handoff to wait for the running turn' pane_has a 'continues when the current turn ends'
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
  check 'the held prompt went back (held_restore in_box)' "held_restore was: $(records_with none | jq -r '.trigger_values.held_restore // "missing"' | tail -n 1)" \
    held_prompt_in_box
  check 'the held prompt is in the prompt box' "the box holds [$(box_text a | tr '\n' ' ')]" \
    box_shows a "$HELD_PROMPT"
  check 'the old session transcript holds the compaction (claude --resume reopens it compacted)' \
    "no compaction marker in the transcript of $old_id" transcript_is_compacted "$old_id"
}

record_has_reason() { records_with none | jq -e --arg reason "$1" 'select(.trigger_values.reason == $reason or .reason == $reason)' >/dev/null; }
handoff_ended() { record_has_reason background_busy || record_exists cleared; }
no_cleared_record() { [[ "$(record_count cleared)" == 0 ]]; }
held_prompt_in_box() { records_with none | jq -e 'select(.trigger_values.held_restore == "in_box")' >/dev/null; }

# Claude Code writes transcripts under its config directory, one file per session id.
transcript_path() { find "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects" -name "$1.jsonl" 2>/dev/null | head -n 1 || true; }
transcript_is_compacted() {
  local path
  path=$(transcript_path "$1")
  [[ -n "$path" ]] && grep -qE '"compact_boundary"|"isCompactSummary"' "$path"
}
transcript_summary() {
  local path
  path=$(transcript_path "$1")
  if [[ -z "$path" ]]; then
    echo "no transcript file '${1:-<no session id>}.jsonl' under ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"
    return
  fi
  printf '%s\n' "$path"
  grep -oE '"compact_boundary"|"isCompactSummary":true' "$path" | sort | uniq -c || true
}
