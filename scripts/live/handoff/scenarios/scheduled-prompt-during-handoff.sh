#!/usr/bin/env bash
# #95 (C8.3 of #43): a scheduled prompt that fires while a handoff holds prompts is carried with the note
# and stays unattended. The proof is the first strong turn end after it: a scheduled turn hands off on a
# strong signal in every mode but `off`, where a person's turn in `ask` only gets a band. In `act` a
# person's turn hands off too, so the check reads the turn end's `handoff_unattended`, not just `cleared`.
#
# The prompt is a real cron job, not a faked origin. A session schedules a one-shot cron job (CronCreate)
# for a minute a minute or two ahead; the engine logs the exact fire time ("[ScheduledTasks] scheduled
# <id> for <ts>"), and the scenario types /handoff a few seconds before it, so the job fires while the
# note is written and the compaction runs. The engine then calls prompt.submit with origin
# `scheduled-trigger`, and the plugin holds it.
#
# A strong signal needs a finished task in the turn (`git push` that succeeds) and a context over the
# threshold. The push goes to a local bare repository made for the run. The threshold is above the old
# session's context (so its turn ends are quiet in `act`, which would compact) and below what the fresh
# session reaches once the scheduled turn has printed three long outputs.
#
# Not driven: two peer messages queued behind one running turn (C9.2). The plugin matches the queue by
# turn text, so order no longer matters to it, and a second peer session would double the run time.
#
# Preconditions that are not met are ERRORs (the job fired outside the handoff, the turn end was not
# strong), never FAILs and never PASSes.

THRESHOLD=50000
# Seconds before the job's fire time at which /handoff is typed. The note and the compaction take about
# 20 s, so the job fires well inside them.
HANDOFF_LEAD=6
SCHEDULE_AHEAD=80
SCHEDULED_TOKEN=SCHEDTOKEN

scenario_run() {
  handoff_prepare "{\"compactBeforeClear\": true, \"handoffContextTokens\": $THRESHOLD}"
  PUSH_REPO=$(make_push_repo)
  run_mode ask a
  run_mode act b
}

# make_push_repo: a work repository with a bare remote, so `git push origin main` succeeds, and prints its
# path with no `.` or `//` in it, so the model types it as the permission rule spells it. The commit is made
# with plumbing (commit-tree), which signs nothing; the repository is a fixture, not anyone's history. Both
# repositories take their hooks from an empty directory, so no hook from the owner's global config or
# init template runs when the session pushes.
make_push_repo() {
  local dir="$LIVE_RUN/push-fixture" tree commit
  mkdir -p -- "$dir/no-hooks"
  git init -q --bare "$dir/remote.git"
  git init -q "$dir/work"
  git -C "$dir/remote.git" config core.hooksPath "$dir/no-hooks"
  git -C "$dir/work" config core.hooksPath "$dir/no-hooks"
  git -C "$dir/work" remote add origin ../remote.git
  tree=$(git -C "$dir/work" mktree </dev/null)
  commit=$(GIT_AUTHOR_NAME=live GIT_AUTHOR_EMAIL=live@example.invalid GIT_COMMITTER_NAME=live GIT_COMMITTER_EMAIL=live@example.invalid \
    git -C "$dir/work" commit-tree "$tree" -m fixture)
  git -C "$dir/work" update-ref refs/heads/main "$commit"
  git -C "$dir/work" symbolic-ref HEAD refs/heads/main
  (cd -- "$dir/work" && pwd -P)
}

# epoch_of <iso-utc>: the log's fire time, with or without fractional seconds, as epoch seconds (BSD or GNU date).
epoch_of() {
  local ts=${1%Z}
  ts=${ts%.*}
  date -j -u -f '%Y-%m-%dT%H:%M:%S' "$ts" +%s 2>/dev/null || date -u -d "${ts}Z" +%s
}
cron_fields() { date -r "$1" '+%M %H %d %m *' 2>/dev/null || date -d "@$1" '+%M %H %d %m *'; }

# set_mode <mode>: the plugin's mode for the sessions started after this.
set_mode() {
  jq --arg mode "$1" '.pluginConfigs["handoff@inline"].options.handoffMode = $mode' "$LIVE_RUN/settings.json" >"$LIVE_RUN/settings.json.new"
  mv -- "$LIVE_RUN/settings.json.new" "$LIVE_RUN/settings.json"
}

# stop_session <name>: ends the session, so its scheduler lock and job go with it.
stop_session() { tmux kill-session -t "=$(session_of "$1")" 2>/dev/null || true; }

