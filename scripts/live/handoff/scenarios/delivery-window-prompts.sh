#!/usr/bin/env bash
# #63: two prompts submitted while the held prompts are being delivered (the plugin's `sending` stage).
# #56 empties the box as each prompt is held while the handoff still collects them; a late arrival in
# the `sending` stage has no such clear, so the second Enter holds "fivesix" instead of "six".
#
# The window is narrow: it opens when the plugin queues its /clear (the debug line
# "$.command.run (handoff): 6 chars queued") and the late prompts must both be held before the delivery
# ends. The scenario polls the debug log every 5 ms for that line and presses the first Enter at once;
# the harness's usual 0.25 s poll would miss the window.
#
# The join is a race, so a PASS does not prove the bug is gone. On 2.1.302 the second prompt was held
# as "fivesix" in 4 of 15 runs. The debug logs of all 4 were kept. In each, the second prompt's hold
# (the "2 held" line) was logged 0 to 5 ms before the plugin's submit of "five", and 32 to 47 ms after
# the hold of "five". The logs do not record the keystroke pause itself, only the gap between the holds.
# It exits ERROR, not FAIL, when the second prompt misses the window.
#
# What the fresh session received is read from its transcript. 2.1.332 stopped logging the text of a
# plugin submit (the line is now `$.prompt.submit (handoff): 3 chars`), so the log only counts submits.

CLEAR_QUEUED='command\.run \(handoff\): 6 chars queued'
# The pause between the first late Enter and the second prompt. Not measured: the value is a choice.
SECOND_PROMPT_PAUSE=0.04
TIGHT_POLL=0.005
# A plugin submit in the debug log: the text in quotes (before 2.1.332) or only its length.
PLUGIN_SUBMIT_LOG_PATTERN='prompt\.submit \(handoff\): ("|[0-9]+ chars)'

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
  LIVE_POLL=$TIGHT_POLL wait_for "the handoff to queue its /clear" log_has a "$CLEAR_QUEUED"
  press_two_prompts a six
  wait_for "the handoff to clear" record_exists cleared
  wait_for "the fresh session to answer" turns_done_above a 0
  both_held_in_sending_stage || live_abort "the two prompts did not both arrive in the sending stage (no '2 held' line); the timing window was missed"
  settle_after_delivery

  show_records cleared
  show_log a 'held a prompt|prompt\.submit \(handoff\)|prompt\.fill' 20
  show_box a 'after delivery'

  local old_id transcript
  old_id=$(records_with cleared | jq -r '.session_id' | tail -n 1)
  transcript=$(fresh_transcript_path "$old_id")
  show_transcript_lookup "$old_id" "$transcript"

  check 'the second prompt was held as typed, not joined to the first' \
    "the fresh session got \"fivesix\", or no transcript was found: ${transcript:-no fresh session transcript found for the old session ${old_id:-<none>}}" \
    not_joined "$transcript"
  check 'both prompts reached the fresh session as typed' \
    "the transcript has no user message of exactly \"five\" and one of exactly \"six\": ${transcript:-no fresh session transcript found for the old session ${old_id:-<none>}}" \
    both_delivered "$transcript"
  check 'the prompt box is empty after delivery' "the box holds [$(box_text a | tr '\n' ' ')]" box_is_empty a
}

# press_two_prompts <name> <second>: Enter on the prompt already in the box, a pause, then the second
# prompt and its Enter in one tmux command, so it lands inside the window.
press_two_prompts() {
  local target
  target=$(pane_target_of "$1")
  tmux send-keys -t "$target" Enter
  sleep "$SECOND_PROMPT_PAUSE"
  tmux send-keys -t "$target" -l -- "$2" \; send-keys -t "$target" Enter
}

# The held prompt and the two late arrivals are each submitted by the plugin, whatever text they carry:
# a wait on the expected texts would time out, an ERROR, on the joined "fivesix" this scenario reports.
settle_after_delivery() {
  wait_for "the held prompt and both late prompts to be submitted" log_has_more_than a "$PLUGIN_SUBMIT_LOG_PATTERN" 2
}

show_transcript_lookup() {
  section "fresh session transcript (found by the old session id ${1:-<none>})"
  if [[ -n "$2" ]]; then
    printf '%s\n' "$2"
    transcript_user_texts "$2" || true
  else
    echo "no fresh session transcript found for the old session ${1:-<none>}"
  fi
}

both_held_in_sending_stage() { log_has a 'held a prompt for the handoff \(2 held\)'; }
# Both read the transcript, so a missing one fails them instead of passing for want of a "fivesix".
not_joined() { [[ -f "$1" ]] && transcript_user_texts "$1" >/dev/null && ! transcript_has_user_text_equal_to "$1" fivesix; }
both_delivered() { transcript_has_user_text_equal_to "$1" five && transcript_has_user_text_equal_to "$1" six; }
