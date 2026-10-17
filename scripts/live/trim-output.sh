#!/usr/bin/env bash
# Trims a live run's output before it goes into an issue or a PR: the home directory becomes ~ and
# every UUID (session ids, in transcript paths and the debug log) becomes <session-id>.
#
# Usage: scripts/live/live.sh handoff held-prompt-box 2>&1 | scripts/live/trim-output.sh
#
# It is a filter and changes nothing else. Read the result once before pasting it: it does not know
# your user name outside $HOME, other paths, or the welcome banner a pane excerpt can show.
set -euo pipefail

home=${HOME:-}
# The home directory is replaced as plain text (index/substr), so no character in it is special.
awk -v home="$home" '
  home == "" || home == "/" { print; next }
  {
    line = $0
    out = ""
    while ((position = index(line, home)) > 0) {
      out = out substr(line, 1, position - 1) "~"
      line = substr(line, position + length(home))
    }
    print out line
  }' \
  | sed -E 's/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/<session-id>/g'
