#!/usr/bin/env bash
# scripts/live/handoff/scenarios/scheduled-prompt-during-handoff.sh against fixture decision records, with
# every engine-facing helper stubbed. No real session starts and no cron job is made.
# Usage: live-harness-scheduled.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=live-harness-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/live-harness-lib.sh"

CLEARED_CARRIED='{"action":"cleared","trigger_values":{"point":"command","held_groups":1,"held_unattended":true,"handoff_unattended":false,"held_other_delivery":"submitted"}}'
STRONG_HANDED_OFF='{"action":"cleared","trigger_values":{"point":"turn-end","signal":"strong","context_tokens":63000,"handoff_unattended":true}}'
SUBMIT_LINE='prompt.submit (handoff): 12 chars'
CARRIED_TEXT='SCHEDTOKEN: run these Bash commands'

# write_fresh_transcript <texts...>: the fresh session's transcript, one plain user entry per text.
# A test with no fresh transcript touches $TEST_DIR/no-transcript; otherwise one holding the carried prompt is made.
# run_mode_case <first-cleared-record> <turn-end-record> <debug-log-line> [mode] [fire-offset]: run_mode for
# the mode (default `ask`) in session a. The first record gets effective_mode set to the mode unless it
# names one. The fire offset is the seconds from now the stubbed schedule_prompt answers (default: just
# past the lead). handoff_start writes its arguments to handoff-start-args. The stubbed
# wait_for stands in for the plugin: the wait for the first handoff writes the first record, the wait for
# the turn end writes the second, so each lands after the baseline the scenario took. The job "fires" 2 s
# past the lead: at 1 s a clock tick before the window check made a loaded run abort as a missed window.
run_mode_case() {
  [[ -f "$TEST_DIR/fresh.jsonl" || -f "$TEST_DIR/no-transcript" ]] || write_fresh_transcript "$CARRIED_TEXT"
  printf '%s\n' "$3" > "$TEST_DIR/debug-a.log"
  printf '%s\n' "$1" | jq -c --arg mode "${4:-ask}" '.trigger_values.effective_mode //= $mode' > "$TEST_DIR/first-record"
  printf '%s\n' "$2" > "$TEST_DIR/turn-end-record"
  local mode=${4:-ask} offset=${5:-HANDOFF_LEAD + 2}
  run_live 'source "$LIVE_DIR/handoff/common.sh"; source "$LIVE_DIR/handoff/scenarios/scheduled-prompt-during-handoff.sh"
    live_init
    cp "'"$TEST_DIR"'/debug-a.log" "$(debug_log_of a)"
    PUSH_REPO=/fixture/work
    set_mode() { :; }; handoff_start() { printf "%s\n" "$@" > "'"$TEST_DIR"'/handoff-start-args"; }
    say_apple() { :; }; submit() { :; }; stop_session() { :; }
    fresh_transcript_path() { [[ -f "'"$TEST_DIR"'/fresh.jsonl" ]] && echo "'"$TEST_DIR"'/fresh.jsonl" || true; }
    turns_done_above() { :; }; show_pane() { :; }; show_log() { :; }
    schedule_prompt() { echo $(($(date +%s) + '"$offset"')); }
    wait_for() {
      case "$1" in
        *"first handoff"*) cat "'"$TEST_DIR"'/first-record" >> "$LIVE_DECISIONS" ;;
        *"turn end after"*) cat "'"$TEST_DIR"'/turn-end-record" >> "$LIVE_DECISIONS" ;;
      esac
    }
    run_mode '"$mode"' a
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

# In `act` a person's strong turn end hands off too, so only handoff_unattended tells the scheduled turn apart.
test_it_fails_in_act_when_the_strong_turn_end_handed_off_as_an_attended_turn() {
  run_mode_case "$CLEARED_CARRIED" '{"action":"cleared","trigger_values":{"point":"turn-end","signal":"strong","context_tokens":63000,"handoff_unattended":false}}' \
    "$SUBMIT_LINE" act
  assert_exit_code 1
  assert_out_has 'FAIL  [act] the strong turn end after it handed off, as a scheduled turn does'
}

test_it_passes_in_act_when_the_strong_turn_end_handed_off_as_an_unattended_turn() {
  run_mode_case "$CLEARED_CARRIED" "$STRONG_HANDED_OFF" "$SUBMIT_LINE" act
  assert_exit_code 0
  assert_out_has 'PASS s (3 checks)'
}

