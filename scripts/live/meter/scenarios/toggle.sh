#!/usr/bin/env bash
# #121 item 1: /meter opens the pane and a second /meter closes it. Run in the fullscreen layout, where
# the whole pane (down to TOP CONTEXT) is drawn, and again on the main screen, tmux's default, where it
# is drawn inline. 2.1.311 draws no `meter` title in the frame, so the frame is judged by its close
# button.

toggle_in_layout() {
  local name=$1 layout=$2 label=$3
  # shellcheck disable=SC2034 # read by live_start
  LIVE_SESSION_ENV=$layout
  meter_prepare '{}'
  meter_start "$name"

  meter_command "$name" '/meter' 'Meter opened\.'
  wait_for 'the pane to open' meter_pane_is_open "$name"
  show_pane "$name" "after the first /meter ($label)" 30
  check "the CONTEXT row is on screen after the first /meter ($label)" 'no CONTEXT row on screen' meter_pane_is_open "$name"
  check "the frame is on screen after the first /meter ($label)" 'no close button of a frame on screen' meter_frame_is_drawn "$name"
  if [[ "$layout" == "$METER_FULLSCREEN" ]]; then
    check 'the TOP CONTEXT header is on screen after the first /meter (fullscreen)' 'no TOP CONTEXT header on screen' \
      meter_top_context_is_drawn "$name"
  fi

  meter_command "$name" '/meter' 'Meter closed\.'
  wait_for 'the pane to close' meter_pane_is_closed "$name"
  show_pane "$name" "after the second /meter ($label)" 30
  check "the CONTEXT row is gone after the second /meter ($label)" 'the CONTEXT row is still on screen' meter_pane_is_closed "$name"
  check "the frame is gone after the second /meter ($label)" 'a frame is still on screen' meter_frame_is_gone "$name"
}

scenario_run() {
  toggle_in_layout a "$METER_FULLSCREEN" fullscreen
  toggle_in_layout b "$METER_MAIN_SCREEN" main-screen
}
