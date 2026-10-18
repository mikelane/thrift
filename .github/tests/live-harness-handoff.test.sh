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
  grep -o 'CALL type b\|CALL press a h\|CALL press b Enter\|CALL wait the handoff to wait' "$OUTPUT" | paste -sd, - > "$TEST_DIR/order"
  assert_file_has "$TEST_DIR/order" 'CALL type b,CALL press a h,CALL press b Enter,CALL wait the handoff to wait'
}

test_start_waiting_handoff_allows_the_tools_a_scenario_names_instead_of_the_default() {
  run_live 'source "$LIVE_DIR/handoff/common.sh"
    handoff_start() { echo "CALL start $*"; }; say_apple() { :; }; wait_for() { :; }
    type_text() { :; }; press() { :; }; session_of() { echo s; }
    WAITING_HANDOFF_TOOLS="Agent,Bash(sleep *)" start_waiting_handoff a b "do the task" --session-id x'
  assert_exit_code 0
  assert_out_has 'CALL start a --allowedTools Agent,Bash(sleep *) --session-id x'
  assert_out_lacks 'CALL start a --allowedTools Bash(sleep *) '
}

# run_restore_order <screen> <debug-log-lines>: the scenario with the screen, the debug log and one
# background_busy abandon record fixed, and every engine-facing helper a no-op. The debug log starts
# with the three held-prompt lines the scenario waits for, then the given lines.
run_restore_order() {
  local screen=$1 log_lines=$2
  printf 'held a prompt for the handoff (%s held)\n' 1 2 3 > "$TEST_DIR/debug-a.log"
  printf '%s\n' "$log_lines" >> "$TEST_DIR/debug-a.log"
  printf '%s\n' "$screen" > "$TEST_DIR/box"
  run_live 'source "$LIVE_DIR/handoff/common.sh"; source "$LIVE_DIR/handoff/scenarios/restore-order-after-abandon.sh"
    live_init
    handoff_prepare() { :; }; start_peer_messenger() { :; }; start_waiting_handoff() { :; }
    submit() { echo "submit $2" >> "'"$TEST_DIR"'/calls"; }; type_text() { echo "type $2" >> "'"$TEST_DIR"'/calls"; }
    box_is_empty() { echo clear >> "'"$TEST_DIR"'/calls"; }; box_shows() { :; }
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

test_restore_order_waits_for_the_box_to_clear_after_each_held_prompt_before_typing_on() {
  run_restore_order "$(printf '%s\n%s\n' '──────' "$RESTORED_BOX"; echo '──────')" "$WAIT_ENDED_LOG"
  assert_file_has "$TEST_DIR/calls" 'type draft'
  paste -sd, "$TEST_DIR/calls" > "$TEST_DIR/order"
  assert_file_has "$TEST_DIR/order" 'clear,submit two,clear,submit three,clear,type draft'
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

test_restore_order_is_a_fail_when_the_debug_log_never_shows_the_wait_ending() {
  run_restore_order "$(printf '%s\n%s\n' '──────' "$RESTORED_BOX"; echo '──────')" 'cc_turn_origin=peer'
  assert_exit_code 1
  assert_out_has 'FAIL  the draft was not sent: no person turn started in the old session after the wait'
  assert_out_has 'the debug log never shows the wait ending'
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
# NOTE_IN_RESUMED is set. PHASE is the case's phase, ENDS_AT_TYPING the compaction ends counted when the
# command was typed, and COMPACTION_LOG more lines for the debug log.
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
    printf "%s" "${COMPACTION_LOG:-}" >> "$(debug_log_of c)"
    CASE_PHASE=${PHASE:-}; COMPACTION_ENDS_AT_TYPING=${ENDS_AT_TYPING:-0}
    judge_case c '"$expectation"' '"$ends"'
    live_verdict s'
}

cleared_record() { echo "{\"action\":\"cleared\",\"session_id\":\"${1:-old1}\",\"trigger_values\":{\"cleared_by\":\"${2:-person}\",\"effective_mode\":\"${3:-ask}\"}}"; }
session_ended_record() { echo '{"action":"none","session_id":"old1","trigger_values":{"reason":"session_ended","effective_mode":"ask"}}'; }
failure_record() { echo "{\"action\":\"none\",\"session_id\":\"old1\",\"trigger_values\":{\"reason\":\"$1\",\"effective_mode\":\"ask\"}}"; }

test_clear_resume_passes_one_person_clear_that_names_the_session_and_the_mode() {
  run_judge cleared_by_person 2 "$(cleared_record)"
  assert_exit_code 0
  assert_out_has 'PASS s (7 checks)'
}

test_clear_resume_prints_the_path_a_resume_took_without_judging_it() {
  qa_judge show_ending_path 2 1 none yes "$(session_ended_record)"
  assert_exit_code 0
  assert_out_has 'PASS s (6 checks)'
  assert_out_has 'case: ended with action none, reason session_ended, cleared_by missing'
}

test_clear_resume_is_a_fail_when_two_records_end_the_handoff() {
  run_judge show_ending_path 2 "$(cleared_record old1 handoff)"$'\n'"$(session_ended_record)"
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
  assert_out_has 'FAIL  case: the handoff note reached exactly one transcript'
  assert_out_has 'transcripts holding the note: resumed.jsonl'
  assert_out_lacks "$TEST_DIR/home"
}

COMPACTION_ENDED_LINE=$'Forked agent [reactive-compact] finished: 1 messages\n'

test_clear_resume_passes_a_command_typed_before_the_compaction_finished() {
  PHASE=compaction ENDS_AT_TYPING=0 COMPACTION_LOG=$COMPACTION_ENDED_LINE run_judge cleared_by_person 2 "$(cleared_record)"
  assert_exit_code 0
  assert_out_has 'PASS  case: the command was typed before the compaction finished'
  assert_out_has 'PASS s (8 checks)'
}

test_clear_resume_is_a_fail_when_the_compaction_had_finished_when_the_command_was_typed() {
  PHASE=compaction ENDS_AT_TYPING=1 COMPACTION_LOG=$COMPACTION_ENDED_LINE run_judge cleared_by_person 2 "$(cleared_record)"
  assert_exit_code 1
  assert_out_has 'FAIL  case: the command was typed before the compaction finished'
  assert_out_has 'the compaction had finished 1 time(s) when the command was typed and 1 time(s) by the judgement'
}

# A compaction whose end line never shows (the engine renamed it, or the log cannot be read) proves nothing.
test_clear_resume_is_a_fail_when_the_debug_log_never_shows_the_compaction_finishing() {
  PHASE=compaction ENDS_AT_TYPING=0 run_judge cleared_by_person 2 "$(cleared_record)"
  assert_exit_code 1
  assert_out_has 'FAIL  case: the command was typed before the compaction finished'
  assert_out_has 'the compaction had finished 0 time(s) when the command was typed and 0 time(s) by the judgement'
}

# An end line from an earlier compaction in the same log is not this one's.
test_clear_resume_passes_when_an_earlier_compaction_had_finished_before_the_command() {
  PHASE=compaction ENDS_AT_TYPING=1 COMPACTION_LOG=$COMPACTION_ENDED_LINE$COMPACTION_ENDED_LINE run_judge cleared_by_person 2 "$(cleared_record)"
  assert_exit_code 0
  assert_out_has 'PASS  case: the command was typed before the compaction finished'
}

test_clear_resume_does_not_judge_the_compaction_for_a_command_typed_during_the_wait() {
  PHASE=wait ENDS_AT_TYPING=1 run_judge cleared_by_person 2 "$(cleared_record)"
  assert_exit_code 0
  assert_out_lacks 'compaction finished'
}

# run_case_calls <phase>: run_case for one case "c1" with every engine-facing helper stubbed. The debug log
# starts with four notes and the compaction's start. wait_for prints what it was asked to wait for, and
# submit prints the waits done before it. Every submit stands in for a compaction that ends as its keys land,
# so the ends counted after the typed command are 2, and a count taken before it would be 1.
run_case_calls() {
  run_live 'source "$LIVE_DIR/handoff/common.sh"; source "$LIVE_DIR/handoff/scenarios/clear-resume-during-handoff.sh"
    live_init
    printf "Forked agent [plugin_model_fork] finished\n%.0s" 1 2 3 4 > "$(debug_log_of c1)"
    echo "\$.session.compact (handoff): compacting" >> "$(debug_log_of c1)"
    WAITED=
    handoff_start() { :; }; start_waiting_handoff() { :; }; say_apple() { :; }
    submit() { echo "CALL submit $2 after:$WAITED"; echo "Forked agent [reactive-compact] finished" >> "$(debug_log_of "$1")"; }
    decision_lines() { echo 0; }; settle_until() { :; }; show_case() { :; }
    judge_case() { echo "ENDS AT TYPING $COMPACTION_ENDS_AT_TYPING"; }
    wait_for() { echo "CALL wait $*"; WAITED="$WAITED|$1"; }
    run_case label c1 '"$1"' /clear cleared_by_handoff 2
    check done none true; live_verdict s'
}

test_run_case_waits_for_a_new_note_not_for_any_note_already_in_the_log() {
  run_case_calls compaction
  assert_exit_code 0
  assert_out_has 'CALL wait the note of '"'"'c1'"'"' to be written log_has_more_than c1 Forked agent \[plugin_model_fork\] finished 4'
}

test_run_case_types_the_command_once_the_compaction_has_started() {
  run_case_calls compaction
  assert_out_has 'CALL wait the compaction of '"'"'c1'"'"' to start log_has c1 \$\.session\.compact \(handoff\): compacting'
  assert_out_has 'CALL submit /clear after:|the note of '"'"'c1'"'"' to be written|the compaction of '"'"'c1'"'"' to start'
}

test_run_case_counts_the_compaction_ends_after_the_command_is_typed() {
  run_case_calls compaction
  assert_out_has 'ENDS AT TYPING 2'
}

test_settle_until_returns_after_its_limit_when_the_condition_never_holds() {
  run_live 'source "$LIVE_DIR/handoff/common.sh"; source "$LIVE_DIR/handoff/scenarios/clear-resume-during-handoff.sh"
    SETTLE_SECONDS=1; LIVE_POLL=0.1
    settle_until false
    echo SETTLED'
  assert_exit_code 0
  assert_out_has 'SETTLED'
}

# qa_judge <expectation> <expected-ends> <session.end lines in the debug log> <note file or none>
# <old transcript present: yes|no> <records>
qa_judge() {
  local expectation=$1 ends=$2 end_lines=$3 note_file=$4 old=$5 records=$6
  printf '%s\n' "$records" > "$TEST_DIR/decisions"
  run_live 'source "$LIVE_DIR/handoff/common.sh"; source "$LIVE_DIR/handoff/scenarios/clear-resume-during-handoff.sh"
    CLAUDE_CONFIG_DIR=$HOME/.claude
    live_init
    cp "'"$TEST_DIR"'/decisions" "$LIVE_DECISIONS"
    : > "$(debug_log_of c)"
    for _ in $(seq 1 '"$end_lines"'); do echo "handoff@inline session.end settled in 1ms" >> "$(debug_log_of c)"; done
    mkdir -p "$CLAUDE_CONFIG_DIR/projects/p"
    [[ "'"$old"'" == no ]] || echo x > "$CLAUDE_CONFIG_DIR/projects/p/old1.jsonl"
    [[ "'"$note_file"'" == none ]] || echo "Handoff from the previous session (old1), written by Claude" >> "$CLAUDE_CONFIG_DIR/projects/p/'"$note_file"'.jsonl"
    RESUME_TARGET_ID=resumed
    CASE_LABEL=case; CASE_ID=old1; CASE_BASE=0
    judge_case c '"$expectation"' '"$ends"'
    live_verdict s'
}

test_a_session_ended_abandon_with_the_note_in_a_fresh_transcript_is_a_fail() {
  qa_judge show_ending_path 2 1 fresh yes "$(session_ended_record)"
  assert_exit_code 1
  assert_out_has 'FAIL  case: the handoff note'
}

test_a_session_ended_abandon_with_the_note_in_the_resumed_transcript_is_a_fail() {
  qa_judge show_ending_path 2 1 resumed yes "$(session_ended_record)"
  assert_exit_code 1
  assert_out_has 'transcripts holding the note: resumed.jsonl'
}

test_a_session_ended_abandon_without_the_old_transcript_is_a_fail_that_says_so() {
  qa_judge show_ending_path 2 1 none no "$(session_ended_record)"
  assert_exit_code 1
  assert_out_has 'the transcript of the old session old1 was not found under ~/.claude/projects'
}

# The old session's own transcript is not a delivery: a note only in it never reached a fresh session.
test_a_note_that_reached_only_the_old_sessions_transcript_is_a_fail() {
  qa_judge cleared_by_person 2 2 old1 yes "$(cleared_record)"
  assert_exit_code 1
  assert_out_has 'FAIL  case: the handoff note reached exactly one transcript'
}

test_the_note_check_says_none_when_no_transcript_holds_the_note() {
  qa_judge cleared_by_person 2 2 none yes "$(cleared_record)"
  assert_exit_code 1
  assert_out_has 'transcripts holding the note: none'
}

run_tests "$@"
