#!/usr/bin/env bash
# Shared helpers for the live harness. Sourced by live.sh and by each scenario; never run directly.
# Runs on bash 3.2 (macOS), so no associative arrays, mapfile, or ${var,,}.
#
# A scenario drives real `claude` sessions inside detached tmux sessions and judges the evidence:
# the pane (what the person sees), the debug log (timings, turn origins) and the decision log
# (records). It waits on conditions, never on fixed sleeps; LIVE_POLL is only the polling interval.

# shellcheck disable=SC2034 # the LIVE_* variables are set here and read by the sourcing scripts
LIVE_POLL=0.25
LIVE_TIMEOUT=${LIVE_TIMEOUT:-90}

LIVE_RUN=''
LIVE_SESSIONS=()
LIVE_FAILED=0
LIVE_CHECKED=0
LIVE_KEEP=${LIVE_KEEP:-0}

# --- lifecycle -----------------------------------------------------------------------------------

live_cleanup() {
  local status=$?
  local session
  for session in ${LIVE_SESSIONS[@]+"${LIVE_SESSIONS[@]}"}; do
    tmux kill-session -t "$session" 2>/dev/null || true
  done
  if [[ -n "$LIVE_RUN" ]]; then
    if [[ "$LIVE_KEEP" == 1 || "$status" -ne 0 ]]; then
      echo "run directory kept: $LIVE_RUN" >&2
    else
      rm -rf -- "$LIVE_RUN"
    fi
  fi
  return "$status"
}

live_abort() {
  echo "ERROR: $*" >&2
  local name
  for name in ${LIVE_NAMES[@]+"${LIVE_NAMES[@]}"}; do
    echo "--- pane of '$name' at the abort ---" >&2
    pane "$name" 2>/dev/null | grep -v '^$' | tail -n 20 >&2 || true
  done
  exit 2
}

live_require() {
  local tool
  for tool in tmux claude jq; do
    command -v "$tool" >/dev/null 2>&1 || live_abort "'$tool' is not installed or not on PATH"
  done
}

# live_init <plugin-dir>: makes the run directory and, per run, a throwaway copy of the plugin.
live_init() {
  LIVE_NAMES=()
  LIVE_RUN=$(mktemp -d)
  trap live_cleanup EXIT
  trap 'exit 130' INT TERM
  mkdir -p -- "$LIVE_RUN/thrift"
  LIVE_THRIFT_HOME="$LIVE_RUN/thrift"
  LIVE_DECISIONS="$LIVE_THRIFT_HOME/decisions.jsonl"
  LIVE_ENGINE_VERSION=$(claude --version | awk '{print $1}')
}

# --- waiting -------------------------------------------------------------------------------------

# wait_for <description> <command...>: polls the command until it succeeds. A timeout is an ERROR
# (the harness could not reach the state), not a FAIL (the plugin misbehaved).
wait_for() {
  local description=$1
  shift
  local deadline=$((SECONDS + LIVE_TIMEOUT))
  until "$@"; do
    ((SECONDS < deadline)) || live_abort "timed out after ${LIVE_TIMEOUT}s waiting for $description"
    sleep "$LIVE_POLL"
  done
}

# --- sessions ------------------------------------------------------------------------------------

session_of() { echo "live-$$-$1"; }
debug_log_of() { echo "$LIVE_RUN/debug-$1.log"; }
pane() { tmux capture-pane -p -J -t "$(session_of "$1")"; }

# live_start <name> <claude-args...>: starts claude in a detached tmux session and clears the
# start-up dialogs. The session reads project settings only (--setting-sources project), so the
# owner's user settings, hooks and plugins stay out of the run, and the run writes none of them.
# Each session's environment drops the variables that tie it to the session running this script.
live_start() {
  local name=$1
  shift
  local session
  session=$(session_of "$name")
  local command
  command=$(printf '%q ' env \
    -u CLAUDECODE -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_CHILD_SESSION \
    -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_BRIDGE_SESSION_ID \
    -u CLAUDE_CODE_SESSION_ATTENDED \
    "THRIFT_HOME=$LIVE_THRIFT_HOME" \
    claude --name "$session" --setting-sources project --debug-file "$(debug_log_of "$name")" "$@")
  tmux new-session -d -s "$session" -x 120 -y 40 -c "$LIVE_CWD" "$command" \
    || live_abort "tmux could not start session '$session'"
  LIVE_SESSIONS+=("$session")
  LIVE_NAMES+=("$name")
  wait_for "'$name' to show its prompt" start_dialogs_cleared "$name"
}

# One poll of the start-up sequence. It answers the one dialog whose default is the safe choice
# (external CLAUDE.md imports: "No") and stops on any other dialog, such as the workspace trust
# prompt, because trusting a folder is the owner's decision. It succeeds once the prompt box is up.
start_dialogs_cleared() {
  local name=$1
  local screen
  tmux has-session -t "$(session_of "$name")" 2>/dev/null \
    || live_abort "the claude session '$name' exited at start-up. Check that claude is logged in, and see $(debug_log_of "$name")"
  screen=$(pane "$name") || return 1
  if grep -q 'Allow external CLAUDE.md file imports' <<<"$screen"; then
    tmux send-keys -t "$(session_of "$name")" Enter
    return 1
  fi
  if grep -q 'Enter to confirm' <<<"$screen"; then
    live_abort "claude is showing a dialog this harness will not answer. Run 'cd $LIVE_CWD && claude' once, answer it, then run again"
  fi
  box_text "$name" >/dev/null || return 1
}

