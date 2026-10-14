#!/usr/bin/env bash
# #55: what the fresh session's model sees for a held prompt. It must arrive as the person's
# prompt (turn origin human), not as a message the handoff plugin sent (turn origin system, framed
# "The handoff plugin sent a message:").

scenario_run() {
  handoff_prepare '{}'
  handoff_start a
  held_prompts_flow a

  local origins
  origins=$(turn_origins a | tr '\n' ' ')
  show_records cleared
  section 'turn origins in order (the first is the turn before the handoff)'
  echo "$origins"
  show_pane a 'fresh session'

  check 'the turn that answers the held prompts has origin human' "turn origins were: $origins" \
    last_turn_is_human a
  check 'the held prompts are not framed as a plugin message' 'the screen shows "The handoff plugin sent a message"' \
    not_framed_as_plugin_message a
}

last_turn_is_human() { [[ "$(turn_origins "$1" | tail -n 1)" == human ]]; }
not_framed_as_plugin_message() { ! pane_has "$1" 'The handoff plugin sent a message'; }
