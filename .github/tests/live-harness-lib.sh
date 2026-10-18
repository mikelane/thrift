#!/usr/bin/env bash
# Shared by the live-harness-*.test.sh files and trim-output.test.sh: the stub `tmux` and `claude`, the
# hermetic environment, the runners for lib.sh and live.sh, and the asserts about the tmux calls.
# LIVE_UNDER_TEST points at another copy of scripts/live.
# shellcheck disable=SC2034 # EXIT_CODE is read by assert_exit_code in canary-report-lib.sh
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"

LIVE_DIR=${LIVE_UNDER_TEST:-$REPO_ROOT/scripts/live}
JQ_DIR=$(dirname "$(command -v jq)")

write_live_stubs() {
  mkdir -p "$TEST_DIR/bin" "$TEST_DIR/tmp" "$TEST_DIR/home"
  TMUX_LOG=$TEST_DIR/tmux-calls
  : > "$TMUX_LOG"
  printf '#!/bin/sh\necho "$*" >> "%s"\nexit 1\n' "$TMUX_LOG" > "$TEST_DIR/bin/tmux"
  printf '#!/bin/sh\necho "2.1.999 (Claude Code)"\n' > "$TEST_DIR/bin/claude"
  chmod +x "$TEST_DIR/bin/tmux" "$TEST_DIR/bin/claude"
}

# hermetic_env <command...>: drops the owner's settings that would steer the harness out of the
# test's own directories or change its timeouts and cleanup, and every CLAUDE* and ANTHROPIC*
# variable: the owner's login and keys. The stubs print CLAUDE* values, and a failing test prints its
# output. A test's own NAME=value arguments still arrive, because env applies them after every -u.
hermetic_env() {
  local name dropped=()
  for name in $(compgen -e); do
    case "$name" in
      CLAUDE* | ANTHROPIC* | XDG_CACHE_HOME | LIVE_CWD | LIVE_KEEP | LIVE_TIMEOUT) dropped+=(-u "$name") ;;
    esac
  done
  env ${dropped[@]+"${dropped[@]}"} "$@"
}

# run_live <bash-snippet>: the snippet runs under `set -euo pipefail` with lib.sh sourced.
run_live() {
  write_live_stubs
  EXIT_CODE=0
  hermetic_env PATH="$TEST_DIR/bin:$JQ_DIR:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" LIVE_DIR="$LIVE_DIR" \
    "$BASH" --noprofile --norc -c 'set -euo pipefail; source "$LIVE_DIR/lib.sh"; '"$1" > "$OUTPUT" 2>&1 || EXIT_CODE=$?
}

# run_live_sh <args...>: runs live.sh itself against the stubs, with HOME and TMPDIR in the test.
run_live_sh() {
  write_live_stubs
  EXIT_CODE=0
  hermetic_env PATH="$TEST_DIR/bin:$JQ_DIR:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" \
    "$BASH" "$LIVE_DIR/live.sh" "$@" > "$OUTPUT" 2>&1 || EXIT_CODE=$?
}

assert_tmux_called() { assert_file_has "$TMUX_LOG" "$1"; }
assert_file_matches() { grep -qaE -- "$2" "$1" || { fail "${1#"$TEST_DIR"/} has no line matching: $2"; show_file "$1"; }; }
assert_tmux_not_called() { assert_file_lacks "$TMUX_LOG" "$1"; }

# live_claude_command is what the tmux server runs through sh. These tests run it as tmux would, with
# a stub claude that prints its own path and the variables the harness sets or drops. Only those: a
# failing test prints its output, and the rest of the owner's environment can hold keys.
write_env_dumping_claude() { # write_env_dumping_claude <path>
  mkdir -p "$(dirname "$1")"
  printf '#!/bin/sh\necho "BIN=$0"\nenv | grep -E "^(CLAUDE|ANTHROPIC|THRIFT_HOME=|PATH=)" || true\n' > "$1"
  chmod +x "$1"
}

run_claude_command() { # run_claude_command <env assignments...> -- <bash-snippet>
  local assignments=()
  while [[ "$1" != -- ]]; do assignments+=("$1"); shift; done
  shift
  EXIT_CODE=0
  hermetic_env PATH="$TEST_DIR/bin:$JQ_DIR:/usr/bin:/bin" HOME="$TEST_DIR/home" TMPDIR="$TEST_DIR/tmp" LIVE_DIR="$LIVE_DIR" ${assignments[@]+"${assignments[@]}"} \
    "$BASH" --noprofile --norc -c 'set -euo pipefail; source "$LIVE_DIR/lib.sh"; '"$1" > "$OUTPUT" 2>&1 || EXIT_CODE=$?
}

# assert_dir_lacks <text> <dir>: no file under the directory holds the text. grep's exit status must be
# exactly 1 (no match): 2 means it could not read the directory, which is not proof of absence.
assert_dir_lacks() {
  local status=0
  grep -rqa -- "$1" "$2" || status=$?
  ((status == 1)) || fail "the run directory holds the text, or grep could not read it (status $status)"
}
