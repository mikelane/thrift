#!/usr/bin/env bash
# Trims a live run's output before it goes into an issue or a PR: the home directory becomes ~ and
# every UUID (session ids, in transcript paths and the debug log) becomes <session-id>.
#
# Usage: scripts/live/live.sh handoff held-prompt-box 2>&1 | scripts/live/trim-output.sh
#
# It is a filter and changes nothing else. Read the result once before pasting it: it does not know
# your user name outside $HOME, other paths, or the welcome banner a pane excerpt can show.
set -euo pipefail

# The home directory is replaced as plain text (index/substr), so no character in it is special. It
# travels in the environment because awk -v would read its backslashes as escapes. A trailing slash is
# dropped, and a match counts only where the name ends, so a home of /Users/mike leaves /Users/mikelane.
LIVE_TRIM_HOME=${HOME:-} awk '
  BEGIN { home = ENVIRON["LIVE_TRIM_HOME"]; sub(/\/+$/, "", home) }
  home == "" { print; next }
  {
    line = $0
    out = ""
    while ((position = index(line, home)) > 0) {
      after = substr(line, position + length(home), 1)
      if (after ~ /[A-Za-z0-9._-]/) {
        out = out substr(line, 1, position + length(home) - 1)
      } else {
        out = out substr(line, 1, position - 1) "~"
      }
      line = substr(line, position + length(home))
    }
    print out line
  }' \
  | sed -E 's/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/<session-id>/g'
