#!/usr/bin/env bash
# scripts/live/handoff: the subagents-during-handoff scenario's judgements, against fixture decision
# records, debug logs, transcripts and screens with every engine-facing helper stubbed. No real session
# starts.
# Usage: live-harness-subagents.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=live-harness-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/live-harness-lib.sh"

SCENARIO='source "$LIVE_DIR/handoff/common.sh"; source "$LIVE_DIR/handoff/scenarios/subagents-during-handoff.sh"'
T0=2026-10-17T10:00:00.000Z
T1=2026-10-17T10:00:01.000Z
T2=2026-10-17T10:00:02.000Z
T3=2026-10-17T10:00:03.000Z
T4=2026-10-17T10:00:04.000Z

record() { echo "{\"ts\":\"$1\",\"session_id\":\"${4:-s1}\",\"action\":\"$2\",\"trigger_values\":$3}"; }
cleared() { record "$1" cleared "{\"point\":\"command\",\"is_background_busy\":${2:-true}}" "${3:-s1}"; }
turn_end() { record "$1" none "{\"point\":\"turn-end\",\"is_background_busy\":${2:-true}}"; }
# after_a_busy_turn_end <record>: the turn that started the agent ended busy at T1, then the record.
after_a_busy_turn_end() { printf '%s\n%s' "$(turn_end $T1)" "$1"; }
refused() { record "$1" none "{\"point\":\"${2:-button}\",\"reason\":\"background_busy\",\"is_background_busy\":${3:-true}}" "${4:-s1}"; }

# run_judge <name> <snippet>: the scenario's helpers with the decision log in $TEST_DIR/decisions, the
# debug log of session x in $TEST_DIR/debug and the screen of every session in $TEST_DIR/pane.
run_judge() {
  run_live "$SCENARIO"'
    CLAUDE_CONFIG_DIR=$HOME/.claude
    live_init
    cp "'"$TEST_DIR"'/decisions" "$LIVE_DECISIONS"
    cp "'"$TEST_DIR"'/debug" "$(debug_log_of x)"
    pane() { cat "'"$TEST_DIR"'/pane"; }
    mkdir -p "$CLAUDE_CONFIG_DIR/projects/p"
    echo "{}" > "$CLAUDE_CONFIG_DIR/projects/p/s1.jsonl"
    [[ ! -f "'"$TEST_DIR"'/fresh" ]] || cp "'"$TEST_DIR"'/fresh" "$CLAUDE_CONFIG_DIR/projects/p/fresh.jsonl"
    '"$1"'
    live_verdict s'
}

# judge_fixture <records> <debug log line...>: the files run_judge copies, with an empty screen.
judge_fixture() {
  printf '%s\n' "$1" > "$TEST_DIR/decisions"
  shift
  printf '%s\n' "$@" > "$TEST_DIR/debug"
  : > "$TEST_DIR/pane"
  rm -f "$TEST_DIR/fresh"
}

fresh_note() { printf '%s\n' "Handoff from the previous session (s1), written by Claude" "$@" > "$TEST_DIR/fresh"; }
NOTE_LINE='A turn ran in the previous session while or after this note was written, so the note may not cover it.'

# --- 1. a background agent runs when /handoff is typed ----------------------------------------------------

NOTIFICATION_TURN_LOG="$T4 [DEBUG] attribution header x-anthropic-billing-header: cc_turn_origin=task_notification"

test_background_agent_passes_when_the_note_and_the_notification_reach_the_fresh_session() {
  judge_fixture "$(after_a_busy_turn_end "$(cleared $T2)")" "$NOTIFICATION_TURN_LOG"
  fresh_note "$NOTE_LINE" '<task-notification>'
  run_judge 'judge_background_agent x s1'
  assert_exit_code 0
  assert_out_has 'PASS s (6 checks)'
}

test_background_agent_is_a_fail_when_the_turn_that_started_the_agent_ended_idle() {
  judge_fixture "$(turn_end $T1 false)"$'\n'"$(cleared $T2)" "$NOTIFICATION_TURN_LOG"
  fresh_note "$NOTE_LINE" '<task-notification>'
  run_judge 'judge_background_agent x s1'
  assert_exit_code 1
  assert_out_has 'FAIL  the turn that started the agent ended with background work running'
  assert_out_lacks 'FAIL  the handoff cleared'
}

test_background_agent_is_a_fail_when_the_note_lacks_the_turn_after_note_line() {
  judge_fixture "$(after_a_busy_turn_end "$(cleared $T2)")" "$NOTIFICATION_TURN_LOG"
  fresh_note '<task-notification>'
  run_judge 'judge_background_agent x s1'
  assert_exit_code 1
  assert_out_has 'FAIL  the note in the fresh session has the turn-after-note line'
  assert_out_lacks 'FAIL  the agent'
}

