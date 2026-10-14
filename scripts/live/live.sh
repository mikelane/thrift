#!/usr/bin/env bash
# Runs one live scenario against a plugin and prints PASS or FAIL with the evidence it used.
#
# Usage: scripts/live/live.sh <plugin> <scenario> [--plugin-dir DIR] [--keep]
#        scripts/live/live.sh --list
#
# LOCAL ONLY. It starts real, authenticated `claude` sessions in tmux and spends a few small
# turns of tokens per run. CI has no authenticated claude, so nothing here runs there.
#
# Exit status: 0 PASS, 1 FAIL (the plugin misbehaved), 2 ERROR (the harness could not reach the
# state it needed: a timeout, a missing tool, a missed timing window).
set -euo pipefail
unset CDPATH

live_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$live_dir/../.." && pwd)

usage() {
  echo "Usage: scripts/live/live.sh <plugin> <scenario> [--plugin-dir DIR] [--keep]" >&2
  echo "       scripts/live/live.sh --list" >&2
}

list_scenarios() {
  local file
  for file in "$live_dir"/*/scenarios/*.sh; do
    [[ -f "$file" ]] || continue
    printf '%s %s\n' "$(basename "$(dirname "$(dirname "$file")")")" "$(basename "$file" .sh)"
  done
}

if [[ "${1:-}" == "--list" ]]; then
  list_scenarios
  exit 0
fi
if [[ "$#" -lt 2 ]]; then
  usage
  exit 2
fi

plugin=$1
scenario=$2
shift 2
plugin_dir="$repo_root/plugins/$plugin"
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --plugin-dir)
      [[ "$#" -ge 2 ]] || { usage; exit 2; }
      plugin_dir=$(cd -- "$2" 2>/dev/null && pwd) || { echo "--plugin-dir $2 is not a directory." >&2; exit 2; }
      shift 2
      ;;
    --keep)
      # shellcheck disable=SC2034 # read by lib.sh
      LIVE_KEEP=1
      shift
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [[ ! "$plugin" =~ ^[a-z0-9-]+$ || ! "$scenario" =~ ^[a-z0-9-]+$ ]]; then
  echo "A plugin or scenario name is lowercase letters, digits and hyphens only." >&2
  exit 2
fi
scenario_file="$live_dir/$plugin/scenarios/$scenario.sh"
if [[ ! -f "$scenario_file" ]]; then
  echo "No scenario '$scenario' for plugin '$plugin'. Available:" >&2
  list_scenarios >&2
  exit 2
fi
if [[ ! -d "$plugin_dir/.claude-plugin" ]]; then
  echo "$plugin_dir is not a plugin directory (no .claude-plugin)." >&2
  exit 2
fi

# The sessions start in an empty scratch directory inside the checkout (gitignored), so the model
# has no repository to wander into and Claude Code's folder trust for the checkout covers it.
# Override it with LIVE_CWD.
LIVE_CWD=${LIVE_CWD:-$repo_root/.live/cwd}
mkdir -p -- "$LIVE_CWD"
# shellcheck disable=SC2034 # LIVE_PLUGIN and LIVE_PLUGIN_SOURCE are read by <plugin>/common.sh
LIVE_PLUGIN=$plugin
# shellcheck disable=SC2034
LIVE_PLUGIN_SOURCE=$plugin_dir

# shellcheck source=lib.sh
source "$live_dir/lib.sh"
# shellcheck source=handoff/common.sh
source "$live_dir/$plugin/common.sh"
# shellcheck source=/dev/null
source "$scenario_file"

live_require
live_init
printf 'scenario %s/%s on Claude Code %s\nplugin %s\nrun %s\n' "$plugin" "$scenario" "$LIVE_ENGINE_VERSION" "$plugin_dir" "$LIVE_RUN"
scenario_run
live_verdict "$plugin/$scenario"