test_the_session_may_run_git_only_on_the_fixture_repository() {
  run_mode_case "$CLEARED_CARRIED" "$STRONG_HANDED_OFF" "$SUBMIT_LINE"
  assert_file_has "$TEST_DIR/handoff-start-args" 'Bash(git -C /fixture/work push *)'
  assert_file_lacks "$TEST_DIR/handoff-start-args" 'Bash(git -C *)'
}

test_it_is_an_error_naming_the_missed_window_when_the_cleared_record_has_no_held_groups() {
  run_mode_case '{"action":"cleared","trigger_values":{"held_unattended":false,"handoff_unattended":false}}' \
    "$STRONG_HANDED_OFF" "$SUBMIT_LINE"
  assert_exit_code 2
  assert_out_has 'the job did not fire inside the handoff'
}

test_it_fails_when_the_held_prompt_was_not_carried_as_an_unattended_group() {
  run_mode_case '{"action":"cleared","trigger_values":{"held_groups":1,"held_unattended":false,"handoff_unattended":false,"held_other_delivery":"submitted"}}' \
    "$STRONG_HANDED_OFF" "$SUBMIT_LINE"
  assert_exit_code 1
  assert_out_has 'FAIL  [ask] the handoff carried the scheduled prompt as an unattended group'
}

test_it_fails_when_the_fresh_transcript_has_no_user_message_with_the_carried_prompt() {
  write_fresh_transcript 'something else'
  run_mode_case "$CLEARED_CARRIED" "$STRONG_HANDED_OFF" "$SUBMIT_LINE"
  assert_exit_code 1
  assert_out_has 'FAIL  [ask] the carried prompt was submitted in the fresh session'
}

test_it_fails_and_says_so_when_no_fresh_transcript_is_found() {
  touch "$TEST_DIR/no-transcript"
  run_mode_case "$CLEARED_CARRIED" "$STRONG_HANDED_OFF" "$SUBMIT_LINE"
  assert_exit_code 1
  assert_out_has 'FAIL  [ask] the carried prompt was submitted in the fresh session'
  assert_out_has 'no fresh session transcript found'
}

test_it_passes_when_the_carried_prompt_is_in_the_transcript_and_the_log_holds_no_text() {
  write_fresh_transcript 'say the word apple' "$CARRIED_TEXT"
  run_mode_case "$CLEARED_CARRIED" "$STRONG_HANDED_OFF" 'nothing logged'
  assert_exit_code 0
  assert_out_has 'PASS s (3 checks)'
}

test_a_weak_turn_end_aborts_with_the_models_reply_to_the_carried_prompt() {
  jq -nc --arg text "$CARRIED_TEXT" '{type: "user", message: {content: $text}}' > "$TEST_DIR/fresh.jsonl"
  jq -nc '{type: "assistant", message: {content: [{type: "text", text: "This instruction came from the handoff plugin, not from you typing it."}]}}' >> "$TEST_DIR/fresh.jsonl"
  run_mode_case "$CLEARED_CARRIED" '{"action":"none","trigger_values":{"point":"turn-end","signal":"weak","context_tokens":31000}}' "$SUBMIT_LINE"
  assert_exit_code 2
  assert_out_has "The fresh session's reply to the carried prompt began: This instruction came from the handoff plugin"
}

