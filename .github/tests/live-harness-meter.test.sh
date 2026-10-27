#!/usr/bin/env bash
# scripts/live/meter: the screen judgments in common.sh, against the stub `tmux`, which fails every
# call, so `pane` cannot read the screen (as for a session that died). No real session starts.
# Usage: live-harness-meter.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=live-harness-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/live-harness-lib.sh"

# run_meter <bash-snippet>: the snippet runs with lib.sh and meter/common.sh sourced.
run_meter() { run_live 'source "$LIVE_DIR/meter/common.sh"; '"$1"; }

# A judgment's own return status, printed as STATUS=<n>. The call sits on the left of `||`, so errexit
# cannot end the snippet first: the status is the function's, not that of a failed command inside it.
status_of() { printf 'status=0; %s || status=$?; echo "STATUS=$status"' "$1"; }
assert_status() { assert_file_matches "$OUTPUT" "^STATUS=$1\$"; }

# A screen that cannot be read is not a closed pane: the toggle check "the CONTEXT row is gone" would
# otherwise pass for a session that died after its reply.
test_meter_pane_is_closed_fails_when_the_pane_cannot_be_read() {
  run_meter "$(status_of 'meter_pane_is_closed a')"
  assert_status 1
}

test_meter_frame_is_gone_fails_when_the_pane_cannot_be_read() {
  run_meter "$(status_of 'meter_frame_is_gone a')"
  assert_status 1
  assert_out_lacks 'command not found'
}

# A screen that cannot be read is not a still screen: placement and clear judge "not placed" and "stayed"
# from a still screen.
test_meter_screen_is_still_fails_when_the_pane_cannot_be_read() {
  run_meter 'LIVE_RUN=$TMPDIR; meter_screen_is_still a 1 || true
    '"$(status_of 'meter_screen_is_still a 1')"
  assert_status 1
}

test_meter_pane_is_closed_succeeds_on_a_screen_without_the_context_row() {
  run_meter 'pane() { printf "%s\n" "❯ say the word apple" "apple"; }
    '"$(status_of 'meter_pane_is_closed a')"
  assert_status 0
}

test_meter_pane_is_closed_fails_on_a_screen_with_the_context_row() {
  run_meter 'pane() { printf "%s\n" "CONTEXT  41k / 1M"; }
    '"$(status_of 'meter_pane_is_closed a')"
  assert_status 1
}

test_meter_frame_is_gone_succeeds_on_a_screen_without_a_frame() {
  run_meter 'pane() { printf "%s\n" "❯ /meter" "Meter closed."; }
    '"$(status_of 'meter_frame_is_gone a')"
  assert_status 0
}

test_meter_frame_is_gone_fails_on_a_screen_with_a_docked_frame() {
  run_meter 'pane() { printf "%s\n" "transcript   │   ✕"; }
    '"$(status_of 'meter_frame_is_gone a')"
  assert_status 1
}

test_meter_frame_is_gone_fails_on_a_screen_with_an_inline_frame() {
  run_meter 'pane() { printf "%s\n" "╭────────────✕─╮"; }
    '"$(status_of 'meter_frame_is_gone a')"
  assert_status 1
}

test_meter_screen_is_still_succeeds_once_a_readable_screen_repeats() {
  run_meter 'LIVE_RUN=$TMPDIR; pane() { printf "%s\n" "same screen"; }
    meter_screen_is_still a 1 || true
    '"$(status_of 'meter_screen_is_still a 1')"
  assert_status 0
}

test_meter_screen_is_still_fails_on_the_first_read_of_a_screen() {
  run_meter 'LIVE_RUN=$TMPDIR; pane() { printf "%s\n" "same screen"; }
    '"$(status_of 'meter_screen_is_still a 1')"
  assert_status 1
}

test_meter_pane_is_open_succeeds_on_a_context_row_waiting_for_a_response() {
  run_meter 'pane() { printf "%s\n" "CONTEXT  waiting for first response"; }
    '"$(status_of 'meter_pane_is_open a')"
  assert_status 0
}