test_background_agent_is_a_fail_when_the_notification_never_reaches_the_fresh_session() {
  judge_fixture "$(after_a_busy_turn_end "$(cleared $T2)")" "$NOTIFICATION_TURN_LOG"
  fresh_note "$NOTE_LINE"
  run_judge 'judge_background_agent x s1'
  assert_exit_code 1
  assert_out_has "FAIL  the agent's task notification reached the fresh session"
}

test_background_agent_is_a_fail_when_no_notification_turn_began_after_the_clear() {
  judge_fixture "$(after_a_busy_turn_end "$(cleared $T2)")" "$T1 [DEBUG] attribution header: cc_turn_origin=task_notification"
  fresh_note "$NOTE_LINE" '<task-notification>'
  run_judge 'judge_background_agent x s1'
  assert_exit_code 1
  assert_out_has 'FAIL  a notification turn began after the clear'
}

test_background_agent_is_a_fail_when_the_log_shows_no_notification_turn_at_all() {
  judge_fixture "$(after_a_busy_turn_end "$(cleared $T2)")" "$T3 [DEBUG] attribution header: cc_turn_origin=human"
  fresh_note "$NOTE_LINE" '<task-notification>'
  run_judge 'judge_background_agent x s1'
  assert_exit_code 1
  assert_out_has 'FAIL  a notification turn began after the clear'
}

test_background_agent_is_a_fail_when_no_fresh_session_holds_a_note() {
  judge_fixture "$(after_a_busy_turn_end "$(cleared $T2)")" "$NOTIFICATION_TURN_LOG"
  run_judge 'judge_background_agent x s1'
  assert_exit_code 1
  assert_out_has 'FAIL  the note in the fresh session has the turn-after-note line'
  assert_out_has "FAIL  the agent's task notification reached the fresh session"
  assert_out_has 'no transcript of a fresh session holds the note of s1'
  assert_out_has 'holds the note of s1 under ~/.claude'
}

test_background_agent_is_a_fail_when_the_handoff_did_not_clear() {
  judge_fixture "$(after_a_busy_turn_end "$(refused $T2)")" "$NOTIFICATION_TURN_LOG"
  fresh_note "$NOTE_LINE" '<task-notification>'
  run_judge 'judge_background_agent x s1'
  assert_exit_code 1
  assert_out_has 'FAIL  the handoff cleared although a subagent was running'
}

test_background_agent_is_a_fail_when_nothing_was_running_at_the_handoff() {
  judge_fixture "$(after_a_busy_turn_end "$(cleared $T2 false)")" "$NOTIFICATION_TURN_LOG"
  fresh_note "$NOTE_LINE" '<task-notification>'
  run_judge 'judge_background_agent x s1'
  assert_exit_code 1
  assert_out_has 'FAIL  the cleared record says background work was running'
}

test_background_agent_ignores_the_records_of_another_session() {
  judge_fixture "$(after_a_busy_turn_end "$(cleared $T2 true other)")" "$NOTIFICATION_TURN_LOG"
  fresh_note "$NOTE_LINE" '<task-notification>'
  run_judge 'judge_background_agent x s1'
  assert_exit_code 1
  assert_out_has 'FAIL  the handoff cleared although a subagent was running'
}

# --- 2. a band press while a subagent runs ----------------------------------------------------------------------

PRESS_LOG="$T1 [DEBUG] ui.press handoff/handoff in AbovePrompt from terminal: settled in 5ms"
TURN_END_LOG="$T2 [DEBUG] [engine] turn 2 end (turns=3)"
BUSY_BAND='Background work is still running, so compact instead?
c: Compact  0: Not now'

judge_press() { judge_fixture "$1" "$PRESS_LOG" "${2-$TURN_END_LOG}"; printf '%s\n' "${3-$BUSY_BAND}" > "$TEST_DIR/pane"; run_judge 'judge_press_while_a_subagent_runs x s1'; }

test_press_passes_when_it_is_refused_as_busy_after_the_turn_ended_and_the_band_loses_hand_off() {
  judge_press "$(refused $T3)"
  assert_exit_code 0
  assert_out_has 'PASS s (5 checks)'
}

test_press_is_a_fail_when_the_refusal_is_recorded_before_the_turn_ended() {
  judge_press "$(refused $T1)"
  assert_exit_code 1
  assert_out_has 'FAIL  the refusal came after the main turn ended'
}

test_press_is_a_fail_when_the_log_shows_no_turn_end_after_the_press() {
  judge_press "$(refused $T3)" ''
  assert_exit_code 1
  assert_out_has 'FAIL  the refusal came after the main turn ended'
}

