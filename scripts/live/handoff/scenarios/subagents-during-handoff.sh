#!/usr/bin/env bash
# #94 (C13.1, C13.2 and C13.4 of #43; the plugin change is #59 / PR #76): subagents and a handoff. Three
# sessions, each with the Agent tool allowed, so each runs a real subagent:
#
# 1. A background Agent is running when `/handoff` is typed (C13.1). The agent outlasts the note and the
#    clear. The fresh session's first message must carry the turn-after-note line, and the agent's task
#    notification must reach the fresh session (a notification turn begins there).
# 2. The band's hand-off button is pressed while a subagent runs and no shell does (C13.2). The press is
#    refused as busy: a `none` record with reason background_busy, nothing cleared. A subagent does not
#    keep the turn running, so the refusal comes the moment the main turn ends.
#    The press cannot land while only the subagent runs: the band offers hand-off only when idle, and at
#    turn end it is redrawn without the button once the subagent is listed (seen on 2.1.302). So the
#    press is made while the turn that starts the agent runs; the engine keeps it until the turn ends
#    ("This turn is still running, so your choice will run when it ends"), and the plugin then reads the
#    busyness. The refusal must follow the turn's end, and the band must then offer no hand-off.
# 3. A foreground Agent (the session runs with background tasks disabled) runs during a handoff's wait for
#    a turn (C13.4). The handoff must not clear while the main turn runs, and must clear after it ends (no
#    stall on the subagent's own turn).
#
# Not driven: C13.3 (a named teammate). It needs the experimental agent-teams feature, which a harness
# session does not turn on.
#
# The agents run `sleep` calls in the foreground, one after another, so each stays "running" for its
# whole length without a shell that the plugin would count: the plugin tracks only the main thread's
# shells (tool-call-tracking.ts), so the busyness here comes from `$.agent.list()` alone.

SUBAGENT_TOOLS='Agent,Bash(sleep *)'
SLEEP_CALLS_STEP_1='six'
SLEEP_CALLS_STEP_2='four'
SLEEP_CALLS_STEP_3='three'
AGENT_PROMPT_BEGIN='Run `sleep 9` with the Bash tool, one call after another,'
AGENT_PROMPT_END='in all, then reply with the word finished.'
# The first words of the line the plugin adds to a note when a turn ran after it (turnAfterNoteLine).
TURN_AFTER_NOTE='A turn ran in the previous session while or after this note was written'
TASK_NOTIFICATION='<task-notification>'
NOTIFICATION_TURN='cc_turn_origin=task_notification'
REFUSED_BUSY='.action == "none" and .trigger_values.reason == "background_busy"'
ENDS_THE_WAIT='.action == "cleared" or (.action == "none" and .trigger_values.reason == "background_busy")'
# Waits for the fresh session after a clear, and for the agent's notification. Not a wait_for: a plugin
# that loses the notification is a FAIL, not a timeout.
SETTLE_SECONDS=100

STEP_1_ID=''
STEP_2_ID=''
STEP_3_ID=''

scenario_run() {
  handoff_prepare '{"handoffContextTokens": 20000}'
  start_peer_messenger p
  STEP_1_ID=$(new_session_id)
  STEP_2_ID=$(new_session_id)
  STEP_3_ID=$(new_session_id)
  background_agent_at_handoff a
  press_while_a_subagent_runs b
  foreground_agent_during_the_wait c p
}

new_session_id() { uuidgen | tr '[:upper:]' '[:lower:]'; }

# settle_for <command...>: polls the command for at most SETTLE_SECONDS and returns either way.
settle_for() {
  local deadline=$((SECONDS + SETTLE_SECONDS))
  until "$@"; do
    ((SECONDS < deadline)) || return 0
    sleep "$LIVE_POLL"
  done
}

# agent_prompt <how many sleeps>: what the subagent is told to do.
agent_prompt() { echo "$AGENT_PROMPT_BEGIN $1 times $AGENT_PROMPT_END"; }

# records_of <session id> <jq condition>: the session's records for which the condition holds.
records_of() { records_after 0 ".session_id == \"$1\" and ($2)"; }
session_has_record() { [[ -n "$(records_of "$1" "$2")" ]]; }
session_record_count() { records_of "$1" "$2" | grep -c . || true; }

# --- 1. a background agent runs when /handoff is typed -----------------------------------------------------

