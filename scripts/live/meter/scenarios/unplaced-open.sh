#!/usr/bin/env bash
# #135: a pane that meterAutoOpen listed but the engine did not place (109 columns, below the unasked floor)
# opens on the first /meter, as asked, instead of being closed. A second /meter closes it. Start from a config
# without the asked entry, so the floor is the unasked one.

scenario_run() {
  ensure_not_asked
  # shellcheck disable=SC2034 # read by live_start
  LIVE_COLUMNS=109
  # shellcheck disable=SC2034 # read by live_start
  LIVE_SESSION_ENV=$METER_FULLSCREEN
  meter_prepare '{"meterAutoOpen": true}'
  meter_start u
  wait_for 'the screen to settle' meter_screen_is_still u 16
  show_pane u 'after the unasked open at 109 columns' 30
  check 'the unasked pane is not placed at 109 columns' 'a CONTEXT row is on screen' meter_pane_is_closed u

  meter_command u '/meter' 'Meter (opened|closed)\.'
  wait_for 'the screen to settle after /meter' meter_screen_is_still u 16
  show_pane u 'after the first /meter' 30
  check 'the first /meter replies Meter opened.' 'it replied otherwise' pane_has u 'Meter opened\.'
  check 'the pane is drawn after the first /meter' 'no CONTEXT row on screen' meter_pane_is_open u
  check 'meter is in the asked list after the first /meter' "asked list: $(meter_asked_panes)" meter_was_asked

  meter_command u '/meter' 'Meter closed\.'
  wait_for 'the pane to close' meter_pane_is_closed u
  check 'the second /meter closes the pane' 'the CONTEXT row is still on screen' meter_pane_is_closed u
  end_session u
}