test_meter_pane_is_open_succeeds_on_a_context_row_with_decimal_figures() {
  run_meter 'pane() { printf "%s\n" "CONTEXT  1.2M / 2M"; }
    '"$(status_of 'meter_pane_is_open a')"
  assert_status 0
}

test_meter_pane_is_open_fails_on_the_command_that_opens_it() {
  run_meter 'pane() { printf "%s\n" "❯ /meter" "Meter opened."; }
    '"$(status_of 'meter_pane_is_open a')"
  assert_status 1
}

test_meter_inline_frame_is_drawn_succeeds_on_a_top_border_with_the_close_button() {
  run_meter 'pane() { printf "%s\n" "╭────────────✕─╮"; }
    '"$(status_of 'meter_inline_frame_is_drawn a')"
  assert_status 0
}

test_meter_age_seconds_returns_the_seconds_of_the_top_context_label() {
  run_meter 'pane() { printf "%s\n" "TOP CONTEXT · 37s ago"; }
    echo "AGE=$(meter_age_seconds a)."'
  assert_out_has 'AGE=37.'
}

test_meter_age_seconds_returns_nothing_without_a_top_context_header() {
  run_meter 'pane() { printf "%s\n" "CONTEXT  41k / 1M"; }
    echo "AGE=$(meter_age_seconds a)."'
  assert_out_has 'AGE=.'
}

test_meter_age_is_at_least_fails_without_an_age_label() {
  run_meter 'pane() { printf "%s\n" "CONTEXT  41k / 1M"; }
    '"$(status_of 'meter_age_is_at_least a 1')"
  assert_status 1
}

test_meter_age_is_at_least_fails_on_an_age_below_the_bound() {
  run_meter 'pane() { printf "%s\n" "TOP CONTEXT · 0s ago"; }
    '"$(status_of 'meter_age_is_at_least a 1')"
  assert_status 1
}

test_meter_age_is_at_least_succeeds_on_an_age_equal_to_the_bound() {
  run_meter 'pane() { printf "%s\n" "TOP CONTEXT · 1s ago"; }
    '"$(status_of 'meter_age_is_at_least a 1')"
  assert_status 0
}

test_meter_age_is_zero_succeeds_on_a_label_of_0s() {
  run_meter 'pane() { printf "%s\n" "TOP CONTEXT · 0s ago"; }
    '"$(status_of 'meter_age_is_zero a')"
  assert_status 0
}

test_meter_age_is_zero_fails_on_a_label_of_10s() {
  run_meter 'pane() { printf "%s\n" "TOP CONTEXT · 10s ago"; }
    '"$(status_of 'meter_age_is_zero a')"
  assert_status 1
}

test_meter_cost_returns_the_dollars_of_the_cost_row() {
  run_meter 'pane() { printf "%s\n" "COST  \$0.12 at API rates"; }
    echo "COST=$(meter_cost a)."'
  assert_out_has 'COST=0.12.'
}

test_meter_cost_is_above_zero_fails_on_a_cost_of_zero() {
  run_meter 'pane() { printf "%s\n" "COST  \$0.00 at API rates"; }
    '"$(status_of 'meter_cost_is_above_zero a')"
  assert_status 1
}

test_meter_cost_is_above_zero_fails_without_a_cost_row() {
  run_meter 'pane() { printf "%s\n" "CONTEXT  41k / 1M"; }
    '"$(status_of 'meter_cost_is_above_zero a')"
  assert_status 1
}

test_meter_cost_is_above_zero_succeeds_on_a_cost_of_one_cent() {
  run_meter 'pane() { printf "%s\n" "COST  \$0.01 at API rates"; }
    '"$(status_of 'meter_cost_is_above_zero a')"
  assert_status 0
}

test_pane_count_above_fails_when_the_pane_cannot_be_read() {
  run_meter "$(status_of 'pane_count_above a apple -1')"
  assert_status 1
}

test_pane_count_above_succeeds_on_more_matches_than_the_bound() {
  run_meter 'pane() { printf "%s\n" "Meter opened." "Meter opened."; }
    '"$(status_of 'pane_count_above a "Meter opened" 1')"
  assert_status 0
}

