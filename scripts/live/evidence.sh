#!/usr/bin/env bash
# Reads the screen, the debug log and the decision log for the live harness. Sourced by lib.sh; never run directly.
# Runs on bash 3.2 (macOS), so no associative arrays, mapfile, or ${var,,}.

# --- reading the screen and the logs ---------------------------------------------------------------

pane_has() {
  local screen
  screen=$(pane "$1") || return 1
  text_matches "$2" "$screen"
}
# A pane that cannot be read fails, as in pane_has: it must not read as zero matching lines.
pane_count() {
  local screen
  screen=$(pane "$1") || return 1
  grep -cE -- "$2" <<<"$screen" || true
}
log_has() { grep -qE -- "$2" "$(debug_log_of "$1")" 2>/dev/null; }
# grep -c prints nothing when the file does not exist yet, which would break the arithmetic callers.
log_count() { local count; count=$(grep -cE -- "$2" "$(debug_log_of "$1")" 2>/dev/null) || true; echo "${count:-0}"; }
log_has_more_than() { (($(log_count "$1" "$2") > $3)); }
# The timestamp of the first debug-log line matching an extended regex. The pattern travels in the
# environment because awk -v would eat its backslashes.
log_ts() { LIVE_RE=$2 awk '$0 ~ ENVIRON["LIVE_RE"] { print $1; exit }' "$(debug_log_of "$1")"; }
# ts_before <a> <b>: succeeds when timestamp a is strictly earlier than b. Both must be non-empty ISO
# timestamps of one width. awk compares bytes under LC_ALL=C; the shell's `<` follows the locale.
ts_before() {
  [[ -n "$1" && -n "$2" ]] || return 1
  LC_ALL=C awk -v a="$1" -v b="$2" 'BEGIN { exit !(a < b) }'
}

# A finished turn leaves a "✻ <verb> for <n>s" line behind.
turns_done() { pane_count "$1" '^✻ [^(]+ for ([0-9]+m )?[0-9]+s'; }
turns_done_above() {
  local turns
  turns=$(turns_done "$1") || return 1
  ((turns > $2))
}

# A log that does not exist yet has no records. One that exists and cannot be read as JSON lines is
# not "0 records": `! record_exists cleared` would pass on it. These run in command substitutions and
# cannot stop the harness, so they note the problem and live_raise_noted_error (run by wait_for,
# check and live_verdict) ends the run with an ERROR.
live_note_unreadable_decisions() {
  local reason
  reason=$(head -n 1 -- "$LIVE_RUN/jq-error" 2>/dev/null)
  live_note_error "the decision log $LIVE_DECISIONS could not be read as JSON lines${reason:+ (jq: $reason)}"
}
record_count() {
  [[ -f "$LIVE_DECISIONS" ]] || { echo 0; return 0; }
  jq -s --arg action "$1" '[.[] | select(.action == $action)] | length' "$LIVE_DECISIONS" 2>"$LIVE_RUN/jq-error" \
    || { live_note_unreadable_decisions; echo 0; }
}
records_with() {
  [[ -f "$LIVE_DECISIONS" ]] || return 0
  jq -c --arg action "$1" 'select(.action == $action)' "$LIVE_DECISIONS" 2>"$LIVE_RUN/jq-error" || live_note_unreadable_decisions
  return 0
}
record_exists() { (($(record_count "$1") > ${2:-0})); }

# decision_lines: how many lines the decision log has, 0 before it exists. A scenario that runs several
# handoffs takes it as a baseline and reads the records written after it with records_after.
decision_lines() {
  [[ -f "$LIVE_DECISIONS" ]] || { echo 0; return 0; }
  wc -l <"$LIVE_DECISIONS" | tr -d ' '
}
# records_after <baseline> <jq-condition>: the records written after the baseline line for which the jq
# condition holds, one per line. An unreadable log is noted like in records_with.
records_after() {
  [[ -f "$LIVE_DECISIONS" ]] || return 0
  sed -n "$(($1 + 1)),\$p" "$LIVE_DECISIONS" | jq -c "select($2)" 2>"$LIVE_RUN/jq-error" || live_note_unreadable_decisions
  return 0
}
