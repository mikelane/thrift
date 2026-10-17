#!/usr/bin/env bash
# scripts/live: reading the evidence (pane, prompt box, debug log, decision log) and the scenarios that
# judge it, against a stub `tmux` and `claude`. No real session starts.
# Usage: live-harness-evidence.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=live-harness-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/live-harness-lib.sh"

test_log_count_is_zero_before_the_debug_log_exists() {
  run_live 'live_init; echo "COUNT=$(log_count a x)"; check ok detail true; live_verdict s'
  assert_exit_code 0
  assert_out_has 'COUNT=0'
}

test_ts_before_orders_timestamps_and_refuses_empty_ones() {
  run_live 'live_init
    check earlier detail ts_before 2026-10-14T05:00:00.100Z 2026-10-14T05:00:00.900Z
    check later detail eval "! ts_before 2026-10-14T05:00:00.900Z 2026-10-14T05:00:00.100Z"
    check equal detail eval "! ts_before 2026-10-14T05:00:00.100Z 2026-10-14T05:00:00.100Z"
    check "empty first" detail eval "! ts_before \"\" 2026-10-14T05:00:00.100Z"
    check "empty second" detail eval "! ts_before 2026-10-14T05:00:00.100Z \"\""
    live_verdict s'
  assert_exit_code 0
}

test_busy_abandon_waits_for_the_reason_not_for_any_none_record() {
  local scenario=$LIVE_DIR/handoff/scenarios/busy-abandon.sh
  assert_file_lacks "$scenario" 'record_exists none'
  run_live 'source "$LIVE_DIR/handoff/scenarios/busy-abandon.sh"
    live_init
    printf "%s\n" "{\"action\":\"none\",\"trigger_values\":{\"point\":\"turn-end\"}}" > "$LIVE_DECISIONS"
    check "no reason yet" detail eval "! record_has_reason background_busy"
    printf "%s\n" "{\"action\":\"none\",\"trigger_values\":{\"reason\":\"background_busy\"}}" >> "$LIVE_DECISIONS"
    check "the reason" detail record_has_reason background_busy
    live_verdict s'
  assert_exit_code 0
}

test_busy_abandon_is_a_fail_when_the_old_transcript_has_no_compaction() {
  run_live 'source "$LIVE_DIR/handoff/common.sh"; source "$LIVE_DIR/handoff/scenarios/busy-abandon.sh"
    set -uo pipefail
    CLAUDE_CONFIG_DIR=$HOME/.claude
    live_init
    mkdir -p "$CLAUDE_CONFIG_DIR/projects/p"
    echo "{\"type\":\"user\"}" > "$CLAUDE_CONFIG_DIR/projects/p/old.jsonl"
    transcript_summary old
    check "compacted" "no marker" transcript_is_compacted old
    live_verdict s'
  assert_exit_code 1
  assert_out_has 'FAIL  compacted'
}

# Every engine-facing helper is a no-op, so only the scenario's own control flow runs: the plugin
# cleared instead of abandoning, which is the misbehavior the scenario's checks exist to report.
test_busy_abandon_is_a_fail_when_the_handoff_clears_instead_of_stopping() {
  run_live 'source "$LIVE_DIR/handoff/common.sh"; source "$LIVE_DIR/handoff/scenarios/busy-abandon.sh"
    live_init
    handoff_prepare() { :; }; handoff_start() { :; }; live_start() { :; }; say_apple() { :; }
    submit() { :; }; type_text() { :; }; press() { :; }; pane_has() { :; }; log_has() { :; }
    turns_done_above() { :; }; show_pane() { :; }; show_box() { :; }; show_log() { :; }; box_text() { :; }
    printf "%s\n" "{\"action\":\"cleared\",\"session_id\":\"old\",\"trigger_values\":{}}" > "$LIVE_DECISIONS"
    LIVE_TIMEOUT=1
    scenario_run
    check ok detail true; live_verdict s'
  assert_exit_code 1
  assert_out_has 'FAIL  the handoff did not clear'
}

