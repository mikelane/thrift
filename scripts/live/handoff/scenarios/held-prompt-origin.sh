#!/usr/bin/env bash
# #55: what the fresh session's model sees for a held prompt. It must arrive as the person's
# prompt, not as a message the handoff plugin sent (framed "The handoff plugin sent a message:").
#
# The turn's `cc_turn_origin` can't show this: a plugin's `$.prompt.submit({ asUser: true })` keeps
# the plugin origin (see the engine declarations). What `asUser` changes is the transcript entry, so
# the check reads the fresh session's transcript: a user entry with `origin.asUser == true` whose
# text is the held words joined by blank lines.

HELD_TEXT=$'one\n\ntwo\n\nthree'

scenario_run() {
  handoff_prepare '{}'
  handoff_start a
  held_prompts_flow a

  local old_id transcript
  old_id=$(records_with cleared | jq -r '.session_id' | tail -n 1)
  transcript=$(fresh_transcript_path "$old_id")
  show_records cleared
  section "fresh session transcript (found by the old session id ${old_id:-<none>})"
  show_user_entries "$transcript"
  show_pane a 'fresh session'

  check 'the held prompts reach the transcript as the person'"'"'s (origin.asUser) in one entry' \
    "no user entry with origin.asUser and the text 'one two three' in [${transcript:-no transcript found}]" \
    held_prompts_as_user "$transcript"
  check 'the held prompts are not framed as a plugin message' 'the screen shows "The handoff plugin sent a message"' \
    not_framed_as_plugin_message a
}

# user_entries <transcript>: each user entry as {origin, text}, text being the content as one string.
user_entries() {
  jq -c 'select(.type == "user") | {
    origin: (.origin // null),
    text: ((.message.content // "") | if type == "string" then . else map(select(.type == "text") | .text) | join("") end)
  }' "$1"
}

show_user_entries() {
  if [[ -z "$1" || ! -f "$1" ]]; then
    echo "no transcript found containing the handoff note's opening line"
    return 0
  fi
  printf '%s\n' "$1"
  user_entries "$1" 2>/dev/null | cut -c 1-200 || true
}

held_prompts_as_user() {
  [[ -n "$1" && -f "$1" ]] || return 1
  user_entries "$1" | jq -e --arg held "$HELD_TEXT" 'select(.origin.asUser == true and .text == $held)' >/dev/null
}

not_framed_as_plugin_message() { ! pane_has "$1" 'The handoff plugin sent a message'; }
