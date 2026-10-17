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

# run_judge <expectation> <session ends> <decision-log lines>: judge_case of the clear/resume scenario for
# one case "old1", with the session ending twice and the note in the transcript of a fresh session.
# RESUME_TARGET_ID names the session a /resume would load; its transcript holds the note when
# NOTE_IN_RESUMED is set.
run_judge() {
  local expectation=$1 ends=$2 records=$3
  printf '%s\n' "$records" > "$TEST_DIR/decisions"
  run_live 'source "$LIVE_DIR/handoff/common.sh"; source "$LIVE_DIR/handoff/scenarios/clear-resume-during-handoff.sh"
    CLAUDE_CONFIG_DIR=$HOME/.claude
    live_init
    cp "'"$TEST_DIR"'/decisions" "$LIVE_DECISIONS"
    printf "session.end settled\nhandoff@inline session.end settled in 1ms\nhandoff@inline session.end settled in 1ms\n" > "$(debug_log_of c)"
    mkdir -p "$CLAUDE_CONFIG_DIR/projects/p"
    echo x > "$CLAUDE_CONFIG_DIR/projects/p/old1.jsonl"
    echo "Handoff from the previous session (old1), written by Claude" > "$CLAUDE_CONFIG_DIR/projects/p/${NOTE_FILE:-fresh}.jsonl"
    RESUME_TARGET_ID=resumed
    CASE_LABEL=case; CASE_ID=old1; CASE_BASE=0
    judge_case c '"$expectation"' '"$ends"'
    live_verdict s' NOTE_FILE="${NOTE_FILE:-fresh}"
}

cleared_record() { echo "{\"action\":\"cleared\",\"session_id\":\"${1:-old1}\",\"trigger_values\":{\"cleared_by\":\"${2:-person}\",\"effective_mode\":\"${3:-ask}\"}}"; }
session_ended_record() { echo '{"action":"none","session_id":"old1","trigger_values":{"reason":"session_ended","effective_mode":"ask"}}'; }
failure_record() { echo "{\"action\":\"none\",\"session_id\":\"old1\",\"trigger_values\":{\"reason\":\"$1\",\"effective_mode\":\"ask\"}}"; }

test_clear_resume_passes_one_person_clear_that_names_the_session_and_the_mode() {
  run_judge cleared_by_person 2 "$(cleared_record)"
  assert_exit_code 0
  assert_out_has 'PASS s (7 checks)'
}

test_clear_resume_accepts_a_session_ended_record_for_a_resume() {
  run_judge any_ending 2 "$(session_ended_record)"
  assert_exit_code 0
}

test_clear_resume_is_a_fail_when_two_records_end_the_handoff() {
  run_judge any_ending 2 "$(cleared_record old1 handoff)"$'\n'"$(session_ended_record)"
  assert_exit_code 1
  assert_out_has 'FAIL  case: exactly one record ends the handoff'
}

test_clear_resume_is_a_fail_when_the_record_names_another_session() {
  run_judge cleared_by_person 2 "$(cleared_record other)"
  assert_exit_code 1
  assert_out_has 'FAIL  case: it names the session the handoff started in'
}

test_clear_resume_is_a_fail_when_the_record_carries_another_effective_mode() {
  run_judge cleared_by_person 2 "$(cleared_record old1 person off)"
  assert_exit_code 1
  assert_out_has 'FAIL  case: it carries effective_mode ask'
}

test_clear_resume_is_a_fail_when_a_person_clear_is_recorded_as_the_handoffs() {
  run_judge cleared_by_person 2 "$(cleared_record old1 handoff)"
  assert_exit_code 1
  assert_out_has 'FAIL  case: the person'"'"'s clear ended it (cleared_by person)'
}

test_clear_resume_is_a_fail_when_the_handoff_reports_a_failure() {
  run_judge cleared_by_person 2 "$(cleared_record)"$'\n'"$(failure_record clear_failed)"
  assert_exit_code 1
  assert_out_has 'FAIL  case: no record reports a failure'
}

test_clear_resume_does_not_count_a_failed_compaction_as_a_failure() {
  run_judge cleared_by_person 2 "$(failure_record compaction_failed)"$'\n'"$(cleared_record)"
  assert_exit_code 0
}

test_clear_resume_is_a_fail_when_the_session_ended_a_different_number_of_times() {
  run_judge cleared_by_person 3 "$(cleared_record)"
  assert_exit_code 1
  assert_out_has 'FAIL  case: the session ended 3 time(s)'
}

test_clear_resume_is_a_fail_when_the_note_reached_the_resumed_session() {
  NOTE_FILE=resumed run_judge cleared_by_person 2 "$(cleared_record)"
  assert_exit_code 1
  assert_out_has 'FAIL  case: the handoff note reached exactly one transcript, not the resumed session'"'"'s'
}

test_settle_until_returns_after_its_limit_when_the_condition_never_holds() {
  run_live 'source "$LIVE_DIR/handoff/common.sh"; source "$LIVE_DIR/handoff/scenarios/clear-resume-during-handoff.sh"
    SETTLE_SECONDS=1; LIVE_POLL=0.1
    settle_until false
    echo SETTLED'
  assert_exit_code 0
  assert_out_has 'SETTLED'
}

run_tests "$@"