# run_delivery_window <debug-log-lines...>: the delivery-window scenario against a fixture debug log, with
# every engine-facing helper a no-op, so only the scenario's own waits and checks read the evidence.
run_delivery_window() {
  local fixture=$TEST_DIR/delivery-window.log
  printf '%s\n' "$@" > "$fixture"
  run_live 'source "$LIVE_DIR/handoff/common.sh"; source "$LIVE_DIR/handoff/scenarios/delivery-window-prompts.sh"
    live_init
    handoff_prepare() { :; }; handoff_start() { :; }; say_apple() { :; }; submit() { :; }; type_text() { :; }
    press() { :; }; press_two_prompts() { :; }; pane_has() { :; }; turns_done_above() { :; }
    show_pane() { :; }; show_box() { :; }; show_log() { :; }; box_text() { :; }
    cp "'"$fixture"'" "$(debug_log_of a)"
    printf "%s\n" "{\"action\":\"cleared\",\"trigger_values\":{}}" > "$LIVE_DECISIONS"
    LIVE_TIMEOUT=1
    scenario_run
    live_verdict s'
}

# The plugin submits "five" and then "fivesix": the second late prompt was held with the first one's
# text in front of it (#63). That is the misbehavior the scenario exists to report, so it is a FAIL.
test_delivery_window_is_a_fail_when_the_second_prompt_is_held_joined() {
  run_delivery_window '$.command.run (handoff): 6 chars queued' \
    'handoff: held a prompt for the handoff (1 held)' '$.prompt.submit (handoff): "one"' \
    'handoff: held a prompt for the handoff (2 held)' '$.prompt.submit (handoff): "five"' \
    '$.prompt.submit (handoff): "fivesix"'
  assert_exit_code 1
  assert_out_has 'FAIL  the second prompt was held as typed, not joined to the first'
}

test_delivery_window_is_an_error_when_the_second_prompt_misses_the_sending_stage() {
  run_delivery_window '$.command.run (handoff): 6 chars queued' \
    'handoff: held a prompt for the handoff (1 held)' '$.prompt.submit (handoff): "one"' \
    '$.prompt.submit (handoff): "five"'
  assert_exit_code 2
  assert_out_has 'the timing window was missed'
}

test_delivery_window_passes_when_each_prompt_is_held_as_typed() {
  run_delivery_window '$.command.run (handoff): 6 chars queued' \
    'handoff: held a prompt for the handoff (1 held)' '$.prompt.submit (handoff): "one"' \
    'handoff: held a prompt for the handoff (2 held)' '$.prompt.submit (handoff): "five"' \
    '$.prompt.submit (handoff): "six"'
  assert_exit_code 0
  assert_out_has 'PASS s (3 checks)'
}

test_box_is_empty_fails_when_the_screen_shows_no_prompt_box() {
  run_live 'source "$LIVE_DIR/handoff/scenarios/held-prompt-box.sh"
    live_init
    pane() { printf "%s\n" "Do you want to proceed?" "> 1. Yes" "  2. No"; }
    check "box empty" "no box" box_is_empty a
    live_verdict s'
  assert_exit_code 1
  assert_out_has 'FAIL  box empty'
}

test_box_text_prints_the_box_between_the_last_two_rules_without_the_glyph() {
  run_live 'live_init
    pane() { printf "%s\n" "──────" "❯ old" "──────" "output" "──────" "❯ hello there" "──────" "footer"; }
    echo "BOX=[$(box_text a)]"
    check ok detail true; live_verdict s'
  assert_exit_code 0
  assert_out_has 'BOX=[hello there]'
}

test_record_count_is_zero_before_the_decision_log_exists() {
  run_live 'live_init; echo "COUNT=$(record_count none)"; check "no record" detail eval "! record_exists none"; live_verdict s'
  assert_exit_code 0
  assert_out_has 'COUNT=0'
}

# `-t name` falls back to a prefix or window-name match when the session is gone, so every target is
# exact. A pane target needs the trailing colon: tmux 3.8 answers "can't find pane: =name" without it.
test_the_pane_is_captured_from_the_exact_session() {
  run_live 'live_init; pane a || true'
  assert_tmux_called 'capture-pane -p -J -t =live-'
  assert_file_matches "$TMUX_LOG" '-t =live-[^ :]*-a:$'
}

test_keys_are_sent_to_the_exact_session() {
  run_live 'live_init; press a Enter || true'
  assert_file_matches "$TMUX_LOG" '^send-keys -t =live-[^ :]*-a: Enter$'
}

test_typed_text_goes_to_the_exact_session() {
  run_live 'live_init; LIVE_TIMEOUT=1; type_text a hello || true'
  assert_file_matches "$TMUX_LOG" '^send-keys -t =live-[^ :]*-a: -l -- hello$'
}

