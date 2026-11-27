#!/usr/bin/env bash
# release_merge_run_record_verdict: how the pr-record of a CI run is read, and the temp files it leaves.
# Usage: release-merge-record-check.test.sh [name-fragment]   (runs the tests whose name contains it)
# shellcheck source=canary-report-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/canary-report-lib.sh"
# shellcheck source=release-merge-stubs-lib.sh
source "$HARNESS_DIR/release-merge-stubs-lib.sh"

# record_check <run-id>: "<code> <reason>" from release_merge_run_record_verdict for PR 111 into
# main, run with pipefail as the workflow step runs it. The reason is read in the same shell.
record_check() {
  stub_gh
  (
    set -o pipefail
    release_merge_run_record_verdict "$REPO" "$1" 111 main && code=0 || code=$?
    # shellcheck disable=SC2154 # set by release_merge_run_record_verdict in the lib
    echo "$code $release_merge_run_record_detail"
  )
}

# assert_record_check <run-id> <expected "<code> <reason>">
assert_record_check() {
  local got
  got=$(record_check "$1" 2>"$TEST_DIR/record-err")
  [[ "$got" == "$2" ]] || fail "got [$got], expected [$2]"
}

test_the_record_check_returns_0_when_the_record_names_the_pr_into_main() {
  write_record 7 111
  assert_record_check 7 '0 '
}

test_the_record_check_returns_1_with_no_run_id() {
  assert_record_check '' '1 is unknown (no run id)'
}

test_the_record_check_returns_3_when_the_run_has_no_artifacts() {
  write_record 7 none
  assert_record_check 7 '3 has no pr-record artifact'
}

# The zip would name the PR, so only the expired flag keeps the artifact from counting.
test_the_record_check_returns_3_when_the_only_pr_record_has_expired() {
  write_record 7 111
  write_artifact_pages 7 "{\"artifacts\":[$(artifact_entry 5007 pr-record true)]}"
  assert_record_check 7 '3 has no pr-record artifact'
}

# The expired artifact has the higher id and names another PR: reading it would refuse the PR.
test_the_record_check_returns_0_from_the_unexpired_record_when_a_newer_one_has_expired() {
  write_record 7 111
  write_raw_record 5008 '{"number":999,"base":"main"}'
  write_artifact_pages 7 "{\"artifacts\":[$(artifact_entry 5007),$(artifact_entry 5008 pr-record true)]}"
  assert_record_check 7 '0 '
}

# Listed highest id first, so taking the last entry as listed would read the other PR's record.
test_the_record_check_returns_0_from_the_highest_id_of_two_unexpired_records() {
  write_record 7 111
  write_raw_record 5006 '{"number":999,"base":"main"}'
  write_artifact_pages 7 "{\"artifacts\":[$(artifact_entry 5007),$(artifact_entry 5006)]}"
  assert_record_check 7 '0 '
}

# The zip would name the PR, so only the name check keeps the artifact from counting.
test_the_record_check_returns_3_when_the_only_artifact_has_another_name() {
  write_record 7 111
  write_artifact_pages 7 "{\"artifacts\":[$(artifact_entry 5007 coverage)]}"
  assert_record_check 7 '3 has no pr-record artifact'
}

# `gh api --paginate` prints one JSON object per page; the record is only on page 2.
test_the_record_check_returns_0_when_the_record_is_on_the_second_page_of_artifacts() {
  write_record 7 111
  write_artifact_pages 7 \
    "{\"total_count\":2,\"artifacts\":[$(artifact_entry 5006 coverage)]}" \
    "{\"total_count\":2,\"artifacts\":[$(artifact_entry 5007)]}"
  assert_record_check 7 '0 '
}

test_the_record_check_returns_2_when_the_artifact_list_is_not_json() {
  write_artifact_pages 7 'not json'
  assert_record_check 7 '2 cannot list the artifacts of CI run 7'
}

test_the_record_check_returns_2_when_the_artifact_list_cannot_be_fetched() {
  write_record 7 111
  : >"$TEST_DIR/artifacts-7.error"
  assert_record_check 7 '2 cannot list the artifacts of CI run 7'
}

