#!/usr/bin/env bash
# Handoff helpers for the live scenarios. Sourced by live.sh after lib.sh.

# handoff_prepare <options-json>: copies the plugin into the run directory, so the repo is never
# touched, and writes the settings file that sets the plugin's options for the run.
#
# The copy gets two changes:
# - TESTED_THROUGH is raised to the running Claude Code release. Past TESTED_THROUGH the plugin
#   holds every session at `off` and shows a notice, which would hide the band and the modes. The
#   same change is made by hand for live runs on a newer release.
# - The context-size minimum is lowered, in plugin.json and in MIN_THRESHOLD, so a band can be
#   offered at the 20,000 tokens a tiny session reaches. The real minimum is 80,000, which a
#   session of one-word prompts never gets near.
handoff_prepare() {
  local options=$1
  local copy="$LIVE_RUN/plugin"
  mkdir -p -- "$copy/.claude-plugin"
  cp -R -- "$LIVE_PLUGIN_SOURCE/hooks" "$copy/hooks"
  jq '.userConfig.handoffContextTokens.min = 1000' "$LIVE_PLUGIN_SOURCE/.claude-plugin/plugin.json" \
    >"$copy/.claude-plugin/plugin.json"
  [[ "$LIVE_ENGINE_VERSION" =~ ^[0-9]+(\.[0-9]+)*$ ]] || live_abort "unexpected claude version '$LIVE_ENGINE_VERSION'"
  replace_constant "$copy/hooks/engine-version.ts" 'export const TESTED_THROUGH = ' "'$LIVE_ENGINE_VERSION'"
  replace_constant "$copy/hooks/signals.ts" 'const MIN_THRESHOLD = ' '1_000'
  jq -n --argjson options "$options" \
    '{pluginConfigs: {"handoff@inline": {options: ({handoffMode: "ask"} + $options)}}}' \
    >"$LIVE_RUN/settings.json"
}

# replace_constant <file> <declaration-prefix> <value>: rewrites the line that starts with the prefix.
# A run on an unpatched copy would sit in `off` mode and hide the band, so a miss is an ERROR.
replace_constant() {
  local file=$1 prefix=$2 value=$3
  grep -q "^$prefix" "$file" || live_abort "no line starting '$prefix' in ${file#"$LIVE_RUN"/}; the plugin changed, update handoff/common.sh"
  sed "s/^$prefix.*/$prefix$value/" "$file" >"$file.new"
  mv -- "$file.new" "$file"
}

# handoff_start <name>: a session with the prepared copy of the plugin loaded.
handoff_start() {
  live_start "$1" --settings "$LIVE_RUN/settings.json" --plugin-dir "$LIVE_RUN/plugin"
  wait_for "the handoff plugin to start in '$1'" log_has "$1" 'handoff@inline session\.start settled'
}

# say_apple <name>: one tiny turn, so the session has a reply to hand off (a handoff before the
# first reply has nothing to fork, #54).
say_apple() {
  local before
  before=$(turns_done "$1")
  submit "$1" 'say the word apple'
  wait_for "the first turn of '$1' to finish" turns_done_above "$1" "$before"
}

# held_prompts_flow <name>: the turn, then /handoff, then three prompts typed while the note is
# written, then waits for the handoff to clear and the fresh session to answer the held prompts.
held_prompts_flow() {
  local name=$1 count=0 word
  say_apple "$name"
  local turns_before
  turns_before=$(log_count "$name" 'cc_turn_origin=')
  submit "$name" '/handoff'
  wait_for "the note status line" pane_has "$name" 'Writing a handoff note'
  for word in one two three; do
    count=$((count + 1))
    submit "$name" "$word"
    wait_for "prompt '$word' to be held" log_has "$name" "held a prompt for the handoff \\($count held\\)"
  done
  wait_for "the handoff to clear" record_exists cleared
  wait_for "the fresh session to start a turn" log_has_more_than "$name" 'cc_turn_origin=' "$turns_before"
  wait_for "the fresh session to answer" turns_done_above "$name" 0
}
