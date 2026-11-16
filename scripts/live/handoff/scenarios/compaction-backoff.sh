#!/usr/bin/env bash
# #141: after a weak-signal compaction, the backoff must hold from the first context the plugin
# measures afterwards, not from the `tokensAfter` the compaction reports. `tokensAfter` has read well
# below the next turn's real context, so a backoff anchored on it released at once and the plugin
# compacted again minutes later.
#
# Run: act mode with a threshold just above a tiny session's context, so the first turn's end is a weak
# signal and compacts. Then one more turn whose context is above the threshold and less than 50,000
# tokens past the measured floor. Its record must be `none` with reason `backoff`, not a second
# `compacted`.
#
# The plugin copy gets one debug line, so the run can print the `tokensAfter` the compaction reported
# next to the floor the plugin measured. The repo is not touched.

THRESHOLD=10000

scenario_run() {
  handoff_prepare "{\"handoffMode\": \"act\", \"handoffContextTokens\": $THRESHOLD}"
  log_tokens_after_in_copy
  handoff_start a
  say_apple a
  wait_for 'the weak signal to compact the session' record_exists compacted
  wait_for 'the compaction to report its size' log_has a 'live: size after compaction is '

  local records_before_second_turn turns_before
  records_before_second_turn=$(decision_lines)
  turns_before=$(turns_done a)
  submit a 'say the word pear'
  wait_for 'the second turn to finish' turns_done_above a "$turns_before"
  wait_for 'a record for the second turn' record_written_after "$records_before_second_turn"

  local tokens_after floor
  tokens_after=$(log_line a 'live: size after compaction is ' | sed -E 's/.*live: size after compaction is ([^ ]+) tokens.*/\1/')
  floor=$(records_after "$records_before_second_turn" 'true' | jq -r '.trigger_values.context_tokens' | head -n 1)

  show_records compacted
  show_records none
  show_log a 'live: size after compaction is |compaction'
  show_pane a 'end of the run'
  section 'the compaction size against the measured floor'
  printf 'tokensAfter reported by the compaction: %s\nfloor (context measured on the next turn):  %s\nthreshold: %s, backoff releases at: floor + 50000\n' \
    "$tokens_after" "$floor" "$THRESHOLD"

  check 'the next turn is backed off, with reason backoff' \
    "the first record after the compaction was: $(records_after "$records_before_second_turn" 'true' | head -n 1)" \
    first_record_after_is_backoff "$records_before_second_turn"
  check 'the plugin compacted once, not twice' "compacted records: $(record_count compacted)" compacted_once
}

# Adds a debug line after the compaction returns, to the copy in the run directory only.
log_tokens_after_in_copy() {
  local file="$LIVE_RUN/plugin/hooks/compaction.tsx" anchor='const compaction = await $.session.compact()'
  grep -qF -- "$anchor" "$file" || live_abort "no line '$anchor' in ${file#"$LIVE_RUN"/}; the plugin changed, update compaction-backoff.sh"
  awk -v anchor="$anchor" '{ print } index($0, anchor) { print "    debug($, `live: size after compaction is ${String(compaction.tokensAfter)} tokens`)" }' "$file" >"$file.new"
  mv -- "$file.new" "$file"
}

# log_line <name> <regex>: the first matching debug log line.
log_line() { grep -E -- "$2" "$(debug_log_of "$1")" 2>/dev/null | head -n 1 || true; }

record_written_after() { (($(decision_lines) > $1)); }

first_record_after_is_backoff() {
  records_after "$1" 'true' | head -n 1 | jq -e '.action == "none" and .trigger_values.reason == "backoff"' >/dev/null
}

compacted_once() { (($(record_count compacted) == 1)); }