test_the_record_check_returns_2_when_the_record_cannot_be_downloaded() {
  write_record 7 111
  : >"$TEST_DIR/record-5007.error"
  assert_record_check 7 '2 cannot download the pr-record (artifact 5007) of CI run 7'
}

# An empty PATH also hides gh and jq, so the message is what shows the unzip check fired.
test_the_record_check_returns_2_and_names_unzip_when_unzip_is_missing() {
  local got
  write_record 7 111
  mkdir "$TEST_DIR/empty-path"
  # shellcheck disable=SC2123 # an empty PATH is the point: unzip must not be found
  got=$(stub_gh; PATH=$TEST_DIR/empty-path
    release_merge_run_record_verdict "$REPO" 7 111 main 2>"$TEST_DIR/record-err" && echo 0 || echo $?)
  [[ "$got" == 2 ]] || fail "got [$got]"
  assert_file_has "$TEST_DIR/record-err" "unzip is not installed, so the pr-record of CI run 7 cannot be read"
}

# record_check_mktemp_template <work_dir>: the template the record check passes to mktemp ("" leaves
# work_dir unset).
record_check_mktemp_template() {
  write_record 7 111
  mkdir -p "$TEST_DIR/work"
  (
    stub_gh
    mktemp() { echo "$1" >"$TEST_DIR/mktemp-template"; command mktemp "$@"; }
    if [[ -n "$1" ]]; then work_dir=$1; else unset work_dir; fi
    TMPDIR=$TEST_DIR/tmpdir
    release_merge_run_record_verdict "$REPO" 7 111 main
  ) >/dev/null 2>&1
  echo "$(<"$TEST_DIR/mktemp-template")"
}

test_the_record_check_makes_its_zip_temp_file_under_work_dir_when_it_is_set() {
  local got
  got=$(record_check_mktemp_template "$TEST_DIR/work")
  [[ "$got" == "$TEST_DIR/work/pr-record."* ]] || fail "got [$got]"
}

test_the_record_check_makes_its_zip_temp_file_under_tmpdir_when_work_dir_is_unset() {
  local got
  mkdir -p "$TEST_DIR/tmpdir"
  got=$(record_check_mktemp_template '')
  [[ "$got" == "$TEST_DIR/tmpdir/pr-record."* ]] || fail "got [$got]"
}

test_the_record_check_returns_1_when_the_zip_holds_no_pr_record_json() {
  write_record 7 111
  write_raw_record 5007 '{"number":111,"base":"main"}' other.json
  assert_record_check 7 '1 has an unreadable pr-record'
}

test_the_record_check_returns_1_when_the_record_is_empty() {
  write_record 7 111
  write_raw_record 5007 ''
  assert_record_check 7 '1 has an unreadable pr-record'
}

test_the_record_check_returns_1_when_the_record_number_is_a_string() {
  write_record 7 111
  write_raw_record 5007 '{"number":"111","base":"main"}'
  assert_record_check 7 '1 has an unreadable pr-record'
}

test_the_record_check_returns_1_when_the_record_has_no_base() {
  write_record 7 111
  write_raw_record 5007 '{"number":111}'
  assert_record_check 7 '1 has an unreadable pr-record'
}

test_the_record_check_returns_1_when_the_record_is_not_an_object() {
  write_record 7 111
  write_raw_record 5007 '[111,"main"]'
  assert_record_check 7 '1 has an unreadable pr-record'
}

test_the_record_check_returns_1_when_the_record_is_not_json() {
  write_record 7 111
  write_raw_record 5007 '{"number":111,"base":"main"} trailing'
  assert_record_check 7 '1 has an unreadable pr-record'
}

# jq reads every document, so a record holding the right one and a second would pass as either.
test_the_record_check_returns_1_when_the_record_holds_two_documents() {
  write_record 7 111
  write_raw_record 5007 '{"number":999,"base":"main"}{"number":111,"base":"main"}'
  assert_record_check 7 '1 has an unreadable pr-record'
}

# Only the first 4096 bytes are read, so a longer record is cut mid-string and does not parse.
test_the_record_check_returns_1_when_the_record_is_longer_than_4096_bytes() {
  local padding
  padding=$(printf '%5000s' '' | tr ' ' x)
  write_record 7 111
  write_raw_record 5007 "{\"number\":111,\"base\":\"main\",\"pad\":\"$padding\"}"
  assert_record_check 7 '1 has an unreadable pr-record'
}