# box_text <name>: the prompt box contents, between the last two rules of the screen, without the
# leading prompt glyph. Fails when the screen shows no box.
box_text() {
  pane "$1" | awk '
    /^──/ { before = last; last = NR; rules++ }
    { line[NR] = $0 }
    END {
      if (rules < 2) exit 1
      for (i = before + 1; i < last; i++) { sub(/^❯ ?/, "", line[i]); print line[i] }
    }'
}

# --- keyboard ------------------------------------------------------------------------------------

press() {
  local name=$1
  shift
  tmux send-keys -t "$(session_of "$name")" "$@"
}

box_shows() { box_text "$1" | grep -qF -- "${2:0:40}"; }

# type_text <name> <text>: types without Enter and waits until the box shows it. Enter pressed in
# the same call as a long text is taken as part of a paste and ignored.
type_text() {
  tmux send-keys -t "$(session_of "$1")" -l -- "$2"
  wait_for "the box of '$1' to show the typed text" box_shows "$1" "$2"
}

submit() {
  type_text "$1" "$2"
  press "$1" Enter
}

# --- reading the screen and the logs ---------------------------------------------------------------

pane_has() { pane "$1" | grep -qE -- "$2"; }
pane_count() { pane "$1" | grep -cE -- "$2" || true; }
log_has() { grep -qE -- "$2" "$(debug_log_of "$1")" 2>/dev/null; }
log_count() { grep -cE -- "$2" "$(debug_log_of "$1")" 2>/dev/null || true; }
log_has_more_than() { (($(log_count "$1" "$2") > $3)); }
# The timestamp / line number of the first debug-log line after line <from> matching an extended
# regex. The pattern travels in the environment because awk -v would eat its backslashes.
log_ts() { LIVE_RE=$2 awk -v from="${3:-0}" 'NR > from && $0 ~ ENVIRON["LIVE_RE"] { print $1; exit }' "$(debug_log_of "$1")"; }
log_line() { LIVE_RE=$2 awk -v from="${3:-0}" 'NR > from && $0 ~ ENVIRON["LIVE_RE"] { print NR; exit }' "$(debug_log_of "$1")"; }
log_line_text() { sed -n "${2}p" "$(debug_log_of "$1")" | cut -c1-200; }
turn_origins() { sed -n 's/.*cc_turn_origin=\([a-z_-]*\).*/\1/p' "$(debug_log_of "$1")"; }

# A finished turn leaves a "✻ <verb> for <n>s" line behind.
turns_done() { pane_count "$1" '^✻ [^(]+ for ([0-9]+m )?[0-9]+s'; }
turns_done_above() { (($(turns_done "$1") > $2)); }

record_count() { [[ -f "$LIVE_DECISIONS" ]] && jq -s --arg a "$1" '[.[] | select(.action == $a)] | length' "$LIVE_DECISIONS" || echo 0; }
records_with() { [[ -f "$LIVE_DECISIONS" ]] && jq -c --arg a "$1" 'select(.action == $a)' "$LIVE_DECISIONS" || true; }
record_exists() { (($(record_count "$1") > ${2:-0})); }

# --- verdicts ------------------------------------------------------------------------------------

section() { printf '\n--- %s ---\n' "$1"; }
show_pane() { section "pane of '$1'${2:+ ($2)}"; pane "$1" | grep -v '^$' | tail -n "${3:-14}"; }
show_box() { section "prompt box of '$1'${2:+ ($2)}"; printf '[%s]\n' "$(box_text "$1")"; }
show_records() { section "decision records: $1"; records_with "$1"; }
show_log() { section "debug log of '$1' matching /$2/"; grep -nE -- "$2" "$(debug_log_of "$1")" | cut -c1-220 | tail -n "${3:-12}"; }

# check <name> <detail> <command...>: records PASS when the command succeeds, FAIL when not.
check() {
  local name=$1 detail=$2
  shift 2
  LIVE_CHECKED=$((LIVE_CHECKED + 1))
  if "$@"; then
    printf 'PASS  %s\n' "$name"
  else
    LIVE_FAILED=$((LIVE_FAILED + 1))
    printf 'FAIL  %s\n        %s\n' "$name" "$detail"
  fi
}

live_verdict() {
  local scenario=$1
  printf '\n'
  if ((LIVE_FAILED > 0)); then
    printf 'FAIL %s (%d of %d checks failed)\n' "$scenario" "$LIVE_FAILED" "$LIVE_CHECKED"
    return 1
  fi
  printf 'PASS %s (%d checks)\n' "$scenario" "$LIVE_CHECKED"
}
