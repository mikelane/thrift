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

Before the first run, trust the harness's working directory yourself. Sessions start in
`$XDG_CACHE_HOME/thrift-live/cwd`, or `~/.cache/thrift-live/cwd` when `XDG_CACHE_HOME` is unset
(`LIVE_CWD` overrides both). Run `claude` there once, answer the trust prompt, and quit:

```sh
mkdir -p ~/.cache/thrift-live/cwd && cd ~/.cache/thrift-live/cwd && claude
```

Until then every scenario stops with ERROR at the trust dialog and prints this instruction.

Exit status: `0` PASS, `1` FAIL (the plugin misbehaved), `2` ERROR (the harness could not reach the
state it needed: a timeout, a missing tool, a missed timing window, the trust dialog, or any
harness command that failed before a verdict). A FAIL or ERROR keeps the run directory and prints
its path: `debug-<session>.log`, `thrift/decisions.jsonl`, `settings.json`, and the plugin copy.

Every wait is on a condition (pane text, a debug-log line, a decision record) with a
`LIVE_TIMEOUT` of 90 seconds, set in the environment to change it. The only fixed delay is the
0.25 s polling interval.

## What a run touches

Isolated, and how that was checked on 2.1.299 (`claude -p` probes from an empty directory):

- **User settings.** `--setting-sources project` keeps `~/.claude/settings.json`, user hooks and
  installed plugins out, and nothing writes them. It also kept `~/.claude/CLAUDE.md` out: a probe
  asked whether the model's instructions mention `merge-guardian` (a word only that file has) and it
  said no. The plugin's options come from a per-run `--settings` file.
- **Project CLAUDE.md.** `--setting-sources` does not cover it: a probe with a `CLAUDE.md` holding a
  marker word returned the word. `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` removed it (the probe returned
  NONE), and every session sets it.
- **Auto-memory.** Every session sets `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. The name is in the
  binary; its effect was not tested. The working directory below is new and empty, so it has no
  project memory in any case.
- **Git context.** The working directory (see [Run it](#run-it)) is an empty directory outside any
  git work tree, so the system prompt carries no branch or status.
- **Permission mode.** Every session runs with `--permission-mode dontAsk`, so it does not inherit the
  owner's mode (auto). `dontAsk` denies any tool the scenario did not allow with `--allowedTools`:
  the first session of `busy-abandon` may run `Bash(sleep *)`, the peer may use `ToolSearch` and
  `SendMessage`, and no other session may use any tool. `busy-abandon` was run under this and passes.
- **Decision log.** `THRIFT_HOME` points into the run directory, so
  `~/.claude/thrift/decisions.jsonl` is not written.
- **The plugin.** A scenario runs a copy of the plugin made in the run directory. The copy differs
  from the source in a few constants named in `handoff/common.sh` (the tested-through release, and
  the context-size minimum). The repository is not edited.

Not isolated:

- **Login.** Sessions use the owner's login and make real model calls. A throwaway
  `CLAUDE_CONFIG_DIR` would separate them, but it starts logged out ("Not logged in").
- **Peer messaging.** A peer session can `SendMessage` any of the owner's live sessions by name,
  not only the harness's own.
- **Advice, not enforcement.** Each session also gets an appended system prompt saying it is a test
  harness session that must do only what the typed prompt says. That is a request to the model.
- **`--safe-mode` cannot be used.** It would disable CLAUDE.md, but it also skips the `--plugin-dir`
  plugin's hooks ("Skipping plugin hooks - safe mode disables installed plugins"), which is the thing
  under test. `--bare` accepts only an API key, not the owner's login.
- **Trust.** Claude Code asks once whether to trust a new directory. The harness stops on that dialog
  and says so, because trusting a folder is the owner's decision: run `claude` in the working
  directory once and answer it (see [Run it](#run-it)). The harness answers only the external-CLAUDE.md-imports dialog, with
  its default (no).
- **Transcripts and history.** Real sessions write transcripts under `~/.claude/projects/` and
  append every prompt they receive to `~/.claude/history.jsonl`, as any session does. The harness
  has no switch for either; the prompts are one-word test prompts. `~/.claude.json` also gains an
  entry for the working directory, the trust answer, and Claude Code's usual per-session counters.
- **Processes.** On exit the harness kills only its own tmux sessions, each by exact name
  (`live-<pid>-<label>`), and never the tmux server. Interrupting it with Ctrl-C, closing the
  terminal (SIGHUP) or SIGTERM runs the same cleanup. A `kill -9` cannot: list leftovers with
  `tmux ls` and remove them by name. Background work a scenario starts inside a session (the
  `sleep 90` of `busy-abandon`) is not tracked by the harness and may outlive it:
  `pgrep -fl 'sleep 90'` finds one.

## Scenarios

### handoff

| Scenario | Tracks | Passes when |
|---|---|---|
| `held-prompt-box` | #56 | Three prompts typed during one handoff are delivered and the prompt box is empty afterwards. |
| `held-prompt-origin` | #55 | The turn that answers the held prompts has origin `human` and is not framed "The handoff plugin sent a message". |
| `peer-during-compaction` | #57 | A peer message that arrives while the old session compacts does not start a turn between the queued `/clear` and the clear. |
| `busy-abandon` | #43 | A handoff whose wait ends with background work running stops with `background_busy`, puts the held prompt back in the box (`held_restore: in_box`), clears nothing, and leaves a compacted old-session transcript. |

`held-prompt-box` and `held-prompt-origin` fail on a build that has the bug they track; once the
fix is in they pass. `busy-abandon` passes on main: it guards the abandon path the fixes touch.

`peer-during-compaction` checks prevention: that no peer turn starts between the queued `/clear`
and the clear. #57 was fixed by detecting and reporting that turn instead (#62), so the scenario
still reports FAIL on a build with that fix. The evidence for #57 is in the run: `late_turn: true`
on the `cleared` record, and the "A turn ran in the previous session" line at the end of the note.
The scenario does not check either.

## How it works

- `live.sh` parses the arguments, loads `lib.sh` and `<plugin>/common.sh`, then the scenario file,
  and calls `scenario_run`.
- `lib.sh` holds the plugin-independent parts: starting and answering tmux sessions, `wait_for`,
  reading the pane, the prompt box, the debug log and the decision log, and `check`.
- `<plugin>/common.sh`, when present, holds that plugin's setup and shared flows.
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
