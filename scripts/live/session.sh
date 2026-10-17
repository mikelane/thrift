#!/usr/bin/env bash
# The tmux sessions and the keyboard of the live harness. Sourced by lib.sh; never run directly.
# Runs on bash 3.2 (macOS), so no associative arrays, mapfile, or ${var,,}.

# --- sessions ------------------------------------------------------------------------------------

# live-<pid>-<nonce>-<label>. The nonce is drawn once per run, so a recycled pid cannot name a session
# an earlier run left behind (after a kill -9): the cleanup kills only names this run made up.
LIVE_NONCE=$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')
session_of() { echo "live-$$-$LIVE_NONCE-$1"; }
debug_log_of() { echo "$LIVE_RUN/debug-$1.log"; }
# The target for capture-pane and send-keys: `=` makes the session name an exact match (a bare name
# falls back to a prefix or window-name match when the session has died), and the trailing colon makes
# it a pane target (tmux answers "can't find pane: =name" without it).
pane_target_of() { echo "=$(session_of "$1"):"; }
pane() { tmux capture-pane -p -J -t "$(pane_target_of "$1")"; }

# Names of environment variables a session keeps from this shell. Everything else starting with CLAUDE
# is dropped, so a run from inside Claude Code's Bash tool (CLAUDE_PID, CLAUDE_EFFORT,
# CLAUDE_CODE_EXECPATH, CLAUDE_CODE_VERSION, the session and messaging ids) starts sessions like a run
# from a terminal. The login and the provider choice stay: the config directory, the OAuth token,
# CLAUDE_CODE_USE_* (Bedrock, Vertex, Foundry) and CLAUDE_CODE_SKIP_*_AUTH. The effect of the dropped
# variables on a session is unverified; the point is not to inherit the owner's session by accident.
LIVE_KEPT_ENV='^(CLAUDE_CONFIG_DIR|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_USE_[A-Z0-9_]+|CLAUDE_CODE_SKIP_[A-Z0-9_]+_AUTH)$'

# live_sh_words <words...>: the words as one POSIX sh command line, each in single quotes, which every
# shell tmux may run the command with reads the same way. Not printf %q: it writes $'...' for a newline
# or a control character, and outside a UTF-8 locale for any non-ASCII one, and a POSIX sh (dash, a
# tmux default-shell of /bin/sh on Linux) reads $'...' as a literal $ and a quoted string.
live_sh_words() {
  local word words='' escaped_quote="'\\''"
  for word in "$@"; do words+="'${word//\'/$escaped_quote}' "; done
  printf '%s' "$words"
}

# live_kept_env: this shell's kept variables as `export NAME='value'` lines for a POSIX sh.
live_kept_env() {
  local name
  for name in $(compgen -e); do
    [[ "$name" =~ $LIVE_KEPT_ENV ]] || continue
    printf 'export %s=' "$name"
    live_sh_words "${!name}"
    printf '\n'
  done
}

# live_claude_command <name> <claude-args...>: the shell command tmux runs for a session. It is a
# command string, not an argument list: the tmux server (not this shell) decides the environment of a
# new session, and a server started earlier carries its own. So the session drops every CLAUDE
# variable it has and then reads this shell's kept ones from a file in the run directory (owner-only),
# which it deletes at once: the OAuth token stays out of the command text, which `ps` and tmux show.
# The binary is the one live_require checked, by absolute path, and PATH is this shell's, for the same
# reason.
live_claude_command() {
  local name=$1
  shift
  local env_file="$LIVE_RUN/session-env-$name"
  (umask 077 && live_kept_env >"$env_file") || return 1
  # shellcheck disable=SC2016 # the script is for the shell tmux starts, not for this one
  local session_launch_script='env_file=$1; shift; for variable in $(env | sed -n "s/^\(CLAUDE[A-Za-z0-9_]*\)=.*/\1/p"); do unset "$variable"; done; . "$env_file"; rm -f "$env_file"; exec "$@"'
  live_sh_words sh -c "$session_launch_script" sh "$env_file" env \
    "PATH=$PATH" "THRIFT_HOME=$LIVE_THRIFT_HOME" CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 \
    "${LIVE_CLAUDE_BIN:-claude}" --name "$(session_of "$name")" --setting-sources project --debug-file "$(debug_log_of "$name")" \
    --permission-mode dontAsk --append-system-prompt "$LIVE_SYSTEM_PROMPT" "$@"
}