test_no_tmux_target_in_the_harness_is_a_bare_session_name() {
  ! grep -rnE -- '-t "?\$\(session_of' "$LIVE_DIR" || fail 'a tmux target is built without the exact-match prefix'
}

# A capture bigger than the pipe buffer used to make `pane | grep -q` die of SIGPIPE inside the pane
# function, and pipefail then read a real match as "no match".
test_pane_has_finds_a_match_in_a_capture_larger_than_the_pipe_buffer() {
  run_live 'live_init
    pane() { echo needle; head -c 400000 /dev/zero | tr "\\0" x; echo; }
    pane_has a needle
    check x detail true; live_verdict s'
  assert_exit_code 0
}

test_pane_has_is_false_when_the_pane_cannot_be_read() {
  run_live 'live_init; pane() { echo anything; return 1; }
    check "pane_has is false" detail eval "! pane_has a anything"
    live_verdict s'
  assert_exit_code 0
}

test_box_shows_finds_the_typed_text_in_a_large_box() {
  run_live 'live_init
    box_text() { echo "hello there"; head -c 400000 /dev/zero | tr "\\0" x; echo; }
    box_shows a "hello there"
    check x detail true; live_verdict s'
  assert_exit_code 0
}

# The failed read still printed the text, so only the failure itself can make box_shows false.
test_box_shows_is_false_when_the_box_cannot_be_read() {
  run_live 'live_init; box_text() { echo anything; return 1; }
    check "box_shows is false" detail eval "! box_shows a anything"
    live_verdict s'
  assert_exit_code 0
}

# Decision-log helpers run in command substitutions, where they cannot stop the harness themselves.
# They note the problem in the run directory, and the next wait, check or verdict raises it.
test_a_malformed_decision_log_is_an_error_not_zero_records() {
  run_live 'live_init; printf "%s\n" "{not json" > "$LIVE_DECISIONS"
    check "no cleared record" detail eval "[[ \"\$(record_count cleared)\" == 0 ]]"
    live_verdict s'
  assert_exit_code 2
  assert_out_has 'decision log'
  assert_out_has 'could not be read'
  assert_out_lacks 'PASS s'
}

# chmod 000 does not stop root, so under root this test reads the log and fails.
test_an_unreadable_decision_log_is_an_error_not_zero_records() {
  run_live 'live_init; echo "{}" > "$LIVE_DECISIONS"; chmod 000 "$LIVE_DECISIONS"
    check "no cleared record" detail eval "! record_exists cleared"
    live_verdict s'
  chmod -R u+rw "$TEST_DIR/tmp"
  assert_exit_code 2
  assert_out_has 'could not be read'
  assert_out_lacks 'PASS s'
}

test_a_wait_on_a_record_ends_at_once_when_the_decision_log_is_malformed() {
  run_live 'live_init; LIVE_TIMEOUT=60; printf "%s\n" "{not json" > "$LIVE_DECISIONS"
    wait_for "a cleared record" record_exists cleared'
  assert_exit_code 2
  assert_out_has 'could not be read'
  assert_out_lacks 'timed out'
}

# No check runs after the note, so the verdict is the one that raises it.
test_records_with_notes_a_malformed_decision_log_and_the_verdict_raises_it() {
  run_live 'live_init; printf "%s\n" "{not json" > "$LIVE_DECISIONS"
    records_with cleared >/dev/null
    live_verdict s'
  assert_exit_code 2
  assert_out_has 'could not be read'
  assert_out_lacks 'ran no checks'
}

# The note is raised before the condition is tried, so a condition that holds cannot hide it.
test_a_wait_whose_condition_holds_is_an_error_for_a_problem_noted_before_it() {
  run_live 'live_init; printf "%s\n" "{not json" > "$LIVE_DECISIONS"
    records_with cleared >/dev/null
    wait_for "a thing that already holds" true
    echo "the wait returned"
    check x detail true; live_verdict s'
  assert_exit_code 2
  assert_out_has 'could not be read'
  assert_out_lacks 'the wait returned'
  assert_out_lacks 'PASS s'
}

test_a_well_formed_decision_log_is_counted() {
  run_live 'live_init; printf "%s\n" "{\"action\":\"cleared\"}" "{\"action\":\"none\"}" > "$LIVE_DECISIONS"
    echo "COUNT=$(record_count cleared)"
    check x detail record_exists cleared
    live_verdict s'
  assert_exit_code 0
  assert_out_has 'COUNT=1'
}

run_tests "$@"