# schedule_prompt <name>: has the session schedule the one-shot job, and prints when it will fire (epoch seconds).
schedule_prompt() {
  local name=$1 target scheduled_prompt fire_ts
  target=$((($(date +%s) + SCHEDULE_AHEAD) / 60 * 60 + 60))
  scheduled_prompt="$SCHEDULED_TOKEN: run these Bash commands, one call each: git -C $PUSH_REPO push origin main; seq 1 6000; seq 6001 12000; seq 12001 18000. Then reply with the word done."
  submit "$name" "Use the CronCreate tool to schedule this prompt: \"$scheduled_prompt\" with cron \"$(cron_fields "$target")\", recurring false. Then reply with the word scheduled."
  wait_for "the cron job to be scheduled in '$name'" log_has "$name" '\[ScheduledTasks\] scheduled'
  fire_ts=$(grep -E '\[ScheduledTasks\] scheduled' "$(debug_log_of "$name")" | tail -n 1 | sed -E 's/.* for ([0-9T:.-]+Z).*/\1/')
  epoch_of "$fire_ts"
}

run_mode() {
  local mode=$1 name=$2 baseline fire after_handoff
  section "mode $mode"
  baseline=$(decision_lines)
  set_mode "$mode"
  handoff_start "$name" --allowedTools "CronCreate,ToolSearch,Bash(git -C $PUSH_REPO push *),Bash(seq *)"
  say_apple "$name"
  fire=$(schedule_prompt "$name")
  wait_for "the scheduling turn of '$name' to end" turns_done_above "$name" 1
  (($(date +%s) < fire - HANDOFF_LEAD)) || live_abort "the job fires less than ${HANDOFF_LEAD}s from now: the window is missed; run it again"
  while (($(date +%s) < fire - HANDOFF_LEAD)); do sleep "$LIVE_POLL"; done
  submit "$name" '/handoff'
  wait_for "the first handoff of '$name' to clear" first_handoff_cleared "$baseline"
  after_handoff=$(decision_lines)
  wait_for "the turn end after the carried prompt in '$name'" turn_end_record_after "$after_handoff"

  show_records_after "$baseline"
  show_log "$name" 'held a prompt|prompt\.submit|ScheduledTasks' 12
  show_pane "$name" "$mode, end of the run"

  [[ -n "$(first_cleared "$baseline")" ]] || live_abort 'no cleared record'
  first_cleared "$baseline" | jq -e '.trigger_values.held_groups >= 1' >/dev/null \
    || live_abort "the job did not fire inside the handoff (held_groups 0), so the run proves nothing; run it again"
  [[ "$(turn_end_field "$after_handoff" signal)" == strong ]] \
    || live_abort "the turn end after the carried prompt was '$(turn_end_field "$after_handoff" signal)', not strong (context $(turn_end_field "$after_handoff" context_tokens) against $THRESHOLD): the run proves nothing"

  check "[$mode] the handoff carried the scheduled prompt as an unattended group" \
    "the cleared record was: $(first_cleared "$baseline")" carried_unattended "$baseline"
  check "[$mode] the carried prompt was submitted in the fresh session" \
    "the cleared record was: $(first_cleared "$baseline"); the log has no plugin submit of the prompt" carried_prompt_submitted "$baseline" "$name"
  check "[$mode] the strong turn end after it handed off, as a scheduled turn does" \
    "the turn end record was: $(turn_end_record "$after_handoff")" turn_end_handed_off "$after_handoff"
  stop_session "$name"
}

first_cleared() { records_after "$1" '.action == "cleared"' | head -n 1; }
first_handoff_cleared() { [[ -n "$(first_cleared "$1")" ]]; }
turn_end_record() { records_after "$1" '.trigger_values.point == "turn-end"' | head -n 1; }
turn_end_record_after() { [[ -n "$(turn_end_record "$1")" ]]; }
turn_end_field() { turn_end_record "$1" | jq -r ".trigger_values.$2"; }
show_records_after() {
  section "decision records written in this mode"
  records_after "$1" 'true' | cut -c 1-420
}

carried_unattended() {
  first_cleared "$1" | jq -e '.trigger_values | select(.held_groups == 1 and .held_unattended == true and .handoff_unattended == false)' >/dev/null
}
carried_prompt_submitted() {
  first_cleared "$1" | jq -e '.trigger_values | select(.held_other_delivery == "submitted")' >/dev/null \
    && log_has "$2" "prompt\\.submit \\(handoff\\): \"$SCHEDULED_TOKEN"
}
# In `act` a person's strong turn end hands off too; handoff_unattended is what says the turn was the scheduled one.
turn_end_handed_off() { turn_end_record "$1" | jq -e 'select(.action == "cleared" and .trigger_values.handoff_unattended == true)' >/dev/null; }
