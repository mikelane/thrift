#!/usr/bin/env bash
# scripts/live/handoff/scenarios/scheduled-prompt-during-handoff.sh against fixture decision records, with
# every engine-facing helper stubbed. No real session starts and no cron job is made.
# Usage: live-harness-scheduled.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=live-harness-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/live-harness-lib.sh"

CLEARED_CARRIED='{"action":"cleared","trigger_values":{"point":"command","held_groups":1,"held_unattended":true,"handoff_unattended":false,"held_other_delivery":"submitted"}}'
STRONG_HANDED_OFF='{"action":"cleared","trigger_values":{"point":"turn-end","signal":"strong","context_tokens":63000}}'
SUBMIT_LINE='prompt.submit (handoff): "SCHEDTOKEN: run these Bash commands"'

# run_mode_case <first-cleared-record> <turn-end-record> <debug-log-line>: run_mode for `ask` in session a.
# The stubbed wait_for stands in for the plugin: the wait for the first handoff writes the first record, the
# wait for the turn end writes the second, so each lands after the baseline the scenario took.
run_mode_case() {
  printf '%s\n' "$3" > "$TEST_DIR/debug-a.log"
  printf '%s\n' "$1" > "$TEST_DIR/first-record"
  printf '%s\n' "$2" > "$TEST_DIR/turn-end-record"
  run_live 'source "$LIVE_DIR/handoff/common.sh"; source "$LIVE_DIR/handoff/scenarios/scheduled-prompt-during-handoff.sh"
    live_init
    cp "'"$TEST_DIR"'/debug-a.log" "$(debug_log_of a)"
    set_mode() { :; }; handoff_start() { :; }; say_apple() { :; }; submit() { :; }; stop_session() { :; }
    turns_done_above() { :; }; show_pane() { :; }; show_log() { :; }
    schedule_prompt() { echo $(($(date +%s) + 7)); }
    wait_for() {
      case "$1" in
        *"first handoff"*) cat "'"$TEST_DIR"'/first-record" >> "$LIVE_DECISIONS" ;;
        *"turn end after"*) cat "'"$TEST_DIR"'/turn-end-record" >> "$LIVE_DECISIONS" ;;
      esac
    }
    run_mode ask a
    live_verdict s'
}

test_it_passes_when_the_carried_scheduled_prompt_is_followed_by_a_handoff_at_the_strong_turn_end() {
  run_mode_case "$CLEARED_CARRIED" "$STRONG_HANDED_OFF" "$SUBMIT_LINE"
  assert_exit_code 0
  assert_out_has 'PASS s (3 checks)'
}

test_it_fails_when_the_strong_turn_end_only_advised_as_it_does_for_a_person() {
  run_mode_case "$CLEARED_CARRIED" '{"action":"advised","trigger_values":{"point":"turn-end","signal":"strong","context_tokens":63000}}' "$SUBMIT_LINE"
  assert_exit_code 1
  assert_out_has 'FAIL  [ask] the strong turn end after it handed off, as a scheduled turn does'
}

test_it_fails_when_the_held_prompt_was_not_carried_as_an_unattended_group() {
  run_mode_case '{"action":"cleared","trigger_values":{"held_groups":1,"held_unattended":false,"handoff_unattended":false,"held_other_delivery":"submitted"}}' \
    "$STRONG_HANDED_OFF" "$SUBMIT_LINE"
  assert_exit_code 1
  assert_out_has 'FAIL  [ask] the handoff carried the scheduled prompt as an unattended group'
}

test_it_fails_when_the_carried_prompt_was_never_submitted_in_the_fresh_session() {
  run_mode_case "$CLEARED_CARRIED" "$STRONG_HANDED_OFF" 'nothing submitted'
  assert_exit_code 1
  assert_out_has 'FAIL  [ask] the carried prompt was submitted in the fresh session'
}

test_it_fails_when_the_prompt_was_left_in_the_box_instead_of_submitted() {
  run_mode_case '{"action":"cleared","trigger_values":{"held_groups":1,"held_unattended":true,"handoff_unattended":false,"held_other_delivery":"in_box"}}' \
    "$STRONG_HANDED_OFF" "$SUBMIT_LINE"
  assert_exit_code 1
  assert_out_has 'FAIL  [ask] the carried prompt was submitted in the fresh session'
}

test_it_is_an_error_not_a_pass_when_the_job_fired_outside_the_handoff() {
  run_mode_case '{"action":"cleared","trigger_values":{"held_groups":0,"held_unattended":false,"handoff_unattended":false,"held_other_delivery":"none"}}' \
    "$STRONG_HANDED_OFF" "$SUBMIT_LINE"
  assert_exit_code 2
  assert_out_has 'the job did not fire inside the handoff'
}

test_it_is_an_error_not_a_pass_when_the_turn_end_was_not_strong() {
  run_mode_case "$CLEARED_CARRIED" '{"action":"none","trigger_values":{"point":"turn-end","signal":"weak","context_tokens":31000}}' "$SUBMIT_LINE"
  assert_exit_code 2
  assert_out_has "the turn end after the carried prompt was 'weak', not strong"
}

test_the_job_is_scheduled_for_a_minute_boundary_the_cron_fields_name() {
  run_live 'source "$LIVE_DIR/handoff/scenarios/scheduled-prompt-during-handoff.sh"; TZ=UTC cron_fields 86400'
  assert_exit_code 0
  assert_out_has '00 00 02 01 *'
}

test_the_fire_time_in_the_log_is_read_as_utc_epoch_seconds() {
  run_live 'source "$LIVE_DIR/handoff/scenarios/scheduled-prompt-during-handoff.sh"; epoch_of 1970-01-02T00:00:00.000Z'
  assert_exit_code 0
  assert_out_has '86400'
}

test_the_fixture_repository_takes_a_push_to_its_remote_twice() {
  run_live 'source "$LIVE_DIR/handoff/scenarios/scheduled-prompt-during-handoff.sh"
    LIVE_RUN=$(mktemp -d)
    work=$(make_push_repo)
    git -C "$work" push origin main
    git -C "$work" push origin main
    echo pushed twice'
  assert_exit_code 0
  assert_out_has 'pushed twice'
}

test_set_mode_changes_only_the_handoff_mode_in_the_settings() {
  run_live 'source "$LIVE_DIR/handoff/scenarios/scheduled-prompt-during-handoff.sh"
    LIVE_RUN=$(mktemp -d)
    printf "%s" "{\"pluginConfigs\":{\"handoff@inline\":{\"options\":{\"handoffMode\":\"ask\",\"compactBeforeClear\":true}}}}" > "$LIVE_RUN/settings.json"
    set_mode act
    jq -c . "$LIVE_RUN/settings.json"'
  assert_exit_code 0
  assert_out_has '{"pluginConfigs":{"handoff@inline":{"options":{"handoffMode":"act","compactBeforeClear":true}}}}'
}

run_tests "$@"
