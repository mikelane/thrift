# Live harness

Drives real `claude` sessions in tmux and judges what happened from three sources: the screen
(`tmux capture-pane`), the session's debug log, and the decision log. Each scenario prints PASS or
FAIL with the records, log lines and pane excerpts it used, so a run can be pasted into an issue.

**Local only.** It starts authenticated `claude` sessions and spends a few small turns of tokens per
run (one-word prompts; the peer session runs on Haiku). CI has no authenticated `claude`, so CI
never runs it and `scripts/check.sh` never touches it.

## Run it

```sh
scripts/live/live.sh handoff held-prompt-box            # one scenario
scripts/live/live.sh --list                             # every plugin and scenario
scripts/live/live.sh handoff busy-abandon --plugin-dir ~/dev/thrift/.worktrees/issue-56-x/plugins/handoff
scripts/live/live.sh handoff held-prompt-origin --keep  # keep the run directory
```

Needs `tmux`, `claude` (logged in), and `jq`. Runs on bash 3.2 and newer.

Exit status: `0` PASS, `1` FAIL (the plugin misbehaved), `2` ERROR (the harness could not reach the
state it needed: a timeout, a missing tool, a missed timing window). A FAIL or ERROR keeps the run
directory and prints its path: `debug-<session>.log`, `thrift/decisions.jsonl`, `settings.json`,
and the plugin copy.

Every wait is on a condition (pane text, a debug-log line, a decision record) with a
`LIVE_TIMEOUT` of 90 seconds, set in the environment to change it. The only fixed delay is the
0.25 s polling interval.

## What a run touches

- **Settings.** Sessions start with `--setting-sources project`, so the owner's
  `~/.claude/settings.json`, user hooks and installed plugins are not loaded, and nothing writes
  them. The plugin's options come from a per-run `--settings` file. A throwaway
  `CLAUDE_CONFIG_DIR` starts logged out ("Not logged in", checked on 2.1.299), so it cannot be used
  for a run that makes model calls; this replaces it.
- **Decision log.** `THRIFT_HOME` points into the run directory, so
  `~/.claude/thrift/decisions.jsonl` is not written.
- **The plugin.** A scenario runs a copy of the plugin made in the run directory. The copy differs
  from the source in a few constants named in `handoff/common.sh` (the tested-through release, and
  the context-size minimum). The repository is not edited.
- **Working directory.** Sessions start in `.live/cwd` under the repository (gitignored), an empty
  directory. Claude Code keeps per-directory answers in `~/.claude.json`. The harness answers only
  the external-CLAUDE.md-imports dialog, with its default (no). It stops with instructions on any
  other dialog, such as the workspace trust prompt: run `claude` in `.live/cwd` once and answer it.
- **Transcripts.** Real sessions write transcripts under `~/.claude/projects/`, as any session does.

## Scenarios

### handoff

| Scenario | Tracks | Passes when |
|---|---|---|
| `held-prompt-box` | #56 | Three prompts typed during one handoff are delivered and the prompt box is empty afterwards. |
| `held-prompt-origin` | #55 | The turn that answers the held prompts has origin `human` and is not framed "The handoff plugin sent a message". |
| `peer-during-compaction` | #57 | A peer message that arrives while the old session compacts does not start a turn between the queued `/clear` and the clear. |
| `busy-abandon` | #43 | A handoff whose wait ends with background work running stops with `background_busy`, puts the held prompt back in the box (`held_restore: in_box`), clears nothing, and leaves a compacted old-session transcript. |

`held-prompt-box`, `held-prompt-origin` and `peer-during-compaction` fail on a build that has the
bug they track; once the fix is in they pass. `busy-abandon` passes on main: it guards the abandon
path the three fixes touch.

## How it works

- `live.sh` parses the arguments, loads `lib.sh` and `<plugin>/common.sh`, then the scenario file,
  and calls `scenario_run`.
- `lib.sh` holds the plugin-independent parts: starting and answering tmux sessions, `wait_for`,
  reading the pane, the prompt box, the debug log and the decision log, and `check`.
- `<plugin>/common.sh` holds that plugin's setup and shared flows.
- `<plugin>/scenarios/<name>.sh` defines `scenario_run`, which drives the sessions, prints its
  evidence with the `show_*` helpers, and states its verdict with `check`.

Typing is two steps on purpose: the text goes in with `send-keys -l`, the harness waits until the
box shows it, and only then presses Enter. Enter sent in the same call as a long text is read as
part of a paste and ignored.

### Peer sessions

A second `claude` session with no plugin plays the peer. It is first asked to load the
`SendMessage` tool (a model round trip of its own), then given the instruction to send the first
session a message, typed but not submitted. The scenario presses Enter at the moment it needs the
message to arrive. A scenario aborts with ERROR, not FAIL, if the message lands outside the window
it is testing; run it again.

### Adding a scenario

Add `scripts/live/<plugin>/scenarios/<name>.sh` defining `scenario_run`. Sessions are named by a
short label (`a`, `b`); every helper takes it as the first argument. Finish with one or more
`check <name> <detail> <command...>`. A check is PASS when its command succeeds.
