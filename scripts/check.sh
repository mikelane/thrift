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

tsc_bin="$repo_root/node_modules/.bin/tsc"
if [[ ! -x "$tsc_bin" ]]; then
  echo "tsc is not installed. Run 'npm ci' in $repo_root, then run this script again." >&2
  exit 1
fi

if [[ "$#" -gt 0 ]]; then
  plugin_names=("$@")
else
  plugin_names=()
  for dir in plugins/*/; do
    [[ -d "$dir" ]] || continue
    plugin_names+=("$(basename "$dir")")
  done
fi
if [[ "${#plugin_names[@]}" -eq 0 ]]; then
  echo "No plugins found under $repo_root/plugins. Check that the checkout is complete." >&2
  exit 1
fi

# The engine writes the declarations on every --plugin-dir load, so they are regenerated on every
# run and `tsc` checks against the installed engine's types. The load runs with an empty config
# directory and a bare environment: it is never logged in, so it makes no model call, and it reads
# none of the user's settings or hooks. It prints "Not logged in", which is expected.
empty_config_dir=$(mktemp -d)
trap 'rm -rf "$empty_config_dir"' EXIT

# shellcheck disable=SC2329 # called through run_labeled_step's "$@"
write_type_declarations() {
  local plugin_dir="$1"
  local declarations="$plugin_dir/.claude-plugin/types/claude-code/index.d.ts"
  rm -f -- "$declarations"
  local engine_output
  engine_output=$(env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" CLAUDE_CONFIG_DIR="$empty_config_dir" \
    CLAUDE_CODE_PLUGIN_DIR_WATCH=1 DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    claude -p x --plugin-dir "$plugin_dir" 2>&1) || true
  if [[ ! -f "$declarations" ]]; then
    echo "The engine wrote no type declarations for $plugin_dir. Check that 'claude' is on PATH and the plugin loads. The last 50 lines of its output:" >&2
    printf '%s\n' "$engine_output" | tail -n 50 >&2
    return 1
  fi
}

# Runs one check under a `## <label>` header. On failure it names the plugin, the check and the
# exit code, so the log (and the canary issue built from it) says what failed without the reader
# having to infer it from the last header.
run_labeled_step() {
  local plugin_dir="$1" label="$2"
  shift 2
  echo "## $label"
  local rc=0
  "$@" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    echo "FAILED: $plugin_dir: $label exited $rc" >&2
  fi
  return "$rc"
}

# Chained with && because set -e is off inside a function called from an `if`.
run_checks_in_dir() {
  local plugin_dir="$1"
  run_labeled_step "$plugin_dir" 'type declarations' write_type_declarations "$plugin_dir" &&
    run_labeled_step "$plugin_dir" 'claude plugin validate' claude plugin validate "$plugin_dir" &&
    run_labeled_step "$plugin_dir" 'tsc -p' "$tsc_bin" -p "$plugin_dir" &&
    run_labeled_step "$plugin_dir" 'claude plugin test' claude plugin test "$plugin_dir"
}

run_checks_for_plugin() {
  local name="$1"
  local plugin_dir="plugins/$name"
  if [[ -z "$name" || ! -d "$plugin_dir" ]]; then
    echo "No such plugin: $plugin_dir. Pass the name of a directory under plugins/." >&2
    return 1
  fi
  run_checks_in_dir "$plugin_dir"
}

check_plugin() {
  local name="${1%/}"
  if [[ -z "${CHECK_LOG_DIR:-}" ]]; then
    run_checks_for_plugin "$name"
    return
  fi
  mkdir -p "$CHECK_LOG_DIR"
  local log_file="$CHECK_LOG_DIR/${name//\//_}.txt"
  if run_checks_for_plugin "$name" > "$log_file" 2>&1; then
    rm -f -- "$log_file"
  else
    cat "$log_file"
    return 1
  fi
}

# CI needs every plugin's log, so with CHECK_LOG_DIR set a failure is remembered and the loop goes on.
exit_code=0
for name in "${plugin_names[@]}"; do
  echo "# $name"
  if [[ -n "${CHECK_LOG_DIR:-}" ]]; then
    (check_plugin "$name") || exit_code=1
  else
    check_plugin "$name"
  fi
done
if [[ -n "${CHECK_LOG_DIR:-}" ]]; then
  touch "$CHECK_LOG_DIR/checked"
fi
exit "$exit_code"