# spaces <n>: n spaces.
spaces() { printf "%${1}s" ''; }

# Cutting the record at 4096 bytes is not the same as refusing it: when the cut lands after a
# complete document, what is left would parse.
test_the_record_check_returns_1_when_a_record_longer_than_4096_bytes_ends_in_garbage() {
  write_record 7 111
  write_raw_record 5007 "{\"number\":111,\"base\":\"main\"}$(spaces 4100)garbage"
  assert_record_check 7 '1 has an unreadable pr-record'
}

test_the_record_check_returns_1_when_a_second_document_starts_past_byte_4096() {
  write_record 7 111
  write_raw_record 5007 "{\"number\":111,\"base\":\"main\"}$(spaces 4100){\"number\":999,\"base\":\"main\"}"
  assert_record_check 7 '1 has an unreadable pr-record'
}

test_the_record_check_returns_1_and_names_the_record_when_it_names_another_base() {
  write_record 7 111@old-feature
  assert_record_check 7 '1 has a pr-record naming {"number":111,"base":"old-feature"}'
}

test_the_record_check_returns_1_and_names_the_record_when_it_names_another_pr() {
  write_record 7 999
  assert_record_check 7 '1 has a pr-record naming {"number":999,"base":"main"}'
}

# gh exits 0 but the open-PR list is not JSON: the sweep names the failed lookup and fails.
test_a_sweep_names_an_unparseable_pr_list_as_the_failed_lookup() {
  local status
  stub_gh
  echo 'not json' >"$TEST_DIR/pulls.json"
  release_merge_sweep "$REPO" main >"$TEST_DIR/sweep-out" 2>"$TEST_DIR/sweep-err"
  status=$?
  [[ "$status" != 0 ]] || fail 'the sweep succeeded on an unparseable PR list'
  assert_file_has "$TEST_DIR/sweep-err" '::error title=Release PR sweep failed::cannot list the open release PRs'
}

# write_padded_record <artifact> <pad-byte-hex> <total-bytes>: a pr-record.json holding a record that
# names PR 111 into main, padded with the byte <pad-byte-hex> to <total-bytes> bytes.
write_padded_record() {
  python3 -I -c '
import sys, zipfile
doc = b"{\"number\":111,\"base\":\"main\"}"
pad = bytes([int(sys.argv[2], 16)]) * (int(sys.argv[3]) - len(doc))
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.writestr("pr-record.json", doc + pad)
' "$TEST_DIR/record-$1.zip" "$2" "$3"
}

test_the_record_check_returns_0_for_a_record_of_exactly_4096_bytes() {
  write_record 7 111
  write_padded_record 5007 20 4096
  assert_record_check 7 '0 '
}

test_the_record_check_returns_0_for_a_record_of_4096_bytes_ending_in_a_newline() {
  write_record 7 111
  write_padded_record 5007 0a 4096
  assert_record_check 7 '0 '
}

test_the_record_check_returns_1_for_a_record_of_4097_bytes() {
  write_record 7 111
  write_padded_record 5007 20 4097
  assert_record_check 7 '1 has an unreadable pr-record'
}

test_the_record_check_returns_1_for_a_record_of_4097_newlines() {
  write_record 7 111
  write_padded_record 5007 0a 4097
  assert_record_check 7 '1 has an unreadable pr-record'
}

# Command substitution drops NUL bytes, so a record padded with NULs past 4096 bytes is measured
# after they are gone.
test_the_record_check_returns_1_for_a_record_padded_with_nul_bytes_past_4096() {
  write_record 7 111
  write_padded_record 5007 00 5000
  assert_record_check 7 '1 has an unreadable pr-record'
}

# record_check_leftovers <run-id> [failing-mktemp-call]: the files the record check leaves in work_dir
# for PR 111 into main, as the workflow step runs it. The optional argument makes that numbered mktemp
# call fail.
record_check_leftovers() {
  mkdir -p "$TEST_DIR/work"
  echo 0 >"$TEST_DIR/mktemp-calls"
  (
    stub_gh
    set -o pipefail
    work_dir=$TEST_DIR/work
    FAILING_MKTEMP_CALL=${2:-}
    mktemp() {
      local n; n=$(( $(<"$TEST_DIR/mktemp-calls") + 1 )); echo "$n" >"$TEST_DIR/mktemp-calls"
      [[ "$n" != "$FAILING_MKTEMP_CALL" ]] || return 1
      command mktemp "$@"
    }
    release_merge_run_record_verdict "$REPO" "$1" 111 main
  ) >/dev/null 2>&1
  ls -A "$TEST_DIR/work" | paste -sd, -
}

