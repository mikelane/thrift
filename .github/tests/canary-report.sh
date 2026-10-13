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
# No -e: each test file's status is collected below, and a failing file must not stop the rest.
set -uo pipefail
unset CDPATH

HARNESS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
test_files=("$HARNESS_DIR"/*.test.sh)
[[ -e "${test_files[0]}" ]] || { echo "No *.test.sh file found in $HARNESS_DIR." >&2; exit 2; }

# The output of each test file is also kept in $output_copy. A file that never calls run_tests exits 0
# without a "N of M passed" line, which a plain exit status cannot tell from a file that passed.
output_copy=$(mktemp) || { echo 'mktemp failed, so the entry point has nowhere to keep test output.' >&2; exit 2; }
trap 'rm -f "$output_copy"' EXIT

overall_status=0 did_any_file_run=0
for test_file in "${test_files[@]}"; do
  file_status=0
  "$BASH" "$test_file" "$@" | tee "$output_copy" || file_status=$?
  case "$file_status" in
    0)
      did_any_file_run=1
      if ! grep -qE '^[0-9]+ of [1-9][0-9]* passed$' "$output_copy"; then
        echo "${test_file##*/} ran no tests: it printed no 'N of M passed' line. End it with: run_tests \"\$@\"" >&2
        [[ "$overall_status" -ge 1 ]] || overall_status=1
      fi ;;
    4)  # 4 is "no test matches the fragment" only when there is a fragment
      [[ "$#" -gt 0 ]] || {
        echo "${test_file##*/} exited 4, which means no test matched, yet no name fragment was given. It defines no test_* function." >&2
        did_any_file_run=1; overall_status=4
      } ;;
    *)
      echo "${test_file##*/} failed with exit status $file_status. See its output above: 1 lists the failed tests, 2 means the harness could not set up." >&2
      did_any_file_run=1; [[ "$overall_status" -ge "$file_status" ]] || overall_status=$file_status ;;
  esac
done
if [[ "$did_any_file_run" == 0 ]]; then
  echo "No tests ran. No test name contains '${1:-}'." >&2
  exit 1
fi
exit "$overall_status"
