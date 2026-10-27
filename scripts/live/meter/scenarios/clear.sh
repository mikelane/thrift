#!/usr/bin/env bash
# #121 item 7: whether the pane survives /clear. The declarations do not say, so either answer passes;
# the scenario prints which one it saw, then checks that /meter still answers after the clear (it was
# registered again), that the answer agrees with what the screen showed, and that COST restarted.

# One turn, then the COST row must read above $0.00. Without that figure the scenario cannot tell a
# restart from a cost that was always zero, so a COST that stays at $0.00 is an ERROR (the wait times out).
run_a_turn_until_cost() {
  say_apple a
  wait_for 'the COST row to read above $0.00' meter_cost_is_above_zero a
}
meter_cost_has_a_figure() { [[ -n "$(meter_cost "$1")" ]]; }
meter_replied_after_clear() { pane_has "$1" 'Meter (opened|closed)\.|nknown (skill|command)'; }
cost_restarted() { awk -v before="$1" -v after="$2" 'BEGIN { exit !(after == 0 || after < before) }'; }

scenario_run() {
  # shellcheck disable=SC2034 # read by live_start
  LIVE_SESSION_ENV=$METER_FULLSCREEN
  meter_prepare '{}'
  meter_start a
  meter_command a '/meter' 'Meter opened\.'
  wait_for 'the pane to open' meter_pane_is_open a
  run_a_turn_until_cost
  local cost_before
  cost_before=$(meter_cost a)
  show_pane a "before /clear (COST $cost_before)" 30

  submit a '/clear'
  wait_for 'the transcript to be cleared' meter_pane_lacks a 'say the word apple'
  # The pane is judged once the screen stops changing, so a redraw still on its way is not mistaken
  # for a pane that closed.
  wait_for 'the screen to settle after /clear' meter_screen_is_still a 16
  show_pane a 'after /clear' 30
  local expected_reply pane_stayed=no
  if meter_pane_is_open a; then
    pane_stayed=yes
    expected_reply='Meter closed\.'
  else
    expected_reply='Meter opened\.'
  fi
  echo "OBSERVED: the pane stayed open across /clear: $pane_stayed"

  submit a '/meter'
  wait_for 'the reply to /meter after the clear' meter_replied_after_clear a
  show_pane a 'after /meter following the clear' 30
  check "/meter after /clear replies $expected_reply, as the pane's state on screen implies" \
    'the reply does not match what the screen showed, or /meter is not registered' pane_has a "$expected_reply"

  if [[ "$pane_stayed" == yes ]]; then
    meter_command a '/meter' 'Meter opened\.'
  fi
  wait_for 'the pane to be open' meter_pane_is_open a
  wait_for 'the COST row' meter_cost_has_a_figure a
  local cost_after
  cost_after=$(meter_cost a)
  show_pane a "reopened after /clear (COST $cost_after, was $cost_before)" 30
  echo "OBSERVED: COST $cost_before before /clear, $cost_after after"
  check 'the pane is open after the clear and the follow-up /meter' 'no pane on screen' meter_pane_is_open a
  check 'COST restarted at the clear' "COST reads $cost_after, was $cost_before" cost_restarted "$cost_before" "$cost_after"
}