background_agent_at_handoff() {
  local name=$1
  handoff_start "$name" --allowedTools "$SUBAGENT_TOOLS" --session-id "$STEP_1_ID"
  say_apple "$name"
  submit "$name" "Use the Agent tool with run_in_background true and this prompt: $(agent_prompt "$SLEEP_CALLS_STEP_1") After the Agent call returns, reply with the word launched."
  wait_for "the turn to end with the agent running" session_has_record "$STEP_1_ID" '.trigger_values.point == "turn-end" and .trigger_values.is_background_busy == true'
  submit "$name" '/handoff'
  wait_for "the handoff to clear or stop" session_has_record "$STEP_1_ID" "$ENDS_THE_WAIT"
  settle_for fresh_session_has_text "$STEP_1_ID" "$TASK_NOTIFICATION"
  show_records_of "$STEP_1_ID" 'step 1: records of the session that handed off'
  show_log "$name" 'agent_completion|cc_turn_origin|session\.end settled|\[engine\] turn [0-9]+ (start|end)' 14
  section "step 1: the fresh session's transcript, lines naming the note and the notification"
  fresh_transcript_evidence "$STEP_1_ID"
  judge_background_agent "$name" "$STEP_1_ID"
}

fresh_transcript_of() { fresh_transcript_path "$1"; }
fresh_session_has_text() {
  local fresh
  fresh=$(fresh_transcript_of "$1")
  [[ -n "$fresh" ]] && grep -qF -- "$2" "$fresh"
}
fresh_transcript_evidence() {
  local fresh
  fresh=$(fresh_transcript_of "$1")
  if [[ -z "$fresh" ]]; then
    echo "no transcript of a fresh session holds the note of $1 under $(transcripts_dir | sed "s|$HOME|~|")"
    return 0
  fi
  printf '%s\n' "${fresh##*/}"
  grep -oF -e "$TURN_AFTER_NOTE" -e "$TASK_NOTIFICATION" "$fresh" | sort | uniq -c || echo '(none of them)'
}

judge_background_agent() {
  local name=$1 id=$2
  check 'the handoff cleared although a subagent was running' "records of $id: $(records_of "$id" true | tr '\n' ' ')" \
    session_has_record "$id" '.action == "cleared"'
  check 'the cleared record says background work was running when /handoff was typed' \
    "the cleared record: $(records_of "$id" '.action == "cleared"' | tr '\n' ' ')" \
    session_has_record "$id" '.action == "cleared" and .trigger_values.is_background_busy == true'
  check 'the note in the fresh session has the turn-after-note line' "$(fresh_transcript_evidence "$id" | tr '\n' ' ')" \
    fresh_session_has_text "$id" "$TURN_AFTER_NOTE"
  check "the agent's task notification reached the fresh session" "$(fresh_transcript_evidence "$id" | tr '\n' ' ')" \
    fresh_session_has_text "$id" "$TASK_NOTIFICATION"
  check "a notification turn began after the clear" \
    "the clear at $(cleared_ts "$id"), a notification turn at $(log_ts "$name" "$NOTIFICATION_TURN")" \
    ts_before "$(cleared_ts "$id")" "$(log_ts "$name" "$NOTIFICATION_TURN")"
}

show_records_of() {
  section "$2 ($1)"
  records_of "$1" true | jq -c '{ts, action, point: .trigger_values.point, reason: .trigger_values.reason, busy: .trigger_values.is_background_busy, note: .trigger_values.note, late_turn: .trigger_values.late_turn}' || true
}

# --- 2. a band press while a subagent runs --------------------------------------------------------------------

DEFERRED_TOAST='This turn is still running, so your choice will run when it ends'
TURN_ENDED='\[engine\] turn [0-9]+ end'
PRESS_LOGGED='ui\.press handoff/handoff'

press_while_a_subagent_runs() {
  local name=$1 origins_before
  handoff_start "$name" --allowedTools "$SUBAGENT_TOOLS" --session-id "$STEP_2_ID"
  say_apple "$name"
  wait_for 'the band to offer a handoff' pane_has "$name" 'h: Hand off and clear'
  origins_before=$(log_count "$name" 'cc_turn_origin=')
  submit "$name" "Run \`sleep 8\` in the foreground. Then use the Agent tool with run_in_background true and this prompt: $(agent_prompt "$SLEEP_CALLS_STEP_2") After the Agent call returns, reply with the word launched."
  wait_for "the turn to start in '$name'" log_has_more_than "$name" 'cc_turn_origin=' "$origins_before"
  press "$name" C-x Tab
  press "$name" h
  wait_for 'the band to press hand off' log_has "$name" "$PRESS_LOGGED"
  wait_for 'the press to be refused or the handoff to clear' session_has_record "$STEP_2_ID" "$ENDS_THE_WAIT"
  wait_for 'the band to be drawn for the busy state' pane_has "$name" 'Background work is still running'
  show_records_of "$STEP_2_ID" 'step 2: records of the session'
  show_log "$name" "$DEFERRED_TOAST|$PRESS_LOGGED|$TURN_ENDED|agent_completion" 10
  show_pane "$name" 'after the refusal' 12
  judge_press_while_a_subagent_runs "$name" "$STEP_2_ID"
}