test_pane_count_above_fails_on_as_many_matches_as_the_bound() {
  run_meter 'pane() { printf "%s\n" "Meter opened."; }
    '"$(status_of 'pane_count_above a "Meter opened" 1')"
  assert_status 1
}

test_meter_was_asked_succeeds_when_the_config_lists_the_meter_pane() {
  run_meter 'echo "{\"pluginPanes\":{\"asked\":[{\"plugin\":\"meter\",\"id\":\"meter\"}]}}" >"$HOME/.claude.json"
    '"$(status_of 'meter_was_asked')"
  assert_status 0
}

test_meter_was_asked_fails_when_the_config_lists_only_another_plugins_pane() {
  run_meter 'echo "{\"pluginPanes\":{\"asked\":[{\"plugin\":\"other\",\"id\":\"meter\"}]}}" >"$HOME/.claude.json"
    '"$(status_of 'meter_was_asked')"
  assert_status 1
}

test_meter_was_asked_fails_when_there_is_no_config_file() {
  run_meter "$(status_of 'meter_was_asked')"
  assert_status 1
}

# A config file that is not JSON is an error noted for the run, not a plain "not asked".
test_meter_was_asked_notes_an_error_when_the_config_file_is_not_json() {
  run_meter 'LIVE_RUN=$TMPDIR; echo "{not json" >"$HOME/.claude.json"
    '"$(status_of 'meter_was_asked')"'
    cat "$LIVE_RUN/harness-error"'
  assert_file_matches "$OUTPUT" '^STATUS=[2-9]'
  assert_out_has 'could not be read as JSON'
}

test_meter_asked_panes_returns_an_empty_list_when_there_is_no_config_file() {
  run_meter 'echo "ASKED=$(meter_asked_panes)."'
  assert_out_has 'ASKED=[].'
}

test_meter_asked_panes_returns_the_asked_list_of_the_config_file() {
  run_meter 'echo "{\"pluginPanes\":{\"asked\":[{\"plugin\":\"meter\",\"id\":\"meter\"}]}}" >"$HOME/.claude.json"
    echo "ASKED=$(meter_asked_panes)."'
  assert_out_has 'ASKED=[{"plugin":"meter","id":"meter"}].'
}

test_meter_asked_panes_notes_an_error_when_the_config_file_is_not_json() {
  run_meter 'LIVE_RUN=$TMPDIR; echo "{not json" >"$HOME/.claude.json"
    echo "ASKED=$(meter_asked_panes)."
    cat "$LIVE_RUN/harness-error"'
  assert_out_has 'ASKED=(unreadable).'
  assert_out_has 'could not be read as JSON'
}

# An empty config file is not JSON either: meter_was_asked notes it (jq -e exits 4), so the asked list
# printed beside it must not come back blank with nothing noted.
test_meter_asked_panes_notes_an_error_when_the_config_file_is_empty() {
  run_meter 'LIVE_RUN=$TMPDIR; : >"$HOME/.claude.json"
    echo "ASKED=$(meter_asked_panes)."
    cat "$LIVE_RUN/harness-error" || true'
  assert_out_has 'ASKED=(unreadable).'
  assert_out_has 'could not be read as JSON'
}

test_meter_pane_lacks_fails_when_the_pane_cannot_be_read() {
  run_meter "$(status_of 'meter_pane_lacks a "TOP CONTEXT"')"
  assert_status 1
}

test_meter_pane_lacks_succeeds_on_a_screen_without_a_match() {
  run_meter 'pane() { printf "%s\n" "CONTEXT  41k / 1M"; }
    '"$(status_of 'meter_pane_lacks a "TOP CONTEXT"')"
  assert_status 0
}

test_meter_pane_lacks_fails_on_a_screen_with_a_match() {
  run_meter 'pane() { printf "%s\n" "TOP CONTEXT · 3s ago"; }
    '"$(status_of 'meter_pane_lacks a "TOP CONTEXT"')"
  assert_status 1
}

run_tests "$@"
