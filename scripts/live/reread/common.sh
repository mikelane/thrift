#!/usr/bin/env bash
# Reread helpers for the live scenarios. Sourced by live.sh after lib.sh.

# reread_prepare <read-mode>: copies the plugin into the run directory, so the repo is never
# touched, and writes the settings file that sets readMode for the run. The copy is the plugin as it
# stands: reread has no thresholds to lower, and the tested-through release is the constant under
# test.
reread_prepare() {
  local read_mode=$1
  local copy="$LIVE_RUN/plugin"
  mkdir -p -- "$copy/.claude-plugin"
  cp -- "$LIVE_PLUGIN_SOURCE/.claude-plugin/plugin.json" "$copy/.claude-plugin/plugin.json"
  cp -R -- "$LIVE_PLUGIN_SOURCE/hooks" "$copy/hooks"
  cp -R -- "$LIVE_PLUGIN_SOURCE/types" "$copy/types"
  jq -n --arg mode "$read_mode" \
    '{pluginConfigs: {"reread@inline": {options: {readMode: $mode}}}}' \
    >"$LIVE_RUN/settings.json"
}

# reread_start <name>: a session with the prepared copy loaded. Read and Edit are the only tools it
# may use; --permission-mode dontAsk denies the rest.
reread_start() {
  local name=$1
  live_start "$name" --settings "$LIVE_RUN/settings.json" --plugin-dir "$LIVE_RUN/plugin" \
    --allowedTools 'Read,Edit'
  wait_for "the reread plugin to start in '$name'" \
    log_has "$name" 'hooks module reread@inline loaded'
}

# reread_make_probe_files <dir>: the files the steps read. probe.txt has 80 LF lines, crlf.txt 30
# lines ending in CRLF, bom.txt 30 lines after a UTF-8 byte order mark. Each is long enough that a
# stub is smaller than the text it replaces.
reread_make_probe_files() {
  local dir=$1 number padding='kept long enough to outweigh a stub'
  mkdir -p -- "$dir"
  : >"$dir/probe.txt"
  : >"$dir/crlf.txt"
  printf '\357\273\277' >"$dir/bom.txt"
  for number in $(seq 1 80); do
    printf 'line %d of the probe file, %s\n' "$number" "$padding" >>"$dir/probe.txt"
  done
  for number in $(seq 1 30); do
    printf 'line %d of the crlf file, %s\r\n' "$number" "$padding" >>"$dir/crlf.txt"
    printf 'line %d of the bom file, %s\n' "$number" "$padding" >>"$dir/bom.txt"
  done
}

# A turn's end writes one of these debug-log lines. The screen's "✻ ... for 5s" lines cannot count
# turns here: a session of ten turns scrolls the early ones off a 40-row pane.
REREAD_TURN_END='\[remote-bridge\] Sent result success'

# reread_step <name> <prompt>: types one prompt, waits for its turn to finish, and remembers how
# many decision records existed before it, so the judgments below read only what the step wrote.
reread_step() {
  local name=$1 prompt=$2 turns_before
  turns_before=$(log_baseline "$name" "$REREAD_TURN_END")
  live_raise_noted_error
  REREAD_BASELINE=$(decision_lines)
  submit "$name" "$prompt"
  wait_for "the turn of '$name' to finish" \
    log_has_more_than "$name" "$REREAD_TURN_END" "$turns_before"
}

# reread_read_prompt <path> <why>: asks for a Read call. <why> says why it is repeated, because a
# model told only "read it" may answer from the earlier result without calling the tool.
reread_read_prompt() { printf 'Call the Read tool on %s%s. Reply with only: done' "$1" "$2"; }

reread_step_records() { records_after "$REREAD_BASELINE" "$1"; }
reread_step_has() { [[ -n "$(reread_step_records "$1")" ]]; }
show_step_records() {
  section "decision records of the step: $1"
  local records
  records=$(reread_step_records true)
  printf '%s\n' "${records:-(none)}"
}

# Every record of the run is reread's, written in active mode with readMode ask, by the engine the
# harness started. A plugin held at off by an untested build writes mode shadow and effective_mode
# off.
reread_all_records_are_active_ask() {
  [[ -f "$LIVE_DECISIONS" ]] || return 1
  jq -s --arg engine "$LIVE_ENGINE_VERSION" \
    'length > 0 and all(.[]; .component == "reread" and .engine_version == $engine
      and .action != "none" and .mode == "active" and .trigger_values.effective_mode == "ask")' \
    "$LIVE_DECISIONS" | grep -qx true
}

# reread_pane_lacks <name> <regex>: the screen can be read and has no match.
reread_pane_lacks() {
  local screen
  screen=$(pane "$1") || return 1
  ! text_matches "$2" "$screen"
}