test_press_is_a_fail_when_the_turn_end_comes_before_the_press() {
  judge_fixture "$(refused $T3)" "$T0 [DEBUG] [engine] turn 1 end" "$PRESS_LOG"
  printf '%s\n' "$BUSY_BAND" > "$TEST_DIR/pane"
  run_judge 'judge_press_while_a_subagent_runs x s1'
  assert_exit_code 1
  assert_out_has 'FAIL  the refusal came after the main turn ended'
}

test_press_is_a_fail_when_the_refusal_has_no_timestamp() {
  judge_press '{"session_id":"s1","action":"none","trigger_values":{"point":"button","reason":"background_busy","is_background_busy":true}}'
  assert_exit_code 1
  assert_out_has 'FAIL  the refusal came after the main turn ended'
}

test_press_is_a_fail_when_the_handoff_cleared() {
  judge_press "$(cleared $T3)"
  assert_exit_code 1
  assert_out_has 'FAIL  the hand-off press was refused as busy'
  assert_out_has 'FAIL  nothing was cleared'
}

test_press_is_a_fail_when_a_clear_follows_the_refusal() {
  judge_press "$(refused $T3)"$'\n'"$(cleared $T4)"
  assert_exit_code 1
  assert_out_has 'FAIL  nothing was cleared'
  assert_out_lacks 'FAIL  the hand-off press was refused as busy'
}

test_press_is_a_fail_when_the_refusal_did_not_come_from_a_button() {
  judge_press "$(refused $T3 turn-end)"
  assert_exit_code 1
  assert_out_has 'FAIL  the hand-off press was refused as busy'
}

test_press_is_a_fail_when_the_refusal_says_nothing_was_running() {
  judge_press "$(refused $T3 button false)"
  assert_exit_code 1
  assert_out_has 'FAIL  the refusal record says background work was running'
}

test_press_is_a_fail_when_the_band_still_offers_hand_off() {
  judge_press "$(refused $T3)" "$TURN_END_LOG" 'h: Hand off and clear  c: Compact'
  assert_exit_code 1
  assert_out_has 'FAIL  the band offers no hand-off while the subagent runs'
}

test_press_is_a_fail_when_the_screen_cannot_be_read() {
  judge_press "$(refused $T3)" "$TURN_END_LOG" ''
  assert_exit_code 1
  assert_out_has 'FAIL  the band offers no hand-off while the subagent runs'
}

# --- 3. a foreground agent during the wait -----------------------------------------------------------------------

PEER_LOG="$T0 [DEBUG] attribution header: cc_turn_origin=peer"
AGENT_LOG="$T2 [INFO] [Stall] agent_completion agentId=a1 agentType=general-purpose"
MAIN_END_LOG="$T3 [DEBUG] [engine] turn 2 end (turns=2)"

judge_foreground() { judge_fixture "$@"; run_judge 'judge_foreground_agent x s1'; }

test_foreground_agent_passes_when_the_clear_follows_the_main_turn_and_the_subagent() {
  judge_foreground "$(cleared $T4 false)" "$PEER_LOG" "$AGENT_LOG" "$MAIN_END_LOG"
  assert_exit_code 0
  assert_out_has 'PASS s (5 checks)'
}

test_foreground_agent_is_a_fail_when_the_clear_lands_before_the_main_turn_ended() {
  judge_foreground "$(cleared $T2 false)" "$PEER_LOG" "$T1 [INFO] [Stall] agent_completion agentId=a1" "$MAIN_END_LOG"
  assert_exit_code 1
  assert_out_has 'FAIL  the clear landed after the main turn ended'
  assert_out_lacks 'FAIL  the clear landed after the subagent finished'
}

test_foreground_agent_is_a_fail_when_the_clear_lands_before_the_subagent_finished() {
  judge_foreground "$(cleared $T3 false)" "$PEER_LOG" "$T4 [INFO] [Stall] agent_completion agentId=a1" "$T1 [DEBUG] [engine] turn 2 end"
  assert_exit_code 1
  assert_out_has 'FAIL  the clear landed after the subagent finished'
  assert_out_lacks 'FAIL  the clear landed after the main turn ended'
}

test_foreground_agent_is_a_fail_when_the_subagent_finished_after_the_main_turn_ended() {
  judge_foreground "$(cleared $T4 false)" "$PEER_LOG" "$T1 [DEBUG] [engine] turn 2 end (turns=2)" "$AGENT_LOG"
  assert_exit_code 1
  assert_out_has 'FAIL  the subagent ran in the foreground'
  assert_out_has 'PASS  the clear landed after the main turn ended'
  assert_out_has 'PASS  the clear landed after the subagent finished'
}