judge_press_while_a_subagent_runs() {
  local name=$1 id=$2
  check 'the hand-off press was refused as busy (a none record, reason background_busy, from a button)' \
    "records of $id: $(records_of "$id" true | tr '\n' ' ')" \
    session_has_record "$id" "$REFUSED_BUSY and .trigger_values.point == \"button\""
  check 'the refusal record says background work was running' "the refusal: $(records_of "$id" "$REFUSED_BUSY" | tr '\n' ' ')" \
    session_has_record "$id" "$REFUSED_BUSY and .trigger_values.is_background_busy == true"
  check 'the refusal came after the main turn ended, so only the subagent was running' \
    "press at $(log_ts "$name" "$PRESS_LOGGED"), main turn ended at $(turn_end_after_press "$name"), refusal at $(refusal_ts "$id")" \
    refusal_follows_turn_end "$name" "$id"
  check 'nothing was cleared' "cleared records: $(session_record_count "$id" '.action == "cleared"')" \
    session_lacks_record "$id" '.action == "cleared"'
  check 'the band offers no hand-off while the subagent runs' \
    "band lines on the screen: $(pane "$name" | grep -E 'Hand off|Compact' | tr '\n' ' ' || true)" \
    band_has_no_handoff "$name"
}

session_lacks_record() { ! session_has_record "$1" "$2"; }
band_has_no_handoff() { ! pane_has "$1" 'h: Hand off' && pane_has "$1" 'c: Compact'; }
# A record's ts, or nothing when it has none: jq's "null" would sort after every ISO timestamp.
refusal_ts() { records_of "$1" "$REFUSED_BUSY" | jq -r '.ts // empty' | head -n 1; }

# log_ts_after <name> <after-regex> <regex>: the timestamp of the first debug-log line matching the regex
# after the first line matching the other. The patterns travel in the environment because awk -v would eat
# their backslashes.
log_ts_after() {
  LIVE_AFTER=$2 LIVE_RE=$3 awk '!seen { if ($0 ~ ENVIRON["LIVE_AFTER"]) seen = 1; next } $0 ~ ENVIRON["LIVE_RE"] { print $1; exit }' "$(debug_log_of "$1")"
}
turn_end_after_press() { log_ts_after "$1" "$PRESS_LOGGED" "$TURN_ENDED"; }
refusal_follows_turn_end() {
  ts_before "$(turn_end_after_press "$1")" "$(refusal_ts "$2")"
}

# --- 3. a foreground agent during the wait ------------------------------------------------------------------

# The Agent tool has no run_in_background parameter on 2.1.302: it starts every agent in the background,
# and the session answers a request for a foreground one with "no such parameter". With background tasks
# disabled the call waits for the agent, which is what this step needs.
FOREGROUND_AGENTS='CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1'

foreground_agent_during_the_wait() {
  local name=$1 peer=$2
  LIVE_SESSION_ENV=$FOREGROUND_AGENTS WAITING_HANDOFF_TOOLS=$SUBAGENT_TOOLS start_waiting_handoff "$name" "$peer" \
    "Use the Agent tool with this prompt: $(agent_prompt "$SLEEP_CALLS_STEP_3") When the Agent call returns, reply with the word done." \
    --session-id "$STEP_3_ID"
  settle_for session_has_record "$STEP_3_ID" "$ENDS_THE_WAIT"
  show_records_of "$STEP_3_ID" 'step 3: records of the session'
  show_log "$name" 'cc_turn_origin=peer|agent_completion|\[engine\] turn [0-9]+ (start|end)' 14
  judge_foreground_agent "$name" "$STEP_3_ID"
}

PEER_TURN_STARTED='cc_turn_origin=peer'
SUBAGENT_FINISHED='agent_completion agentId='
cleared_ts() { records_of "$1" '.action == "cleared"' | jq -r '.ts // empty' | head -n 1; }
peer_turn_end() { log_ts_after "$1" "$PEER_TURN_STARTED" "$TURN_ENDED"; }
subagent_finish() { log_ts_after "$1" "$PEER_TURN_STARTED" "$SUBAGENT_FINISHED"; }

judge_foreground_agent() {
  local name=$1 id=$2
  check 'the subagent ran during the wait (it finished after the peer turn began)' \
    "peer turn began at $(log_ts "$name" "$PEER_TURN_STARTED"), subagent finished at $(subagent_finish "$name")" \
    test -n "$(subagent_finish "$name")"
  check 'the handoff cleared once the main turn ended' "records of $id: $(records_of "$id" true | tr '\n' ' ')" \
    session_has_record "$id" '.action == "cleared"'
  check 'the clear landed after the main turn ended' \
    "the main turn ended at $(peer_turn_end "$name"), the clear at $(cleared_ts "$id")" \
    ts_before "$(peer_turn_end "$name")" "$(cleared_ts "$id")"
  check 'the clear landed after the subagent finished' \
    "the subagent finished at $(subagent_finish "$name"), the clear at $(cleared_ts "$id")" \
    ts_before "$(subagent_finish "$name")" "$(cleared_ts "$id")"
}
