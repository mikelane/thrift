#!/usr/bin/env bash
# Runs the checks every plugin must pass before a push: `claude plugin validate`, `tsc -p`, then
# `claude plugin test`. CI calls this script too, so a local run and CI cannot drift apart.
#
# Usage: scripts/check.sh [plugin...]   (no arguments checks every plugins/*/)
#
# CHECK_LOG_DIR: when set, each plugin's output goes to $CHECK_LOG_DIR/<plugin>.txt, which is
# removed when the plugin passes and printed when it fails, and a `checked` file is created once
# every plugin has been tried. CI sets it for the canary report job, which reads both.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

tsc="$repo_root/node_modules/.bin/tsc"
if [ ! -x "$tsc" ]; then
  echo "tsc is not installed. Run 'npm ci' in $repo_root first." >&2
  exit 1
fi

if [ "$#" -gt 0 ]; then
  names=("$@")
else
  names=()
  for dir in plugins/*/; do
    [ -d "$dir" ] || continue
    names+=("$(basename "$dir")")
  done
fi
if [ "${#names[@]}" -eq 0 ]; then
  echo "No plugins found under $repo_root/plugins." >&2
  exit 1
fi

# The engine writes the declarations on every --plugin-dir load, so they are regenerated on every
# run and `tsc` checks against the installed engine's types. The load runs with an empty config
# directory and a bare environment: it is never logged in, so it makes no model call, and it reads
# none of the user's settings or hooks. It prints "Not logged in", which is expected.
config_dir=$(mktemp -d)
trap 'rm -rf "$config_dir"' EXIT

write_type_declarations() {
  local plugin_dir=$1
  local declarations="$plugin_dir/.claude-plugin/types/claude-code/index.d.ts"
  rm -f "$declarations"
  local output
  output=$(env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" CLAUDE_CONFIG_DIR="$config_dir" \
    CLAUDE_CODE_PLUGIN_DIR_WATCH=1 DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    claude -p x --plugin-dir "$plugin_dir" 2>&1) || true
  if [ ! -f "$declarations" ]; then
    echo "The engine wrote no type declarations for $plugin_dir:" >&2
    printf '%s\n' "$output" | tail -n 50 >&2
    return 1
  fi
}

# Chained with && because set -e is off inside a function called from an `if`.
run_checks() {
  local plugin_dir=$1
  write_type_declarations "$plugin_dir" &&
    echo '## claude plugin validate' &&
    claude plugin validate "$plugin_dir" &&
    echo '## tsc -p' &&
    "$tsc" -p "$plugin_dir" &&
    echo '## claude plugin test' &&
    claude plugin test "$plugin_dir"
}

run_plugin_checks() {
  local name=$1
  local plugin_dir="plugins/$name"
  if [ -z "$name" ] || [ ! -d "$plugin_dir" ]; then
    echo "No such plugin: $plugin_dir" >&2
    return 1
  fi
  run_checks "$plugin_dir"
}

check_plugin() {
  local name=${1%/}
  if [ -z "${CHECK_LOG_DIR:-}" ]; then
    run_plugin_checks "$name"
    return
  fi
  mkdir -p "$CHECK_LOG_DIR"
  local log="$CHECK_LOG_DIR/${name//\//_}.txt"
  if run_plugin_checks "$name" > "$log" 2>&1; then
    rm "$log"
  else
    cat "$log"
    return 1
  fi
}

# CI needs every plugin's log, so with CHECK_LOG_DIR set a failure is remembered and the loop goes on.
status=0
for name in "${names[@]}"; do
  echo "# $name"
  if [ -n "${CHECK_LOG_DIR:-}" ]; then
    (check_plugin "$name") || status=1
  else
    check_plugin "$name"
  fi
done
if [ -n "${CHECK_LOG_DIR:-}" ]; then
  mkdir -p "$CHECK_LOG_DIR"
  touch "$CHECK_LOG_DIR/checked"
fi
exit "$status"
