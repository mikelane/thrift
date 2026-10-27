#!/usr/bin/env bash
# #121 item 2: the pane redraws after a turn. Before the first prompt the CONTEXT row waits for a
# response; after a one-word turn it shows a token figure.

scenario_run() {
  # shellcheck disable=SC2034 # read by live_start
  LIVE_SESSION_ENV=$METER_FULLSCREEN
  meter_prepare '{}'
  meter_start a

  meter_command a '/meter' 'Meter opened\.'
  wait_for 'the pane to open' meter_pane_is_open a
  show_pane a 'before the first prompt' 30
  check 'the CONTEXT row waits for the first response' 'the CONTEXT row does not read waiting for first response' \
    pane_has a 'CONTEXT +waiting for first response'

  say_apple a
  wait_for 'the CONTEXT row to show a token figure' pane_has a "CONTEXT +$METER_CONTEXT_FIGURES"
  show_pane a 'after the turn' 30
  check 'the CONTEXT row shows a token figure after the turn' 'the CONTEXT row shows no <tokens> / <window> figure' \
    pane_has a "CONTEXT +$METER_CONTEXT_FIGURES"
  check 'the CONTEXT row no longer waits for a response' 'the CONTEXT row still reads waiting for first response' \
    eval '! pane_has a "CONTEXT +waiting for first response"'
}
