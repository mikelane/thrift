#!/usr/bin/env bash
# #121 item 4: /meter refresh refreshes without focus, and opens a closed pane.

scenario_run() {
  # shellcheck disable=SC2034 # read by live_start
  LIVE_SESSION_ENV=$METER_FULLSCREEN
  meter_prepare '{}'
  meter_start a
  open_meter_with_old_reading a
  show_pane a 'setup: the label reads 1s or more' 30

  meter_command a '/meter refresh' 'Meter refreshed\.'
  wait_for 'the refresh to redraw the age label' meter_age_is_zero a
  show_pane a 'after /meter refresh' 30
  check '/meter refresh on an open pane replies Meter refreshed.' 'no Meter refreshed. reply on screen' \
    pane_has a 'Meter refreshed\.'
  check '/meter refresh resets the age label to 0s ago' "the label reads [$(meter_age_seconds a)]s" meter_age_is_zero a

  meter_command a '/meter' 'Meter closed\.'
  wait_for 'the pane to close' meter_pane_is_closed a
  meter_command a '/meter refresh' 'Meter opened\.'
  wait_for 'the pane to open' meter_pane_is_open a
  show_pane a 'after /meter refresh on a closed pane' 30
  check '/meter refresh on a closed pane replies Meter opened.' 'no second Meter opened. reply on screen' \
    eval '(($(pane_count a "Meter opened\\.") >= 2))'
  check '/meter refresh on a closed pane opens the pane' 'no pane on screen' meter_pane_is_open a
}