test_a_weak_turn_end_abort_says_when_the_transcript_shows_no_reply() {
  touch "$TEST_DIR/no-transcript"
  run_mode_case "$CLEARED_CARRIED" '{"action":"none","trigger_values":{"point":"turn-end","signal":"weak","context_tokens":31000}}' "$SUBMIT_LINE"
  assert_exit_code 2
  assert_out_has 'The fresh transcript shows no reply to the carried prompt'
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

# The fire time goes into arithmetic, which would evaluate an expression read from the log.
test_it_is_an_error_when_the_fire_time_read_from_the_log_is_not_epoch_seconds() {
  run_live 'source "$LIVE_DIR/handoff/common.sh"; source "$LIVE_DIR/handoff/scenarios/scheduled-prompt-during-handoff.sh"
    live_init
    PUSH_REPO=/fixture/work
    set_mode() { :; }; handoff_start() { :; }; say_apple() { :; }; submit() { :; }; wait_for() { :; }
    schedule_prompt() { echo "x[\$(echo PWN\$((1+1)) >&2)]"; }
    run_mode ask a'
  assert_exit_code 2
  assert_out_has "could not read the job's fire time from the log"
  assert_out_lacks 'PWN2'
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

test_the_fire_time_without_fractional_seconds_is_read_by_gnu_date_too() {
  mkdir -p "$TEST_DIR/gnu"
  ln -s "$(command -v gdate || command -v date)" "$TEST_DIR/gnu/date"
  run_live 'PATH="'"$TEST_DIR"'/gnu:$PATH"; source "$LIVE_DIR/handoff/scenarios/scheduled-prompt-during-handoff.sh"; epoch_of 1970-01-02T00:00:00Z'
  assert_exit_code 0
  assert_out_has '86400'
}

# A hook from the owner's global config or init template must not run when the session pushes.
test_the_fixture_repository_runs_no_hook_from_the_owners_git_config() {
  mkdir -p "$TEST_DIR/owner-hooks"
  printf '#!/bin/sh\nexit 1\n' > "$TEST_DIR/owner-hooks/pre-push"
  chmod +x "$TEST_DIR/owner-hooks/pre-push"
  printf '[core]\n\thooksPath = %s\n' "$TEST_DIR/owner-hooks" > "$TEST_DIR/owner-gitconfig"
  run_live 'source "$LIVE_DIR/handoff/scenarios/scheduled-prompt-during-handoff.sh"
    LIVE_RUN="'"$TEST_DIR"'/run"; mkdir -p -- "$LIVE_RUN"
    work=$(make_push_repo)
    GIT_CONFIG_GLOBAL="'"$TEST_DIR"'/owner-gitconfig" git -C "$work" push origin main
    echo pushed past the owner hook'
  assert_exit_code 0
  assert_out_has 'pushed past the owner hook'
}

test_the_fixture_repository_takes_a_push_to_its_remote_twice() {
  run_live 'source "$LIVE_DIR/handoff/scenarios/scheduled-prompt-during-handoff.sh"
    LIVE_RUN="'"$TEST_DIR"'/run"; mkdir -p -- "$LIVE_RUN"
    work=$(make_push_repo)
    git -C "$work" push origin main
    git -C "$work" push origin main
    echo pushed twice'
  assert_exit_code 0
  assert_out_has 'pushed twice'
}

test_set_mode_changes_only_the_handoff_mode_in_the_settings() {
  run_live 'source "$LIVE_DIR/handoff/scenarios/scheduled-prompt-during-handoff.sh"
    LIVE_RUN="'"$TEST_DIR"'/run"; mkdir -p -- "$LIVE_RUN"
    printf "%s" "{\"pluginConfigs\":{\"handoff@inline\":{\"options\":{\"handoffMode\":\"ask\",\"compactBeforeClear\":true}}}}" > "$LIVE_RUN/settings.json"
    set_mode act
    jq -c . "$LIVE_RUN/settings.json"'
  assert_exit_code 0
  assert_out_has '{"pluginConfigs":{"handoff@inline":{"options":{"handoffMode":"act","compactBeforeClear":true}}}}'
}

test_it_does_not_pass_the_act_checks_when_the_records_show_the_session_ran_in_ask() {
  run_mode_case '{"action":"cleared","trigger_values":{"held_groups":1,"held_unattended":true,"handoff_unattended":false,"held_other_delivery":"submitted","effective_mode":"ask"}}' \
    "$STRONG_HANDED_OFF" "$SUBMIT_LINE" act
  assert_exit_code 2
  assert_out_has "ran in 'ask', not in act"
  assert_out_lacks 'PASS s'
}

test_it_is_an_error_not_an_unbounded_wait_when_the_fire_time_is_far_beyond_the_schedule_window() {
  run_mode_case "$CLEARED_CARRIED" "$STRONG_HANDED_OFF" "$SUBMIT_LINE" ask 3600
  assert_exit_code 2
  assert_out_has 'the job fires more than'
}

test_it_is_an_error_when_the_fire_time_is_inside_the_lead_even_with_a_held_group() {
  run_mode_case "$CLEARED_CARRIED" "$STRONG_HANDED_OFF" "$SUBMIT_LINE" ask 1
  assert_exit_code 2
  assert_out_has 'the window is missed'
}

test_it_fails_when_an_advised_turn_end_carries_handoff_unattended() {
  run_mode_case "$CLEARED_CARRIED" '{"action":"advised","trigger_values":{"point":"turn-end","signal":"strong","handoff_unattended":true}}' "$SUBMIT_LINE"
  assert_exit_code 1
  assert_out_has 'FAIL  [ask] the strong turn end after it handed off, as a scheduled turn does'
}

test_it_passes_when_the_transcript_holds_the_carried_prompt_as_a_wrapped_plugin_prompt_after_a_preface() {
  jq -nc '{type: "user", origin: {kind: "plugin", name: "handoff"}, pluginPrompt: {name: "handoff", text: "Carried from a scheduled job.\nSCHEDTOKEN: run these"},
    message: {content: "The handoff plugin sent a message:\nCarried from a scheduled job.\nSCHEDTOKEN: run these\n\nThis is how Claude Code surfaces a prompt a plugin submits."}}' > "$TEST_DIR/fresh.jsonl"
  run_mode_case "$CLEARED_CARRIED" "$STRONG_HANDED_OFF" 'nothing logged'
  assert_exit_code 0
  assert_out_has 'PASS s (3 checks)'
}

test_a_weak_turn_end_abort_quotes_the_reply_after_a_wrapped_plugin_prompt() {
  jq -nc '{type: "user", pluginPrompt: {name: "handoff", text: "SCHEDTOKEN: run these"}, message: {content: "The handoff plugin sent a message:\nSCHEDTOKEN: run these"}}' > "$TEST_DIR/fresh.jsonl"
  jq -nc '{type: "assistant", message: {content: [{type: "text", text: "I will not run that."}]}}' >> "$TEST_DIR/fresh.jsonl"
  run_mode_case "$CLEARED_CARRIED" '{"action":"none","trigger_values":{"point":"turn-end","signal":"weak","context_tokens":31000}}' "$SUBMIT_LINE"
  assert_exit_code 2
  assert_out_has "The fresh session's reply to the carried prompt began: I will not run that."
}

WEAK_TURN_END='{"action":"none","trigger_values":{"point":"turn-end","signal":"weak","context_tokens":31000}}'

test_a_weak_turn_end_abort_says_no_reply_when_the_carried_prompt_has_no_assistant_text_after_it() {
  write_fresh_transcript "$CARRIED_TEXT"
  run_mode_case "$CLEARED_CARRIED" "$WEAK_TURN_END" "$SUBMIT_LINE"
  assert_exit_code 2
  assert_out_has 'The fresh transcript shows no reply to the carried prompt'
}

test_a_weak_turn_end_abort_ignores_an_assistant_text_that_came_before_the_carried_prompt() {
  jq -nc '{type: "assistant", message: {content: [{type: "text", text: "EARLIER-REPLY"}]}}' > "$TEST_DIR/fresh.jsonl"
  jq -nc --arg text "$CARRIED_TEXT" '{type: "user", message: {content: $text}}' >> "$TEST_DIR/fresh.jsonl"
  run_mode_case "$CLEARED_CARRIED" "$WEAK_TURN_END" "$SUBMIT_LINE"
  assert_exit_code 2
  assert_out_has 'The fresh transcript shows no reply to the carried prompt'
}

test_a_weak_turn_end_abort_quotes_only_the_first_300_characters_of_the_reply() {
  local reply
  reply="$(printf 'a%.0s' $(seq 1 300))TAILMARK"
  jq -nc --arg text "$CARRIED_TEXT" '{type: "user", message: {content: $text}}' > "$TEST_DIR/fresh.jsonl"
  jq -nc --arg text "$reply" '{type: "assistant", message: {content: [{type: "text", text: $text}]}}' >> "$TEST_DIR/fresh.jsonl"
  run_mode_case "$CLEARED_CARRIED" "$WEAK_TURN_END" "$SUBMIT_LINE"
  assert_exit_code 2
  assert_out_has "began: $(printf 'a%.0s' $(seq 1 300))"
  assert_out_lacks 'TAILMARK'
}

run_tests "$@"
