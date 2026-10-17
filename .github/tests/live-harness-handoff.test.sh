#!/usr/bin/env bash
# scripts/live/handoff: the helpers in common.sh and the restore-order-after-abandon scenario, against
# fixture logs with every engine-facing helper stubbed. No real session starts.
# Usage: live-harness-handoff.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=live-harness-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/live-harness-lib.sh"

test_start_waiting_handoff_types_the_peer_message_before_it_presses_the_band_and_sends_it_after() {
  run_live 'source "$LIVE_DIR/handoff/common.sh"
    handoff_start() { echo "CALL start $*"; }; say_apple() { echo "CALL apple $1"; }
    wait_for() { echo "CALL wait $1"; }
    type_text() { echo "CALL type $1"; }; press() { echo "CALL press $*"; }
    start_waiting_handoff a b "do the task"'
  assert_exit_code 0
  assert_out_has 'CALL start a --allowedTools Bash(sleep *)'
  local order
  order=$(grep -o 'CALL type b\|CALL press a h\|CALL press b Enter\|CALL wait the handoff to wait' "$OUTPUT" | paste -sd, -)
  [[ "$order" == 'CALL type b,CALL press a h,CALL press b Enter,CALL wait the handoff to wait' ]] \
    || fail "the calls came in this order: $order"
}

# run_restore_order <screen> <debug-log-lines>: the scenario with the screen, the debug log and one
# background_busy abandon record fixed, and every engine-facing helper a no-op.
run_restore_order() {
  local screen=$1 log_lines=$2
  printf '%s\n' "$log_lines" > "$TEST_DIR/debug-a.log"
  printf '%s\n' "$screen" > "$TEST_DIR/box"
  run_live 'source "$LIVE_DIR/handoff/common.sh"; source "$LIVE_DIR/handoff/scenarios/restore-order-after-abandon.sh"
    live_init
    handoff_prepare() { :; }; start_peer_messenger() { :; }; start_waiting_handoff() { :; }
    submit() { :; }; type_text() { :; }; log_has() { :; }; box_shows() { :; }
    show_pane() { :; }; show_box() { :; }; show_log() { :; }
    pane() { cat "'"$TEST_DIR"'/box"; }
    cp "'"$TEST_DIR"'/debug-a.log" "$(debug_log_of a)"
    printf "%s\n" "{\"action\":\"none\",\"trigger_values\":{\"reason\":\"background_busy\",\"held_restore\":\"in_box\"}}" > "$LIVE_DECISIONS"
    LIVE_TIMEOUT=1
    scenario_run
    live_verdict s'
}

RESTORED_BOX=$'❯ one                  \n\n  two\n   \n  three\n  draft'
WAIT_ENDED_LOG=$'cc_turn_origin=human\ncc_turn_origin=peer\nresumed after the wait for a running turn\nprompt.fill (plugin, replace): 21 chars, filled'

test_restore_order_passes_when_the_prompts_are_back_in_order_before_the_draft() {
  run_restore_order "$(printf '%s\n%s\n' '──────' "$RESTORED_BOX"; echo '──────')" "$WAIT_ENDED_LOG"
  assert_exit_code 0
  assert_out_has 'PASS s (4 checks)'
}

test_restore_order_is_a_fail_when_the_draft_comes_before_the_restored_prompts() {
  run_restore_order "$(printf '%s\n' '──────' '❯ draft' 'one' 'two' 'three' '──────')" "$WAIT_ENDED_LOG"
  assert_exit_code 1
  assert_out_has 'FAIL  the restored prompts are in typing order, before the draft, which is still unsent'
}

test_restore_order_is_a_fail_when_the_prompts_are_restored_out_of_order() {
  run_restore_order "$(printf '%s\n' '──────' '❯ one' '' 'three' '' 'two' 'draft' '──────')" "$WAIT_ENDED_LOG"
  assert_exit_code 1
  assert_out_has 'FAIL  the restored prompts are in typing order'
}

test_restore_order_is_a_fail_when_a_person_turn_starts_after_the_wait() {
  run_restore_order "$(printf '%s\n%s\n' '──────' "$RESTORED_BOX"; echo '──────')" \
    "$WAIT_ENDED_LOG"$'\ncc_turn_origin=human'
  assert_exit_code 1
  assert_out_has 'FAIL  the draft was not sent: no person turn started in the old session after the wait'
}

run_tests "$@"
