#!/usr/bin/env bash
# #63: two prompts submitted while the held prompts are being delivered (the plugin's `sending` stage).
# #56 empties the box as each prompt is held while the handoff still collects them; a late arrival in
# the `sending` stage had no such clear, so the second Enter could hold "fivesix" instead of "six".
#
# The window is narrow: it opens when the plugin queues its /clear (the debug line
# "$.command.run (handoff): 6 chars queued") and closes about 80 ms later, when the last late arrival has
# been taken. The scenario polls the debug log every 5 ms for that line and presses the Enters at once;
# the harness's usual 0.25 s poll would miss the window. On 2.1.302 the two prompts were held 20 to
# 35 ms apart in 9 of 9 runs, and never joined: no person submits twice that fast (issue #63).
# It exits ERROR, not FAIL, when the window is missed.

CLEAR_QUEUED='command\.run \(handoff\): 6 chars queued'

scenario_run() {
  handoff_prepare '{}'
  handoff_start a
  say_apple a
  submit a '/handoff'
  wait_for "the note status line" pane_has a 'Writing a handoff note'
  # One held prompt, so the delivery has a submit to wait on and the window is as wide as it gets. The
  # first late prompt is typed ahead of the window, so the window needs only an Enter, then the second.
  submit a one
  wait_for "prompt 'one' to be held" log_has a 'held a prompt for the handoff \(1 held\)'
  type_text a five
  wait_tightly "the handoff to queue its /clear" log_has a "$CLEAR_QUEUED"
  press_two_prompts a six
  wait_for "the handoff to clear" record_exists cleared
  wait_for "the fresh session to answer" turns_done_above a 0
  both_held_in_sending_stage || live_abort "the two prompts did not both arrive in the sending stage (no '2 held' line); the timing window was missed"
  settle_after_delivery

  show_records cleared
  show_log a 'held a prompt|prompt\.submit \(handoff\)|prompt\.fill' 20
  show_box a 'after delivery'

  check 'the second prompt was held as typed, not joined to the first' \
    'a plugin submit or a held record carries "fivesix"' not_joined
  check 'both prompts reached the fresh session as typed' 'no plugin submit of "five" and of "six"' both_delivered
  check 'the prompt box is empty after delivery' "the box holds [$(box_text a | tr '\n' ' ')]" box_is_empty a
}

# wait_tightly <description> <command...>: wait_for with a 5 ms poll, for a window that is milliseconds wide.
wait_tightly() {
  local description=$1
  shift
  local deadline=$((SECONDS + LIVE_TIMEOUT))
  until "$@"; do
    ((SECONDS < deadline)) || live_abort "timed out after ${LIVE_TIMEOUT}s waiting for $description"
    sleep 0.005
  done
}

# press_two_prompts <name> <second>: Enter on the prompt already in the box, then the second prompt and its
# Enter. The two prompts land 20 to 35 ms apart; a third tmux command in between already misses the window.
press_two_prompts() {
  local target
  target=$(pane_target_of "$1")
  tmux send-keys -t "$target" Enter
  tmux send-keys -t "$target" -l -- "$2" \; send-keys -t "$target" Enter
}

# The late arrivals are submitted after the note and the held group, each in its own turn.
settle_after_delivery() {
  wait_for "both late prompts to be submitted" log_has_more_than a 'prompt\.submit \(handoff\): "(five|six)"' 1
}

both_held_in_sending_stage() { log_has a 'held a prompt for the handoff \(2 held\)'; }
not_joined() { ! log_has a 'prompt\.submit \(handoff\): "fivesix"'; }
both_delivered() { log_has a 'prompt\.submit \(handoff\): "five"' && log_has a 'prompt\.submit \(handoff\): "six"'; }
box_is_empty() {
  local text
  text=$(box_text "$1") || return 1
  [[ -z "$(tr -d '[:space:]' <<<"$text")" ]]
}
