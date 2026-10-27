#!/usr/bin/env bash
# #121 item 8: where the engine places the pane. There is no expected outcome; the scenario records, for
# every cell, whether the pane was placed and whether it docked beside the transcript or drew inline above
# the prompt, judged from the screen. The plugin does not log the result of $.ui.open.
#
# Cells: asked (/meter) x {fullscreen, main screen} x {109, 110} columns; unasked (meterAutoOpen) x the
# same two layouts x {109, 110, 143, 144} columns; then, after a /meter open-then-close in the same config,
# unasked at 109, 110 and 143 columns, to see whether the plugin's own close lowers the unasked floor.
#
# The engine lowers the unasked floor from 144 to 110 for a pane the person opened by asking and did not
# close by hand since (kept in .claude.json). The unasked cells therefore start from a config without that
# entry: before each, a session opens the pane and closes it by hand (ctrl+x tab, ctrl+x x), which removes it.

PLACEMENT_MATRIX=''
LAYOUTS=("$METER_FULLSCREEN fullscreen" "$METER_MAIN_SCREEN main-screen")

meter_placed_shape() {
  if meter_inline_frame_is_drawn "$1"; then
    echo inline
  elif meter_docked_frame_is_drawn "$1"; then
    echo dock
  else
    echo none
  fi
}

prime_with_plugin_close() {
  # shellcheck disable=SC2034 # read by live_start
  LIVE_COLUMNS=120
  # shellcheck disable=SC2034 # read by live_start
  LIVE_SESSION_ENV=$METER_FULLSCREEN
  meter_prepare '{}'
  local prime="prime$SECONDS"
  meter_start "$prime"
  meter_command "$prime" '/meter' 'Meter opened\.'
  wait_for 'the pane to open' meter_pane_is_open "$prime"
  meter_command "$prime" '/meter' 'Meter closed\.'
  wait_for 'the pane to close' meter_pane_is_closed "$prime"
  echo "OBSERVED: asked list after open-then-close by /meter: $(meter_asked_panes)"
  end_session "$prime"
}

# record_cell <name> <how> <layout-label> <columns> <asked-before>: classifies the screen and keeps the row.
record_cell() {
  local name=$1 how=$2 layout=$3 columns=$4 asked_before=$5 placed=no shape probe_reply asked_after
  meter_pane_is_open "$name" && placed=yes
  shape=$(meter_placed_shape "$name")
  show_pane "$name" "$how, $layout, $columns columns" 24
  asked_after=$(meter_asked_panes)
  # A second /meter is recorded as the raw reply. It closes a placed pane; since #135 it opens a listed pane
  # that was never placed, so the reply does not say whether the pane is listed (asked_after does).
  local replies_before last_reply
  replies_before=$(pane_count "$name" 'Meter (opened|closed)\.')
  submit "$name" '/meter'
  wait_for 'the reply to the probe /meter' pane_count_above "$name" 'Meter (opened|closed)\.' "$replies_before"
  last_reply=$(pane "$name" | grep -oE 'Meter (opened|closed)\.' | tail -n 1)
  probe_reply=${last_reply#Meter }
  probe_reply=${probe_reply%.}
  local row="$how | $layout | $columns | placed=$placed | shape=$shape | probe_reply=$probe_reply | asked_before=$asked_before | asked_after=$asked_after"
  PLACEMENT_MATRIX+="$row"$'\n'
  echo "CELL $row"
  check "$how, $layout, $columns columns: the screen shows a pane in one shape, or none" "placed=$placed shape=$shape" \
    placement_is_coherent_snapshot "$placed" "$shape"
}
placement_is_coherent_snapshot() { if [[ "$1" == yes ]]; then [[ "$2" != none ]]; else [[ "$2" == none ]]; fi; }

# unasked_cell <layout-env> <layout-label> <columns> <label-suffix>
unasked_cell() {
  local layout_env=$1 layout=$2 columns=$3 suffix=$4 asked_before name
  name="u-$layout-$columns$suffix"
  asked_before=$(meter_was_asked && echo yes || echo no)
  # shellcheck disable=SC2034 # read by live_start
  LIVE_COLUMNS=$columns
  # shellcheck disable=SC2034 # read by live_start
  LIVE_SESSION_ENV=$layout_env
  meter_prepare '{"meterAutoOpen": true}'
  meter_start "$name"
  wait_for 'the screen to settle after the unasked open' meter_screen_is_still "$name" 16
  record_cell "$name" unasked "$layout" "$columns" "$asked_before"
  end_session "$name"
}

asked_cell() {
  local layout_env=$1 layout=$2 columns=$3 asked_before name
  name="a-$layout-$columns"
  asked_before=$(meter_was_asked && echo yes || echo no)
  # shellcheck disable=SC2034 # read by live_start
  LIVE_COLUMNS=$columns
  # shellcheck disable=SC2034 # read by live_start
  LIVE_SESSION_ENV=$layout_env
  meter_prepare '{}'
  meter_start "$name"
  submit "$name" '/meter'
  wait_for 'the reply to /meter' pane_has "$name" 'Meter opened\.'
  wait_for 'the screen to settle after the asked open' meter_screen_is_still "$name" 16
  record_cell "$name" asked "$layout" "$columns" "$asked_before"
  end_session "$name"
}

scenario_run() {
  local layout columns
  for layout in "${LAYOUTS[@]}"; do
    for columns in 109 110 143 144; do
      ensure_not_asked
      unasked_cell "${layout% *}" "${layout#* }" "$columns" ''
    done
  done
  for layout in "${LAYOUTS[@]}"; do
    for columns in 109 110; do
      asked_cell "${layout% *}" "${layout#* }" "$columns"
    done
  done

  # The plugin's own close: open by asking, then /meter again. Is the id still asked, and does an unasked
  # open then place at 110? Each cell is primed again, because a cell can change the asked list.
  for columns in 109 110 143; do
    ensure_not_asked
    prime_with_plugin_close
    unasked_cell "$METER_FULLSCREEN" fullscreen "$columns" -after-plugin-close
  done

  section 'placement matrix (how | layout | columns | placed | shape | probe_reply | asked_before | asked_after)'
  printf '%s' "$PLACEMENT_MATRIX"
}
