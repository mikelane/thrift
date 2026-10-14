#!/usr/bin/env bash
# #56: several prompts typed during one handoff. After the held prompts are delivered, the prompt
# box must be empty. On main the first prompt's text stays in the box and later ones prefix it.

scenario_run() {
  handoff_prepare '{}'
  handoff_start a
  held_prompts_flow a

  show_records cleared
  show_log a 'held a prompt|cc_turn_origin'
  show_pane a 'after delivery'
  show_box a 'after delivery'

  check 'the handoff cleared with the held prompts delivered' 'no cleared record with held_groups >= 1' \
    held_groups_delivered
  check 'the prompt box is empty after delivery' "the box holds [$(box_text a | tr '\n' ' ')]" \
    box_is_empty a
}

held_groups_delivered() { records_with cleared | jq -e 'select(.trigger_values.held_groups >= 1)' >/dev/null; }
box_is_empty() { [[ -z "$(box_text "$1" | tr -d '[:space:]')" ]]; }
