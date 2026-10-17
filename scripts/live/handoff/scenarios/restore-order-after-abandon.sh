#!/usr/bin/env bash
# #67 (scenario 5 of #58, the "From #6 PR 1" items of #43): the order a handoff that stops puts things
# back in. Three prompts typed during the wait are held, and a fourth text is typed but not sent, so it
# is a draft in the prompt box. The handoff then stops with background_busy and restores the held
# prompts: they must come back in the order they were typed, before the draft, and the draft must not
# be sent. The held prompts of one person form one group, so the restored box reads "one", "two",
# "three", each separated by a blank line, and then the draft on its own line.
#
# Not driven: a prompt typed while the restore runs, and an image prompt during it. The restore takes
# about 17 ms (on 2.1.302 the turn-end line is logged at 20:36:55.456, the first prompt.fill at .469, the
# record at .473), too short for a tmux keystroke: a key pressed the moment the turn-end line shows
# arrived 290 ms late, after the restore, and sent the whole box to the old session. A tmux session also
# has no way to attach an image. The placement of such a prompt (after the restored ones) is covered
# by the test kit only.

PEER_TASK='Run `sleep 14` in the foreground first. Then start `sleep 90` as a background task with run_in_background. Then reply with the word done.'
# The restored box, newlines shown as "|": the group joined by blank lines, then the draft on its own line.
RESTORED='one||two||three|draft'

scenario_run() {
  handoff_prepare '{"compactBeforeClear": false, "handoffContextTokens": 20000}'
  start_peer_messenger b
  start_waiting_handoff a b "$PEER_TASK"
  local word held_count=0
  for word in one two three; do
    held_count=$((held_count + 1))
    submit a "$word"
    wait_for "prompt '$word' to be held" log_has a "held a prompt for the handoff \\($held_count held\\)"
    # The engine clears the box after the hook holds the prompt. Text typed before that is wiped.
    wait_for "the box to clear after prompt '$word'" box_is_empty a
  done
  type_text a draft
  wait_for 'the handoff to stop or clear' handoff_ended
  wait_for 'the restored prompts to be back in the box' box_shows a one

  local restored
  restored=$(box_in_one_line a)
  show_records none
  show_records cleared
  show_log a 'held a prompt|prompt\.fill|prompt\.read|resumed after the wait|cc_turn_origin' 24
  show_pane a 'after the abandon'
  show_box a 'after the abandon'

  check 'the handoff stopped with reason background_busy and cleared nothing' \
    "none with background_busy: $(record_count none) none records; cleared records: $(record_count cleared)" \
    stopped_busy_without_clear
  check 'the held prompts went back to the box (held_restore in_box)' "held_restore was: $(held_restore_of_abandon)" held_prompt_in_box
  check 'the restored prompts are in typing order, before the draft, which is still unsent' \
    "the box reads [$restored] (expected [$RESTORED], newlines shown as |)" \
    same_text "$restored" "$RESTORED"
  check 'the draft was not sent: no person turn started in the old session after the wait' \
    "$(person_turns_detail a)" no_person_turn_after_wait a
}

same_text() { [[ "$1" == "$2" ]]; }
# Counted from the debug log lines after the wait ended; a request is logged once per model call, so a turn can show twice.
# A log without the wait's end has no "after the wait", so it can show no turn there and must not pass.
WAIT_ENDED_LINE='resumed after the wait'
person_turns_after_wait() { sed -n "/$WAIT_ENDED_LINE/,\$p" "$(debug_log_of "$1")" | grep -c 'cc_turn_origin=human' || true; }
no_person_turn_after_wait() { log_has "$1" "$WAIT_ENDED_LINE" && [[ "$(person_turns_after_wait "$1")" == 0 ]]; }
person_turns_detail() {
  log_has "$1" "$WAIT_ENDED_LINE" || { echo "the debug log never shows the wait ending ('$WAIT_ENDED_LINE')"; return 0; }
  echo "$(person_turns_after_wait "$1") person turn(s) started after the wait ended"
}
# The prompt box on one line, each newline shown as "|", the padding and the indent of wrapped lines removed.
box_in_one_line() { box_text "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' | paste -sd'|' -; }
stopped_busy_without_clear() { record_has_reason background_busy && [[ "$(record_count cleared)" == 0 ]]; }
