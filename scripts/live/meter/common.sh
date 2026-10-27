#!/usr/bin/env bash
# Meter helpers for the live scenarios. Sourced by live.sh after lib.sh.

# meter_prepare <options-json>: copies the plugin into the run directory, so the repo is never
# touched, and writes the settings file that sets the plugin's options for the run. Meter has no
# thresholds to lower, so the copy is the plugin as it stands.
meter_prepare() {
  local options=$1
  local copy="$LIVE_RUN/plugin"
  mkdir -p -- "$copy/.claude-plugin"
  cp -- "$LIVE_PLUGIN_SOURCE/.claude-plugin/plugin.json" "$copy/.claude-plugin/plugin.json"
  cp -R -- "$LIVE_PLUGIN_SOURCE/hooks" "$copy/hooks"
  cp -R -- "$LIVE_PLUGIN_SOURCE/types" "$copy/types"
  jq -n --argjson options "$options" \
    '{pluginConfigs: {"meter@inline": {options: $options}}}' \
    >"$LIVE_RUN/settings.json"
}

# meter_start <name> [claude-args...]: a session with the prepared copy of the plugin loaded.
meter_start() {
  local name=$1
  shift
  live_start "$name" --settings "$LIVE_RUN/settings.json" --plugin-dir "$LIVE_RUN/plugin" "$@"
  wait_for "the meter plugin to start in '$name'" log_has "$name" 'meter@inline session\.start settled'
}

# --- what the screen shows ---------------------------------------------------------------------------

# The CONTEXT row's figures once a response has reported a fill: `41k / 1M`, `1.2M / 2M`, `950 / 200k`.
METER_CONTEXT_FIGURES='[0-9]+(\.[0-9])?[kM]? / [0-9]+(\.[0-9])?[kM]?'

# The CONTEXT row is the pane's first row, drawn in both layouts. The transcript never prints it, so it
# tells the pane from the `/meter` that opened it.
meter_pane_is_open() { pane_has "$1" "CONTEXT +(waiting for first response|$METER_CONTEXT_FIGURES)"; }
# The TOP CONTEXT header is the pane's twelfth row. The main-screen layout clips the pane above it.
meter_top_context_is_drawn() { pane_has "$1" 'TOP CONTEXT'; }
# The frame's close button. Inline the pane is boxed, with the button in the top border; docked it sits
# in the right-hand columns, on the divider's row. 2.1.311 draws no title in either frame.
meter_inline_frame_is_drawn() { pane_has "$1" '^╭─+✕─╮'; }
meter_docked_frame_is_drawn() { pane_has "$1" '│ +✕ *$'; }
meter_frame_is_drawn() { meter_inline_frame_is_drawn "$1" || meter_docked_frame_is_drawn "$1"; }
meter_pane_is_closed() { ! meter_pane_is_open "$1"; }

# The age label of the breakdown, drawn after the TOP CONTEXT header.
meter_age_seconds() { pane "$1" | sed -En 's/.*TOP CONTEXT.*· ([0-9]+)s ago.*/\1/p' | head -n 1; }
meter_age_is_at_least() {
  local seconds
  seconds=$(meter_age_seconds "$1")
  [[ -n "$seconds" ]] && ((seconds >= $2))
}
meter_age_is_zero() { [[ "$(meter_age_seconds "$1")" == 0 ]]; }

# meter_cost <name>: the dollars the COST row shows, or nothing.
meter_cost() { pane "$1" | sed -En 's/.*COST +\$([0-9]+\.[0-9]+) at API rates.*/\1/p' | head -n 1; }
meter_cost_is_above_zero() {
  local cost
  cost=$(meter_cost "$1")
  [[ -n "$cost" ]] && awk -v cost="$cost" 'BEGIN { exit !(cost > 0) }'
}

pane_count_above() {
  local count
  count=$(pane_count "$1" "$2") || return 1
  ((count > $3))
}

# meter_command <name> <command> <reply-regex>: types a /meter command and waits for one more reply
# of that text than the screen showed before.
meter_command() {
  local name=$1 command=$2 reply=$3 replies_before
  replies_before=$(pane_count "$name" "$reply")
  submit "$name" "$command"
  wait_for "the reply to '$command' in '$name'" pane_count_above "$name" "$reply" "$replies_before"
}

# say_apple <name>: one tiny turn, so the session has a reply.
say_apple() {
  local turns_before
  turns_before=$(turns_done "$1")
  submit "$1" 'say the word apple'
  wait_for "the turn of '$1' to finish" turns_done_above "$1" "$turns_before"
}

meter_two_seconds_since() { ((SECONDS - $1 >= 2)); }

# open_meter_with_old_reading <name>: the pane opened with /meter, then a turn run at least two
# seconds later, so the redraw reads `<n>s ago` with n of 1 or more. The label redraws only when the
# stored reading changes, and drawMeter reads the clock without invalidating, so a label that was
# never redrawn after a wait would still read 0s.
open_meter_with_old_reading() {
  # The age label sits in the TOP CONTEXT header, so this needs the layout that draws it.
  local name=$1 opened_at
  meter_command "$name" '/meter' 'Meter opened\.'
  wait_for 'the pane to open' meter_pane_is_open "$name"
  opened_at=$SECONDS
  wait_for 'two seconds to pass' meter_two_seconds_since "$opened_at"
  say_apple "$name"
  wait_for 'the redraw to show an age of 1s or more' meter_age_is_at_least "$name" 1
}

# The layouts a session can use. A fullscreen session docks the pane beside the transcript and has the
# rows to draw all of it; the main-screen layout (tmux's default) draws it inline, above the prompt,
# clipped to about a third of the terminal, which cuts off TOP CONTEXT at 40 rows.
# shellcheck disable=SC2034 # read by the scenarios
METER_FULLSCREEN='CLAUDE_CODE_NO_FLICKER=1'
# shellcheck disable=SC2034 # read by the scenarios
METER_MAIN_SCREEN='CLAUDE_CODE_NO_FLICKER=0'

# The engine remembers which panes the person opened by asking, in the config file.
meter_config_file() { echo "${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json"; }
meter_asked_panes() { jq -c '.pluginPanes.asked // []' "$(meter_config_file)"; }
meter_was_asked() { jq -e '(.pluginPanes.asked // []) | any(.plugin == "meter" and .id == "meter")' "$(meter_config_file)" >/dev/null; }

# meter_close_by_hand <name>: focus the pane (ctrl+x tab) and close it (ctrl+x x), as a person does.
# That removes the pane from the asked list.
meter_close_by_hand() {
  press "$1" C-x Tab
  press "$1" C-x x
  wait_for "the pane of '$1' to close" meter_pane_is_closed "$1"
}

# meter_screen_is_still <name> <polls>: succeeds once the screen has not changed for that many calls in
# a row. The effort indicator blinks, so its line is left out. A pane that never appears has nothing to wait for, so this is how "not placed" is judged.
meter_screen_is_still() {
  local name=$1 polls=$2 state="$LIVE_RUN/still-$1" current previous='' count=0
  current=$(pane "$name" | { grep -v '/effort' || true; } | cksum | tr ' ' '-')
  if [[ -f "$state" ]]; then
    read -r previous count <"$state" || true
    count=${count:-0}
  fi
  if [[ "$current" == "$previous" ]]; then count=$((count + 1)); else count=0; fi
  printf '%s %s\n' "$current" "$count" >"$state"
  ((count >= polls))
}
