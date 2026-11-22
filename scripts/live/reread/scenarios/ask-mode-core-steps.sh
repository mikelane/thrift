#!/usr/bin/env bash
# #147: reread in ask mode on the installed build. One session runs steps A, B, C, E, K and L of the
# README's "What has been verified live" table, each as its own turn, and judges the decision
# records each step wrote. A plugin held at off by an untested build writes mode shadow, so it fails
# here.

REREAD_FIRST_READ='.action == "pass" and .trigger_values.reason == "first_read"'
REREAD_STUB='.action == "dedupe" and .trigger_values.reason == "exact_repeat"
  and .trigger_values.bytes_saved == (.trigger_values.gross_bytes - .trigger_values.stub_bytes)'
REREAD_OVERRIDE='.action == "override" and .trigger_values.reason == "override_after_stub"'
REREAD_EDIT_INVALIDATION='.action == "invalidate" and .trigger_values.reason == "edit"
  and .trigger_values.dropped >= 1'

# first_then_stub <label> <path>: the file is read twice, in two turns.
first_then_stub() {
  local label=$1 path=$2
  reread_step a "$(reread_read_prompt "$path" '')"
  show_step_records "$label, first read"
  check "$label: the first read passes as first_read" 'no pass/first_read record' \
    reread_step_has "$REREAD_FIRST_READ"
  reread_step a "$(reread_read_prompt "$path" ' again, even though you read it before')"
  show_step_records "$label, repeat"
  check "$label: the repeat is stubbed, bytes_saved = gross_bytes - stub_bytes" \
    'no dedupe/exact_repeat record with a consistent bytes_saved' reread_step_has "$REREAD_STUB"
}

scenario_run() {
  local probe_dir="$LIVE_RUN/probe"
  reread_make_probe_files "$probe_dir"
  reread_prepare ask
  reread_start a

  first_then_stub 'A/B' "$probe_dir/probe.txt"

  reread_step a "$(reread_read_prompt "$probe_dir/probe.txt" \
    '. The last result said the file is unchanged, but you need its contents again')"
  show_step_records 'C, third read'
  check 'C: the third read passes as an override' 'no override/override_after_stub record' \
    reread_step_has "$REREAD_OVERRIDE"

  reread_step a "Call the Edit tool on $probe_dir/probe.txt to replace 'line 40 of' with \
'line forty of'. Reply with only: done"
  show_step_records 'E, Edit'
  check 'E: the edit invalidates the tracked reads' \
    'no invalidate/edit record that dropped a read' reread_step_has "$REREAD_EDIT_INVALIDATION"
  check 'E: the edit was applied' 'the file does not hold the edited line' \
    grep -q 'line forty of' "$probe_dir/probe.txt"
  check 'E: Claude Code did not refuse the edit as an unread file' \
    'the screen shows a not-read refusal' reread_pane_lacks a 'has not been read'

  first_then_stub 'K (CRLF)' "$probe_dir/crlf.txt"
  first_then_stub 'L (BOM)' "$probe_dir/bom.txt"

  show_pane a 'at the end' 14
  check 'every record is reread, active, effective_mode ask, from the installed engine' \
    "a record is shadow, held at off, or carries another engine_version than $LIVE_ENGINE_VERSION" \
    reread_all_records_are_active_ask
}