assert_record_check_leaves_no_temp_file() {
  local got
  got=$(record_check_leftovers "$@")
  [[ -z "$got" ]] || fail "left [$got]"
}

test_the_record_check_leaves_no_temp_file_when_the_record_names_the_pr() {
  write_record 7 111
  assert_record_check_leaves_no_temp_file 7
}

test_the_record_check_leaves_no_temp_file_when_the_record_names_another_pr() {
  write_record 7 999
  assert_record_check_leaves_no_temp_file 7
}

test_the_record_check_leaves_no_temp_file_when_the_record_is_longer_than_4096_bytes() {
  write_record 7 111
  write_padded_record 5007 20 4097
  assert_record_check_leaves_no_temp_file 7
}

test_the_record_check_leaves_no_temp_file_when_the_record_is_padded_with_nul_bytes() {
  write_record 7 111
  write_padded_record 5007 00 100
  assert_record_check_leaves_no_temp_file 7
}

test_the_record_check_leaves_no_temp_file_when_the_zip_is_corrupt() {
  write_record 7 corrupt
  assert_record_check_leaves_no_temp_file 7
}

test_the_record_check_leaves_no_temp_file_when_the_record_cannot_be_downloaded() {
  write_record 7 111
  : >"$TEST_DIR/record-5007.error"
  assert_record_check_leaves_no_temp_file 7
}

# A jq that skips NUL bytes would read a record padded with them as the plain record, so the check
# compares the byte count with the count after tr strips the NULs. This jq stand-in strips them first
# from the file it is given last.
test_the_record_check_returns_1_for_a_record_padded_with_nul_bytes_within_4096_even_when_jq_skips_them() {
  local got
  write_record 7 111
  write_padded_record 5007 00 100
  got=$(
    stub_gh
    jq() { if [[ "$1" == -sc ]]; then command jq "${@:1:$#-1}" < <(tr -d '\000' <"${*: -1}"); else command jq "$@"; fi; }
    release_merge_run_record_verdict "$REPO" 7 111 main 2>/dev/null && code=0 || code=$?
    echo "$code $release_merge_run_record_detail")
  [[ "$got" == '1 has an unreadable pr-record' ]] || fail "got [$got]"
}

test_the_record_check_returns_2_when_it_cannot_create_the_zip_temp_file() {
  write_record 7 111
  assert_record_check_with_failing_mktemp 1
}

test_the_record_check_returns_2_and_removes_the_zip_when_it_cannot_create_the_record_temp_file() {
  write_record 7 111
  assert_record_check_with_failing_mktemp 2
  assert_record_check_leaves_no_temp_file 7 2
}

# assert_record_check_with_failing_mktemp <n>: with the n-th mktemp call failing, the record check
# returns 2 and says it cannot create a temp file.
assert_record_check_with_failing_mktemp() {
  local got
  mkdir -p "$TEST_DIR/work"
  echo 0 >"$TEST_DIR/mktemp-calls"
  got=$(
    stub_gh
    # shellcheck disable=SC2034 # read by the lib
    work_dir=$TEST_DIR/work
    FAILING_MKTEMP_CALL=$1
    mktemp() {
      local n; n=$(( $(<"$TEST_DIR/mktemp-calls") + 1 )); echo "$n" >"$TEST_DIR/mktemp-calls"
      [[ "$n" != "$FAILING_MKTEMP_CALL" ]] || return 1
      command mktemp "$@"
    }
    release_merge_run_record_verdict "$REPO" 7 111 main >/dev/null 2>&1 && code=0 || code=$?
    echo "$code $release_merge_run_record_detail"
  )
  [[ "$got" == '2 cannot create a temp file for the pr-record of CI run 7' ]] || fail "got [$got]"
}

run_tests "$@"
