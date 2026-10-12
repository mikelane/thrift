#!/usr/bin/env bash
# Regression harness for the canary path in .github/workflows/ci.yml: the "open canary issues"
# (`report`) job and the `scripts/check.sh` run that feeds it.
#
# The `report` job checks out nothing, so its script has to stay inline in ci.yml. The harness
# pulls the real step scripts out of ci.yml and runs each under the shell Actions gives it: the
# report step declares `shell: bash`, so `bash -eo pipefail`, and the others have no `shell:` key,
# so `bash -e`. Extraction fails if a step gains or changes a key the harness does not model. A stub
# `gh`, a stub `claude` and a stub `tsc` stand in for the real tools. No network and no API key.
#
# This entry point runs every .github/tests/*.test.sh, so a new test file needs no wiring. See
# canary-report-lib.sh for what a test file gets.
#
# Usage: .github/tests/canary-report.sh [name-fragment]   (runs the tests whose name contains it)
set -uo pipefail
unset CDPATH

HARNESS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
test_files=("$HARNESS_DIR"/*.test.sh)
[[ -e "${test_files[0]}" ]] || { echo "No *.test.sh file found in $HARNESS_DIR." >&2; exit 2; }

# The output of each test file is also kept in $output_copy. A file that never calls run_tests exits 0
# without a "N of M passed" line, which a plain exit status cannot tell from a file that passed.
output_copy=$(mktemp) || { echo 'mktemp failed, so the entry point has nowhere to keep test output.' >&2; exit 2; }
trap 'rm -f "$output_copy"' EXIT

overall=0 ran_any=0
for test_file in "${test_files[@]}"; do
  status=0
  "$BASH" "$test_file" "$@" | tee "$output_copy" || status=$?
  case "$status" in
    0)
      ran_any=1
      if [[ "$#" -eq 0 ]] && ! grep -qE '^[0-9]+ of [1-9][0-9]* passed$' "$output_copy"; then
        echo "${test_file##*/} ran no tests: it printed no 'N of M passed' line. End it with: run_tests \"\$@\"" >&2
        [[ "$overall" -ge 1 ]] || overall=1
      fi ;;
    4) [[ "$#" -gt 0 ]] || { ran_any=1; overall=4; } ;;  # 4 is "no test matches the fragment" only when there is a fragment
    *) ran_any=1; [[ "$overall" -ge "$status" ]] || overall=$status ;;
  esac
done
if [[ "$ran_any" == 0 ]]; then
  echo "No tests ran. No test name contains '${1:-}'." >&2
  exit 1
fi
exit "$overall"
