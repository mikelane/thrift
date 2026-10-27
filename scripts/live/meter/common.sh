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
METER_CONTEXT_ROW="CONTEXT +(waiting for first response|$METER_CONTEXT_FIGURES)"
meter_pane_is_open() { pane_has "$1" "$METER_CONTEXT_ROW"; }
# The TOP CONTEXT header is the pane's twelfth row. The main-screen layout clips the pane above it.
meter_top_context_is_drawn() { pane_has "$1" 'TOP CONTEXT'; }
# The frame's close button. Inline the pane is boxed, with the button in the top border; docked it sits
# in the right-hand columns, on the divider's row. 2.1.311 draws no title in either frame.
METER_INLINE_FRAME='^╭─+✕─╮'
METER_DOCKED_FRAME='│ +✕ *$'
meter_inline_frame_is_drawn() { pane_has "$1" "$METER_INLINE_FRAME"; }
meter_docked_frame_is_drawn() { pane_has "$1" "$METER_DOCKED_FRAME"; }
meter_frame_is_drawn() { meter_inline_frame_is_drawn "$1" || meter_docked_frame_is_drawn "$1"; }
# The negative judgments read the screen once and fail when it cannot be read, as pane_has does: a
# session that died must not read as a closed pane or a gone frame.
meter_pane_is_closed() {
  local screen
  screen=$(pane "$1") || return 1
  ! text_matches "$METER_CONTEXT_ROW" "$screen"
}
meter_frame_is_gone() {
  local screen
  screen=$(pane "$1") || return 1
  ! text_matches "$METER_INLINE_FRAME" "$screen" && ! text_matches "$METER_DOCKED_FRAME" "$screen"
}
# meter_pane_lacks <name> <regex>: the screen can be read and has no match. `! pane_has` would pass on
# a session that died.
meter_pane_lacks() {
  local screen
  screen=$(pane "$1") || return 1
  ! text_matches "$2" "$screen"
}

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
  local name=$1 command=$2 reply_pattern=$3 replies_before
  replies_before=$(pane_count "$name" "$reply_pattern")
  submit "$name" "$command"
  wait_for "the reply to '$command' in '$name'" pane_count_above "$name" "$reply_pattern" "$replies_before"
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
# A config file that cannot be read as JSON is not "nothing asked": it would skip the close by hand and
# record asked_before=no. These run in command substitutions and conditions, so they note the problem and
# the next wait_for, check or verdict ends the run with an ERROR. A missing file holds no asked list.
meter_asked_panes() {
  local file
  file=$(meter_config_file)
  [[ -f "$file" ]] || { echo '[]'; return 0; }
  jq -c '.pluginPanes.asked // []' "$file" 2>/dev/null || {
    live_note_error "the config file $file could not be read as JSON"
    echo '(unreadable)'
  }
}
meter_was_asked() {
  local file status=0
  file=$(meter_config_file)
  [[ -f "$file" ]] || return 1
  jq -e '(.pluginPanes.asked // []) | any(.plugin == "meter" and .id == "meter")' "$file" >/dev/null 2>&1 || status=$?
  # jq -e exits 1 for false; any other non-zero status is an error reading the file.
  if ((status > 1)); then live_note_error "the config file $file could not be read as JSON (jq status $status)"; fi
  return "$status"
}

# meter_close_by_hand <name>: focus the pane (ctrl+x tab) and close it (ctrl+x x), as a person does.
# That removes the pane from the asked list.
meter_close_by_hand() {
  press "$1" C-x Tab
  press "$1" C-x x
  wait_for "the pane of '$1' to close" meter_pane_is_closed "$1"
}

# meter_screen_is_still <name> <polls>: succeeds once the screen has not changed for that many calls in
# a row. The effort indicator blinks, so its line is left out. A pane that never appears has nothing to wait for, so this is how "not placed" is judged.
# A screen that cannot be read fails, so a session that died is not judged still.
meter_screen_is_still() {
  local name=$1 polls=$2 state_file="$LIVE_RUN/still-$1" screen current_checksum previous_checksum='' still_polls=0
  screen=$(pane "$name") || return 1
  current_checksum=$({ grep -v '/effort' <<<"$screen" || true; } | cksum | tr ' ' '-')
  if [[ -f "$state_file" ]]; then
    read -r previous_checksum still_polls <"$state_file" || true
    still_polls=${still_polls:-0}
  fi
  if [[ "$current_checksum" == "$previous_checksum" ]]; then still_polls=$((still_polls + 1)); else still_polls=0; fi
  printf '%s %s\n' "$current_checksum" "$still_polls" >"$state_file"
  ((still_polls >= polls))
}
