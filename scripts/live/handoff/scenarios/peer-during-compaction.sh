#!/usr/bin/env bash
# #57: a peer session's message arrives while the handoff compacts the old session
# (compactBeforeClear). Claude Code queues it behind the compaction, so on main it runs in the OLD
# session between the plugin's queued /clear and the clear itself, escaping the wait, the
# background-work check and the note's late-turn line. The peer turn must not start in that gap.
#
# The peer is a second claude session (no plugin) that is told to SendMessage the first. Its
# prompt is typed in advance; the harness presses Enter the moment the note fork has finished,
# which lands the message inside the compaction window (the peer needs a few seconds to send).

scenario_run() {
  handoff_prepare '{"compactBeforeClear": true}'
  handoff_start a
  live_start b --model haiku
  say_apple a
  # Loading the SendMessage tool is a model round trip of its own; doing it now keeps the real
  # send short enough to land inside the compaction.
  submit b 'Use ToolSearch to load the SendMessage tool, then reply with the word ready.'
  wait_for 'the peer to load SendMessage' turns_done_above b 0
  type_text b "Use the SendMessage tool to send exactly the text \"say the word pear\" to the session named $(session_of a). Do nothing else."

  submit a '/handoff'
  wait_for 'the note fork to finish' log_has a 'Forked agent \[plugin_model_fork\] finished'
  press b Enter
  wait_for 'the peer message to reach a' log_has a 'Routed user message to queue'
  wait_for 'the handoff to clear' record_exists cleared
  wait_for 'the peer turn to start in a' log_has a 'cc_turn_origin=peer'

  local note_done_ts compacted_ts arrived_ts queued_ts peer_ts cleared_ts
  note_done_ts=$(log_ts a 'Forked agent \[plugin_model_fork\] finished')
  compacted_ts=$(log_ts a 'Forked agent \[reactive-compact\] finished')
  arrived_ts=$(log_ts a 'Routed user message to queue')
  queued_ts=$(log_ts a '\$\.command\.run \(handoff\).*queued')
  peer_ts=$(log_ts a 'cc_turn_origin=peer')
  cleared_ts=$(records_with cleared | jq -r '.ts' | tail -n 1)

  section 'timeline (UTC)'
  printf '%s  note fork finished\n%s  peer message reached the handoff session\n%s  compaction finished\n%s  the handoff queued /clear\n%s  peer turn started in the handoff session\n%s  cleared record written\n' \
    "$note_done_ts" "$arrived_ts" "$compacted_ts" "$queued_ts" "$peer_ts" "$cleared_ts"
  show_records cleared
  show_pane a 'end of the run'

  local name
  for name in note_done_ts compacted_ts arrived_ts queued_ts peer_ts cleared_ts; do
    [[ -n "${!name}" ]] || live_abort "no timestamp for $name; the debug log or the cleared record lacks the line it comes from"
  done
  if ! ts_before "$note_done_ts" "$arrived_ts" || ! ts_before "$arrived_ts" "$compacted_ts"; then
    live_abort 'the peer message did not arrive inside the compaction window, so the run proves nothing; run it again'
  fi

  check 'the peer turn did not start between the queued /clear and the clear' \
    "the peer turn started at $peer_ts, after /clear was queued at $queued_ts and before the clear at $cleared_ts" \
    peer_turn_outside_gap "$queued_ts" "$peer_ts" "$cleared_ts"
}

peer_turn_outside_gap() {
  local queued=$1 peer=$2 cleared=$3
  ! { ts_before "$queued" "$peer" && ts_before "$peer" "$cleared"; }
}
