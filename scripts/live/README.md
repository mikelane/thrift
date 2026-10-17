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
dir="${XDG_CACHE_HOME:-$HOME/.cache}/thrift-live/cwd"
mkdir -p -- "$dir" && cd -- "$dir" && claude
```

Until then every scenario stops with ERROR at the trust dialog and prints this instruction.

Exit status: `0` PASS, `1` FAIL (the plugin misbehaved), `2` ERROR (the harness could not reach the
state it needed: a timeout, a missing tool, a missed timing window, the trust dialog, a scenario
that ran no checks, a decision log that exists but cannot be read as JSON lines, or any harness
command that failed before a verdict). A FAIL or ERROR keeps the run directory and prints its path:
`debug-<session>.log`, `thrift/decisions.jsonl`, `settings.json`, and the plugin copy.

A run can show home paths, transcript session ids and, in a pane excerpt, the welcome banner. Pipe
the output through the trimmer before pasting it into an issue or PR; it turns `$HOME` into `~` and
every UUID into `<session-id>`, and changes nothing else. Read the result once anyway.

```sh
scripts/live/live.sh handoff held-prompt-box 2>&1 | scripts/live/trim-output.sh
```

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
  binary; its effect was not tested. The working directory below is a dedicated one, reused on every
  run, and holds no project files; with `CLAUDE_CODE_DISABLE_AUTO_MEMORY` unverified, memory that
  earlier runs there wrote is the one thing it could carry.
- **Git context.** The working directory (see [Run it](#run-it)) is a dedicated directory outside
  any git work tree, so the system prompt carries no branch or status. `live.sh` checks this at
  start and stops with ERROR (exit 2) if the directory is inside a work tree, as it is when `$HOME`
  is a repository; set `LIVE_CWD` to move it.
- **Permission mode.** Every session runs with `--permission-mode dontAsk`, so it does not inherit the
  owner's mode (auto). `dontAsk` denies any tool the scenario did not allow with `--allowedTools`:
  the first session of `busy-abandon` may run `Bash(sleep *)`, the peer may use `ToolSearch` and
  `SendMessage`, and no other session may use any tool. `busy-abandon` was run under this and passes.
- **Inherited environment.** Each session's command first drops every `CLAUDE*` and `ANTHROPIC*`
  variable in the environment it receives (`CLAUDE_PID`, `CLAUDE_EFFORT`, `CLAUDE_CODE_EXECPATH`,
  `CLAUDE_CODE_VERSION`, the session and messaging ids, a tmux server's `ANTHROPIC_API_KEY`), so a
  run from inside Claude Code's Bash tool starts sessions like one from a terminal. It then sets the
  login and provider choice from the harness's own environment (`CLAUDE_CONFIG_DIR`,
  `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_USE_*`, `CLAUDE_CODE_SKIP_*_AUTH`, and every `ANTHROPIC_*`
  variable, such as an API key, a Vertex project or a base URL; the pattern is `LIVE_KEPT_ENV` in
  `session.sh`), not from a tmux server that was started earlier with other values. These values
  pass through an owner-only file in the run directory that the session deletes once read, so the
  OAuth token and any API key are never in the command text. The dropping happens inside the tmux
  session, so it also covers a tmux server that was started from a Claude Code session. What the
  dropped variables do to a session is unverified. The two `CLAUDE_CODE_DISABLE_*` variables above
  are set, not confirmed to work.
- **Which `claude`.** A new tmux session gets its environment from the tmux server, which may
  already be running with another `PATH`. The command runs `claude` by the absolute path that
  `live_require` found and passes the harness's own `PATH`, so the binary that was checked is the
  binary that runs.
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
- **Processes.** On exit the harness kills only the tmux sessions this run started, each by exact
  name (`live-<pid>-<nonce>-<label>`; the nonce is random per run, so a recycled pid cannot match a
  session an earlier run left behind), and never the tmux server. These all run the same cleanup:
  Ctrl-C, closing the terminal (SIGHUP), SIGTERM, Ctrl-\ (SIGQUIT), and a closed stdout pipe
  (`live.sh ... | head`, which sends SIGPIPE). While the cleanup runs it ignores further signals, so
  a second Ctrl-C cannot cut it short. A `kill -9` skips the cleanup: list leftovers with `tmux ls`
  and remove them by name. Background work a scenario starts inside a session (the `sleep 90` of
  `busy-abandon`) is not tracked by the harness and may outlive it: `pgrep -fl 'sleep 90'` finds
  one.

## Scenarios

### handoff

| Scenario | Tracks | Passes when |
|---|---|---|
| `held-prompt-box` | #56 | Three prompts typed during one handoff are delivered and the prompt box is empty afterwards. |
| `held-prompt-origin` | #55 | The three held prompts reach the fresh session's transcript (the one whose handoff note names the old session id) as one user entry marked `origin.asUser`, joined by blank lines, and the screen does not frame them "The handoff plugin sent a message". The turn's `cc_turn_origin` isn't checked: it is not `human` for an `asUser` prompt. |
| `peer-during-compaction` | #57 | A peer message that arrives while the old session compacts does not start a turn between the queued `/clear` and the clear. |
| `delivery-window-prompts` | #63 | Two prompts submitted 40 ms apart while the held prompt is delivered are each held and sent as typed (never joined as `fivesix`), and the box is empty afterwards. It polls every 5 ms to reach the window, which closes when the delivery ends, and reports ERROR if the second prompt misses it. |
| `busy-abandon` | #43 | A handoff whose wait ends with background work running stops with `background_busy`, puts the held prompt back in the box (`held_restore: in_box`), clears nothing, and leaves a compacted old-session transcript. |
| `restore-order-after-abandon` | #67 | Three prompts held during a wait that ends in a busy abandon come back to the box in typing order, before an unsent draft, as `held_restore: in_box`, and the draft is not sent. A prompt typed while the restore runs is not driven (the restore takes about 17 ms) and neither is an image prompt (a tmux session cannot attach one); the test kit covers both. |
| `clear-resume-during-handoff` | #67 | Four handoffs, one per case: a person's `/clear` and a `/resume` typed during the pre-clear compaction and during the wait for a running turn. Each ends with exactly one `cleared` (or `none` with `session_ended`) record that names the starting session and carries `effective_mode` ask, with no failure record, the session ending once per clear or resume that ran, and the note in exactly one transcript (never the resumed session's). A `/clear` during the compaction is queued behind the handoff's own clear (`cleared_by` handoff, `compacted_before_clear`); during the wait it is the person's (`cleared_by` person). The `/resume` cases print the path taken and judge only the invariants. |

`held-prompt-box`, `held-prompt-origin` and `delivery-window-prompts` fail on a build that has the
bug they track; once the fix is in they pass. `delivery-window-prompts` reproduced #63 in 4 of 15 runs on 2.1.302
before the fix, so a single PASS does not prove the fix holds.
`busy-abandon` passes on main: it guards the abandon path the fixes touch.

`peer-during-compaction` checks prevention: that no peer turn starts between the queued `/clear`
and the clear. #57 was fixed by detecting and reporting that turn instead (#62), so the scenario
still reports FAIL on a build with that fix. On such a build, the `cleared` record the scenario
prints carries `late_turn: true`, and the note in the fresh session ends with the "A turn ran in the
previous session" line. Those two are the evidence for #57; the scenario checks neither.

## How it works

- `live.sh` parses the arguments, loads `lib.sh` and `<plugin>/common.sh`, then the scenario file,
  and calls `scenario_run`.
- `lib.sh` holds the plugin-independent parts: the cleanup and signal handling, `wait_for`, `check`
  and the verdict. It sources `session.sh` (starting and answering tmux sessions, the keyboard) and
  `evidence.sh` (reading the pane, the prompt box, the debug log and the decision log), so a caller
  sources `lib.sh` alone.
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
