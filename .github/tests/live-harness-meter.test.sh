#!/usr/bin/env bash
# scripts/live/meter: the screen judgments in common.sh, against the stub `tmux`, which fails every
# call, so `pane` cannot read the screen (as for a session that died). No real session starts.
# Usage: live-harness-meter.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=live-harness-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/live-harness-lib.sh"

# A screen that cannot be read is not a closed pane: the toggle check "the CONTEXT row is gone" would
# otherwise pass for a session that died after its reply.
test_meter_pane_is_closed_fails_when_the_pane_cannot_be_read() {
  run_live 'source "$LIVE_DIR/meter/common.sh"
    if meter_pane_is_closed a; then echo JUDGED-CLOSED; else echo NOT-JUDGED-CLOSED; fi'
  assert_out_has 'NOT-JUDGED-CLOSED'
}

test_meter_frame_is_gone_fails_when_the_pane_cannot_be_read() {
  run_live 'source "$LIVE_DIR/meter/common.sh"
    if meter_frame_is_gone a; then echo JUDGED-GONE; else echo NOT-JUDGED-GONE; fi'
  assert_out_has 'NOT-JUDGED-GONE'
  assert_out_lacks 'command not found'
}

# A screen that cannot be read is not a still screen: placement and clear judge "not placed" and "stayed"
# from a still screen.
test_meter_screen_is_still_fails_when_the_pane_cannot_be_read() {
  run_live 'source "$LIVE_DIR/meter/common.sh"; LIVE_RUN=$TMPDIR
    meter_screen_is_still a 1 || true
    if meter_screen_is_still a 1; then echo JUDGED-STILL; else echo NOT-JUDGED-STILL; fi'
  assert_out_has 'NOT-JUDGED-STILL'
}

test_meter_pane_is_closed_succeeds_on_a_screen_without_the_context_row() {
  run_live 'source "$LIVE_DIR/meter/common.sh"; pane() { printf "%s\n" "❯ say the word apple" "apple"; }
    meter_pane_is_closed a && echo JUDGED-CLOSED'
  assert_out_has 'JUDGED-CLOSED'
}

test_meter_pane_is_closed_fails_on_a_screen_with_the_context_row() {
  run_live 'source "$LIVE_DIR/meter/common.sh"; pane() { printf "%s\n" "CONTEXT  41k / 1M"; }
    if meter_pane_is_closed a; then echo JUDGED-CLOSED; else echo NOT-JUDGED-CLOSED; fi'
  assert_out_has 'NOT-JUDGED-CLOSED'
}

test_meter_frame_is_gone_succeeds_on_a_screen_without_a_frame() {
  run_live 'source "$LIVE_DIR/meter/common.sh"; pane() { printf "%s\n" "❯ /meter" "Meter closed."; }
    meter_frame_is_gone a && echo JUDGED-GONE'
  assert_out_has 'JUDGED-GONE'
}

test_meter_frame_is_gone_fails_on_a_screen_with_a_docked_frame() {
  run_live 'source "$LIVE_DIR/meter/common.sh"; pane() { printf "%s\n" "transcript   │   ✕"; }
    if meter_frame_is_gone a; then echo JUDGED-GONE; else echo NOT-JUDGED-GONE; fi'
  assert_out_has 'NOT-JUDGED-GONE'
}

test_meter_screen_is_still_succeeds_once_a_readable_screen_repeats() {
  run_live 'source "$LIVE_DIR/meter/common.sh"; LIVE_RUN=$TMPDIR; pane() { printf "%s\n" "same screen"; }
    meter_screen_is_still a 1 || true
    meter_screen_is_still a 1 && echo JUDGED-STILL'
  assert_out_has 'JUDGED-STILL'
}

run_tests "$@"