# live_start <name> <claude-args...>: starts claude in a detached tmux session and clears the
# start-up dialogs. The session reads project settings only (--setting-sources project), so the
# owner's user settings, hooks and plugins stay out of the run, and the run writes none of them.
# Each session's environment drops the variables that tie it to the session running this script.
#
# A session cannot act on its own: --permission-mode dontAsk denies every tool the caller did not
# allow with --allowedTools, so a session that follows an instruction it should not (the owner's,
# found in a CLAUDE.md or memory) is refused instead of running it. The appended system prompt says
# the same to the model. Auto-memory and CLAUDE.md loading are switched off by environment variable.
live_start() {
  local name=$1
  shift
  local session
  session=$(session_of "$name")
  local claude_command
  claude_command=$(live_claude_command "$name" "$@")
  # Recorded before the call: a Ctrl-C during it must still find the session the server made.
  LIVE_SESSIONS+=("$session")
  tmux new-session -d -s "$session" -x 120 -y 40 -c "$LIVE_CWD" "$claude_command" \
    || live_abort "tmux could not start session '$session'"
  LIVE_NAMES+=("$name")
  wait_for "'$name' to show its prompt" start_dialogs_cleared "$name"
}

# One poll of the start-up sequence. It answers the one dialog whose default is the safe choice
# (external CLAUDE.md imports: "No") and stops on any other dialog, such as the workspace trust
# prompt, because trusting a folder is the owner's decision. It succeeds once the prompt box is up.
start_dialogs_cleared() {
  local name=$1
  local screen
  tmux has-session -t "=$(session_of "$name")" 2>/dev/null \
    || live_abort "the claude session '$name' exited at start-up. Check that claude is logged in, and see $(debug_log_of "$name")"
  screen=$(pane "$name") || return 1
  if text_matches 'Allow external CLAUDE.md file imports' "$screen"; then
    tmux send-keys -t "$(pane_target_of "$name")" Enter
    return 1
  fi
  if text_matches 'Enter to confirm' "$screen"; then
    live_abort "claude is showing a dialog this harness will not answer (on a first run, the workspace trust prompt). Run 'cd $LIVE_CWD && claude' once, answer it, quit, then run the scenario again"
  fi
  box_text "$name" >/dev/null || return 1
}

# box_text <name>: the prompt box contents, between the last two rules of the screen, without the
# leading prompt glyph. Fails when the screen shows no box.
box_text() {
  pane "$1" | awk '
    /^──/ { previous_rule = last_rule; last_rule = NR; rules++ }
    { line[NR] = $0 }
    END {
      if (rules < 2) exit 1
      for (i = previous_rule + 1; i < last_rule; i++) { sub(/^❯ ?/, "", line[i]); print line[i] }
    }'
}

# --- keyboard ------------------------------------------------------------------------------------

press() {
  local name=$1
  shift
  tmux send-keys -t "$(pane_target_of "$name")" "$@"
}

# text_matches <extended-regex> <text>: succeeds when the text has a match. grep reads all of the text
# (no -q), so the shell that feeds it never meets a closed pipe. A pipe from `pane` into `grep -q`
# under pipefail reads a SIGPIPE'd producer as "no match", and `! pane_has` would then pass.
text_matches() { grep -E -- "$1" >/dev/null <<<"$2"; }
box_shows() {
  local box_contents
  box_contents=$(box_text "$1") || return 1
  grep -F -- "${2:0:LIVE_BOX_MATCH_CHARS}" >/dev/null <<<"$box_contents"
}

# type_text <name> <text>: types without Enter and waits until the box shows it. Enter pressed in
# the same call as a long text is taken as part of a paste and ignored.
type_text() {
  tmux send-keys -t "$(pane_target_of "$1")" -l -- "$2"
  wait_for "the box of '$1' to show the typed text" box_shows "$1" "$2"
}

submit() {
  type_text "$1" "$2"
  press "$1" Enter
}
