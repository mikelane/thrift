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

Every session's terminal is 120 columns by 40 rows. `LIVE_COLUMNS` (a whole number) sets the width, for a
scenario that tests a width-dependent layout (`meter placement`); a scenario sets it before `live_start`.

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
- **Per-scenario variables.** A scenario can set `LIVE_SESSION_ENV` (`NAME=value` words separated by
  spaces, tabs or newlines, so a value holds none of them) for the sessions it starts next, as
  `subagents-during-handoff` does with `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` for its
  foreground-agent session. It is empty by default. The values travel in the owner-only file with the
  login, not in the command text. A word that is not `NAME=value`, or that names a variable the
  harness sets (a kept login or provider variable, `PATH`, `THRIFT_HOME`, or the two switches above),
  stops the run, even when the harness's shell has no value for it.
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
| `clear-resume-during-handoff` | #67 | Four handoffs, one per case: a person's `/clear` and a `/resume` typed during the pre-clear compaction and during the wait for a running turn. Each ends with exactly one `cleared` (or `none` with `session_ended`) record that names the starting session and carries `effective_mode` ask, with no failure record, the session ending once per clear or resume that ran, and the note in exactly one transcript (never the resumed session's or the old session's own); a `/resume` that ends the handoff as `session_ended` runs no clear and carries no note, so the session ends once and no transcript holds the note. A `/clear` during the compaction is queued behind the handoff's own clear (`cleared_by` handoff, `compacted_before_clear`); during the wait it is the person's (`cleared_by` person). In the two compaction cases, the compaction's end line must first show in the debug log after the command was typed, so a command that lands only after the compaction, or a run whose log never shows the end, is a FAIL. The `/resume` cases print the path taken and judge only the invariants. |
| `subagents-during-handoff` | #94 | Three sessions with the Agent tool allowed. (1) A background agent still running when `/handoff` is typed: the turn that started it ends with `is_background_busy: true`, the handoff clears, the fresh session's note carries the turn-after-note line, and the agent's task notification starts a turn in the fresh session. (2) A hand-off press made while the turn that starts a background agent runs is held by the engine, then refused as busy at turn end (`none`, `background_busy`, from a button), nothing clears, and the band offers no hand-off. The press cannot land while only the subagent runs: the band offers hand-off only when idle, and is redrawn without it once the agent is listed. (3) A foreground agent during a handoff's wait (the session runs with `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`, because the Agent tool on 2.1.302 always backgrounds and has no `run_in_background` parameter): the subagent finishes inside the main turn, and the clear lands after the main turn ended. A named teammate (C13.3) is not driven. |
| `scheduled-prompt-during-handoff` | #95 | A real one-shot cron job (`CronCreate`) fires while a handoff writes its note and compacts. The cleared record has `held_groups: 1`, `held_unattended: true`, `handoff_unattended: false` and `held_other_delivery: submitted`, the fresh session's log shows the plugin's submit of the prompt, and the strong turn end after it (a successful `git push` to a local bare repository, over the threshold) ends in a `cleared` record with `handoff_unattended: true`, not an `advised` one, in `ask` and in `act` (in `act` a person's strong turn end is `cleared` too, so the flag is what tells them apart). An ERROR, not a FAIL, when the job fires outside the handoff or the turn end is not strong. Not driven: two peer messages queued behind a running turn (C9.2). |

`held-prompt-box`, `held-prompt-origin` and `delivery-window-prompts` fail on a build that has the
bug they track; once the fix is in they pass. `delivery-window-prompts` reproduced #63 in 4 of 15 runs on 2.1.302
before the fix, so a single PASS does not prove the fix holds.
`busy-abandon` passes on main: it guards the abandon path the fixes touch.

`peer-during-compaction` checks prevention: that no peer turn starts between the queued `/clear`
and the clear. #57 was fixed by detecting and reporting that turn instead (#62), so the scenario
still reports FAIL on a build with that fix. On such a build, the `cleared` record the scenario
prints carries `late_turn: true`, and the note in the fresh session ends with the "A turn ran in the
previous session" line. Those two are the evidence for #57; the scenario checks neither.

### meter

The meter pane is drawn by the engine, so most of these read the screen. Scenarios 2 to 4 and 7 run in a
fullscreen session (`LIVE_SESSION_ENV='CLAUDE_CODE_NO_FLICKER=1'`), because the main-screen layout draws the
pane inline, clipped to about a third of the terminal, and cuts it off above the `TOP CONTEXT` header that
holds the age label. `placement` sets `LIVE_COLUMNS` per cell. `common.sh` copies the plugin unchanged: meter has
no thresholds to lower.

| Scenario | Tracks | Passes when |
|---|---|---|
| `toggle` | #121 item 1 | In a fullscreen session and again on the main screen, `/meter` replies `Meter opened.` and the screen shows the pane's `CONTEXT` row and the close button of its frame (`╭──✕─╮` inline, `│  ✕` docked); fullscreen also shows `TOP CONTEXT`. A second `/meter` replies `Meter closed.` and the `CONTEXT` row and the frame are gone. 2.1.311 draws no `meter` title, so the frame is judged by its button. |
| `redraw-after-turn` | #121 item 2 | Before any prompt the `CONTEXT` row reads `waiting for first response`; after a one-word turn it reads `<tokens> / <window>` (`[0-9]+k? / [0-9]+k`) and no longer waits. |
| `refresh-focus` | #121 item 3 | With the pane open and its age label at 1s or more (open, wait 2 s, run a turn), `r` typed in the composer reaches the box, writes no `ui.press meter/refresh` line to the debug log, and leaves the label alone. After ctrl+x tab, `r` writes one `ui.press meter/refresh` line and the label reads `0s ago`. |
| `refresh-command` | #121 item 4 | With the label at 1s or more, `/meter refresh` replies `Meter refreshed.` and the label reads `0s ago`. After `/meter` closes the pane, `/meter refresh` replies `Meter opened.` and the pane is back. |
| `clear` | #121 item 7 | No expected outcome for the pane. After a turn that lifts COST above `$0.00`, `/clear` runs; the scenario prints whether the pane stayed on screen. Then `/meter` replies `Meter closed.` if it stayed, `Meter opened.` if not (so the command was registered again), the pane is open at the end, and COST reads `$0.00` or less than before the clear. |
| `placement` | #121 item 8 | No expected outcome. For asked (`/meter`) and unasked (`meterAutoOpen`) opens, in fullscreen and main-screen sessions, at 109, 110, 143 and 144 columns (asked: 109 and 110), it prints one row per cell: placed or not, `dock` or `inline` (judged from the screen), whether a further `/meter` found the pane listed, and the asked list of `.claude.json` before and after. Unasked cells start from a config without the asked entry, closing the pane by hand (ctrl+x tab, ctrl+x x) first. Three more unasked cells (109, 110, 143) follow a `/meter` open-then-close. A cell passes when it shows a pane in exactly one shape, or none. It reads and never writes `.claude.json`; it needs to run in a config where meter may be opened. |

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