test_foreground_agent_is_a_fail_when_the_handoff_never_clears() {
  judge_foreground "$(refused $T4)" "$PEER_LOG" "$AGENT_LOG" "$MAIN_END_LOG"
  assert_exit_code 1
  assert_out_has 'FAIL  the handoff cleared'
  assert_out_has 'FAIL  the clear landed after the main turn ended'
}

# jq prints a missing ts as "null", which sorts after every ISO timestamp.
test_foreground_agent_is_a_fail_when_the_cleared_record_has_no_timestamp() {
  judge_foreground '{"session_id":"s1","action":"cleared","trigger_values":{"point":"command"}}' "$PEER_LOG" "$AGENT_LOG" "$MAIN_END_LOG"
  assert_exit_code 1
  assert_out_has 'FAIL  the clear landed after the main turn ended'
  assert_out_has 'FAIL  the clear landed after the subagent finished'
}

test_foreground_agent_is_a_fail_when_the_log_shows_no_subagent() {
  judge_foreground "$(cleared $T4 false)" "$PEER_LOG" "$MAIN_END_LOG"
  assert_exit_code 1
  assert_out_has 'FAIL  the subagent ran during the wait'
  assert_out_has 'FAIL  the clear landed after the subagent finished'
}

test_foreground_agent_does_not_take_a_subagent_that_finished_before_the_peer_turn() {
  judge_foreground "$(cleared $T4 false)" "$T0 [INFO] [Stall] agent_completion agentId=old" "$T1 [DEBUG] attribution header: cc_turn_origin=peer" "$MAIN_END_LOG"
  assert_exit_code 1
  assert_out_has 'FAIL  the subagent ran during the wait'
}

# --- helpers ---------------------------------------------------------------------------------------------------

test_log_ts_after_reads_the_first_match_after_the_first_anchor() {
  printf '%s\n' "$T0 end" "$T1 anchor" "$T2 end" "$T3 end" > "$TEST_DIR/debug"
  run_live "$SCENARIO"'
    live_init
    cp "'"$TEST_DIR"'/debug" "$(debug_log_of x)"
    echo "AFTER=$(log_ts_after x anchor end)"
    echo "NONE=$(log_ts_after x missing end)"'
  assert_out_has "AFTER=$T2"
  assert_out_has 'NONE='
  assert_out_lacks "NONE=$T0"
}

test_records_of_keeps_only_the_sessions_records_that_match() {
  printf '%s\n' "$(cleared $T1 true s1)" "$(cleared $T2 true s2)" "$(refused $T3 button true s1)" > "$TEST_DIR/decisions"
  run_live "$SCENARIO"'
    live_init
    cp "'"$TEST_DIR"'/decisions" "$LIVE_DECISIONS"
    echo "COUNT=$(session_record_count s1 true)"
    echo "CLEARED=$(session_record_count s1 ".action == \"cleared\"")"
    echo "OTHER=$(session_record_count s3 true)"'
  assert_out_has 'COUNT=2'
  assert_out_has 'CLEARED=1'
  assert_out_has 'OTHER=0'
}

test_records_of_stops_the_run_on_a_session_id_that_is_not_a_uuid() {
  run_live "$SCENARIO"'
    live_init
    records_of "s1\" or true or \"" true'
  assert_exit_code 2
  assert_out_has 'records_of was given a session id that is not a uuid'
}

test_settle_for_returns_after_the_deadline_when_the_condition_never_holds() {
  run_live "$SCENARIO"'
    live_init
    SETTLE_SECONDS=1
    settle_for false
    echo SETTLED
    check ok detail true; live_verdict s'
  assert_exit_code 0
  assert_out_has '(stopped waiting after 1s: false did not hold)'
  assert_out_has 'SETTLED'
}

test_the_scenario_gives_the_foreground_session_the_background_tasks_switch() {
  run_live "$SCENARIO"'
    live_init
    SETTLE_SECONDS=1
    start_waiting_handoff() { echo "ENV=$LIVE_SESSION_ENV ARGS=$*"; }
    foreground_agent_during_the_wait c p
    echo "AFTER=[${LIVE_SESSION_ENV:-}]"'
  assert_out_has 'ENV=CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 ARGS=c p'
  assert_out_has 'AFTER=[]'
}

test_the_scenario_allows_the_agent_tool_in_the_foreground_session() {
  run_live "$SCENARIO"'
    live_init
    SETTLE_SECONDS=1
    start_waiting_handoff() { echo "TOOLS=[${WAITING_HANDOFF_TOOLS:-}]"; }
    foreground_agent_during_the_wait c p
    echo "AFTER=[${WAITING_HANDOFF_TOOLS:-}]"'
  assert_out_has 'TOOLS=[Agent,Bash(sleep *)]'
  assert_out_has 'AFTER=[]'
}

run_tests "$@"
