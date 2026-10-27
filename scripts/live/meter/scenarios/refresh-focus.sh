#!/usr/bin/env bash
# #121 item 3: r refreshes the pane while it has focus, and does nothing from the composer.

METER_PRESS='ui\.press meter/refresh'

scenario_run() {
  # shellcheck disable=SC2034 # read by live_start
  LIVE_SESSION_ENV=$METER_FULLSCREEN
  meter_prepare '{}'
  meter_start a
  open_meter_with_old_reading a
  show_pane a 'setup: the label reads 1s or more' 30

  # Unfocused first, so that a press line can only come from the focused press below.
  type_text a r
  show_box a 'r typed in the composer'
  show_log a "$METER_PRESS"
  check 'r typed in the composer reaches the box' "the box holds [$(box_text a | tr '\n' ' ')]" box_shows a r
  check 'r typed in the composer fires no press' 'a ui.press meter/refresh line appeared' eval '[[ "$(log_count a "$METER_PRESS")" == 0 ]]'
  check 'the age label is unchanged by an unfocused r' 'the label was reset or redrawn' meter_age_is_at_least a 1

  press a C-u
  wait_for 'the box to empty' box_is_empty a
  press a C-x Tab
  press a r
  wait_for 'the focused r to fire the press' log_has a "$METER_PRESS"
  wait_for 'the refresh to redraw the age label' meter_age_is_zero a
  show_pane a 'after the focused r' 30
  show_log a "$METER_PRESS"
  check 'a focused r fires the refresh press' 'no ui.press meter/refresh line in the debug log' log_has a "$METER_PRESS"
  check 'a focused r resets the age label to 0s ago' "the label reads [$(meter_age_seconds a)]s" meter_age_is_zero a
}
