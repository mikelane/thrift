# handoff

Every model call re-reads the whole session, mostly as cache reads, and accuracy drops as the
context grows. `handoff` watches the context size. Past a size you set, at a good stopping point,
it has Claude write a short handoff over the warm cache, runs `/clear`, and seeds the fresh session
with that handoff. The old session stays resumable. You never lose a prompt, a draft, or the old
session.

Success means fewer cache-read tokens per turn in long sessions, measured against the shadow
baseline that `off` mode logs.

> **Status:** early. The tests pass against Claude Code 2.1.295, but nothing here has been watched
> in a live terminal yet. See [What has not been verified](#what-has-not-been-verified).

## Install

Type this at the prompt of a Claude Code terminal session:

```
/plugin install handoff --marketplace mikelane/thrift
```

Answer `y` to add the marketplace, then choose a scope. To run it from a checkout instead:

```sh
claude --plugin-dir ~/dev/thrift/plugins/handoff
```

## Modes

`handoffMode` is `off` by default. Change it in `/config`.

| Mode | What it does |
|---|---|
| `off` | Acts on nothing. Logs a shadow record for every evaluation, so you can see what `ask` or `act` would have done. |
| `ask` | Shows a band above the prompt with buttons. Nothing happens until you press one. |
| `act` | Hands off or compacts on its own. |

`/handoff` hands off at any time, in every mode, including `off`.

## How it works

1. **It measures the context.** After each step of the main loop it takes the step's input, cache
   creation, and cache read tokens. A step that included advisor calls reports the main model's
   calls summed, so the total is divided by `1 + the advisor calls`, and the smaller of that and
   the session's reported size is the context size. Subagent steps are ignored.
2. **It finds a stopping point.** At the end of each answered turn, and when a prompt arrives, it
   asks whether this is a quiet moment to move on. See the signal table.
3. **It responds by mode.** Over the threshold, a quiet moment is a strong signal and anything else
   is a weak one.
4. **It hands off.** The steps, in order:
   1. Take down the band and show the toast "Writing a handoff for a fresh session...".
   2. Fork the session with a fixed prompt. The fork reads the warm cache. It asks for the task and
      its goal, what is done (commits, branches, PRs, files, with paths), decisions and why, open
      threads, the next concrete step, and facts the next session would otherwise rediscover, in
      at most 400 words of plain Markdown.
   3. If `compactBeforeClear` is on, compact the old session. A failed or vetoed compaction is
      logged and the handoff goes on.
   4. Run `/clear`.
   5. Append the handoff as a message the model reads and you do not see, prefixed "Handoff from
      the previous session (&lt;id&gt;), written by Claude just before a /clear".
   6. Write a transcript line and a toast naming the old session id and `claude --resume <id>`.
   7. If a prompt was held, submit it in the fresh session.

Every step that runs a command, a compaction, or a prompt submission is scheduled through the
clock, because Claude Code refuses them inside a hook that the turn is waiting on.

### Signals

The signal is `none` under the threshold. At or over it:

| Signal | When |
|---|---|
| strong | A finished task, or a prompt that names new work, and no background work is running |
| weak | Anything else over the threshold, including a stopping point while background work is running |

A **finished task** is a main-session `Bash` call in this turn that succeeded with `git commit`,
`git push`, `gh pr create`, or `gh pr merge`.

- `git -C <dir>` and leading `VAR=value` assignments are accepted.
- `--dry-run` is rejected. `-n` is rejected for `push` only, because `commit -n` still commits.
- The command is split at unquoted `;`, `|`, `&`, `&&`, `||`, and newlines. Text in quotes, a `#`
  comment, or a heredoc body is not a command, and a `<<EOF` inside quotes or a comment opens no
  heredoc.
- A command that was moved to the background has not finished, so it does not count.

A **prompt that names new work** is a prompt typed by a person whose tickets and PRs are all new:
earlier prompts named work, and this prompt names only references that none of them named.

| Reference | Counts as | Rule |
|---|---|---|
| `ENG-12` | A ticket | Only under a prefix the current git branch names (`alice/eng-42-fix` names `ENG`) or that a Linear (`/issue/`) or Jira (`/browse/`) URL in any prompt named. So `UTF-8` then `UTF-16` is never new work. |
| `PR #12`, `pr 12`, `issue #12`, `pull request 12` | A PR or issue | Case-insensitive. |
| `.../pull/12`, `.../issues/12` | A PR or issue | Any URL. |
| `#12` | Nothing | A bare number does not count. |

Outside a git repo only URLs name prefixes. The branch is read with a five-second timeout, and
only when the prompt holds a ticket-shaped token.

**Background work** is a subagent with status `pending`, `running`, or `waiting`, or a background
`Bash` or `Monitor` task that has not reported back. A `<task-notification>` prompt that carries the
task id marks it done, and so does a `TaskStop` or `KillShell` call that was not denied. Task ids
are validated against `^[A-Za-z0-9_-]+$`. If the agent list cannot be read, the plugin assumes background work is running.
A handoff would orphan the session that background work reports to, so it turns a strong signal
into a weak one.

### What each mode does

| Signal | `off` | `ask` | `act` |
|---|---|---|---|
| Strong, finished task | Log only | Band: Hand off and clear, Not now | Hand off |
| Strong, prompt names new work | Log only | Hold the prompt and refill the box. Band: Hand off and send it, Send here. Enter again sends it here. | Drop the prompt, hand off, resend it in the fresh session |
| Weak, background work running | Log only | Band: Compact, Not now. No handoff button. | Compact |
| Weak, otherwise | Log only | Band: Hand off and clear, Compact, Not now | Compact |

A weak signal is acted on at the end of a turn. A prompt that names new work while the signal is
weak only logs.

Special cases:

- **Unattended prompts.** A prompt from a scheduled task, routine, or `/loop` acts on a strong
  signal in every mode except `off`, and ignores a weak signal. That covers the prompt itself and
  the end of the turn it started.
- **Non-interactive runs.** Under `claude -p` or the SDK the plugin only logs. The process can exit
  before a handoff ends, and a held prompt would be lost.
- **Prompts never held.** A prompt that carries context or attachments (only its text can be
  resent), a prompt typed while a turn is running, a prompt from a plugin or another session (only
  the person origins `composer`, `bridge`, `sdk`, and `scheduled-trigger` count), and any prompt
  that arrives while a handoff or compaction is pending.
- **One at a time.** A handoff or compaction is claimed when it is scheduled, not when it starts. A
  turn that ends while one is pending is not evaluated, and a second Compact press is ignored.

### The band

The band draws above the prompt from a typed atom. It states the context in thousands, says that
accuracy drops as context grows, and varies its wording for a held prompt, a finished task,
background work, or plain size. In `ask` mode a dim hint line says how to answer and that `handoffMode` `act` does this
without asking. It yields to a survey. A band that cannot be taken down does not stop later turns
from being evaluated.

- The band is shaded and its buttons are drawn plain, like the built-in "Heads up" survey:
  `h: Hand off and clear`, `c: Compact`, `0: Not now`. Hand off is `h`, Compact is `c`, Send here is
  `s`, and Not now is `0`. A held-prompt band has `h: Hand off and send it` and `s: Send here`, and no
  `0`.
- Only Not now is a digit. A bare digit typed into an empty prompt presses a band button, so a digit
  on an action would start a handoff when you type `1` to answer one of Claude's numbered
  questions. Typing `0` into an empty prompt dismisses. The letters work once the band has the
  keyboard: press ctrl+x Tab, or click a button (fullscreen). The held-prompt band never takes `0`,
  because the box holds the prompt.
- The recommended button (Hand off for a strong signal, Compact for a weak one) has `autoFocus` and
  `variant="primary"`, so ctrl+x Tab then Enter runs it. A plain terminal button draws the same with
  or without `variant`, so the recommendation shows as the button focus lands on and as the action
  the hint line names, not as a highlight. A desktop surface draws it as the primary button.
- The dim hint line is per band and says ctrl+x Tab is required, for example "ctrl+x Tab, then Enter
  to compact or h to hand off. 0 to dismiss." In `ask` mode it ends by saying `handoffMode` `act`
  does this without asking.
- The band stays up while a turn runs. A press that hands off, sends or compacts, made during a
  turn, is held: a toast says so, the band stays up, and the choice runs once when that turn ends
  (however it ends), so a `/clear` or compaction never lands mid-turn. Not now has no such hazard
  and runs at once. The first held press wins; further presses before it runs are ignored. The held
  press runs in place of the end-of-turn evaluation, so a new offer never replaces a choice you made.
  If a handoff or compaction is already pending when it would run (for example `/handoff` ran
  mid-turn), a toast says so and the press is dropped. Ending the session drops a held press.
- The first press wins in the same instant: a second press, Not now included, is dropped until the
  first settles. A held press for a prompt that is no longer held says so and takes the band down.
- Background work is checked again when a press runs. If work started since the band was drawn and
  the press would clear (Hand off and clear, Hand off and send it), nothing is cleared: a toast says
  a handoff would cut the work off, the band is redrawn in its busy shape (Compact and Not now, or
  Send here alone for a held prompt), and a `none` record with reason `background_busy` is written. The record's signal is `weak`, which is what
  a busy session classifies as. A band that was taken down or replaced since the press is not redrawn.
  A turn that ends interrupted or in error likewise refreshes a standing band's busy state.
- The decision record of a press is the one the button always writes (`point` `button`), written when
  it runs, with `is_background_busy` and `cache_read_tokens` read at that moment.
- The band comes down when you press a button that runs, when the turn-end evaluation offers
  nothing, or when you press Enter again on a held prompt. A task notification or your next
  prompt no longer takes it down.
- A band still up when the plugin reloads (a code change, or a setting changed in `/config`) comes
  down when the reload fires `session.start` (not yet verified live for a `/config` change).
- Pressing Send here or Hand off and send it takes the held prompt out of the box and leaves any
  draft typed beside it.

### Backoff

After Not now, after each compaction, and after a failed or vetoed compaction, the plugin does not
show the weak band or compact again until the context grows another 50,000 tokens. The growth is
measured from the compaction's `tokensAfter`, or from the size before the compaction when it
failed, was vetoed, or reported no size. A strong signal is not held back.

### When something fails

- **The fork returns no answer, or anything throws before the clear.** Nothing is cleared. A toast
  says no handoff was written and the session is unchanged. A held prompt goes back in the box
  when someone is at the prompt. When nobody is, or the box will not take it, the prompt is
  submitted in the unchanged session.
- **`/clear` throws after the fork succeeded.** The session is unchanged and the prompt is handled
  the same way. A scheduled prompt still runs.
- **The append is refused after the clear.** The handoff exists nowhere else, so it is submitted as
  a prompt, joined to any held prompt.
- **The prompt cannot be sent after the clear, or Send here cannot send it.** When someone is at
  the prompt, it goes back in the box (joined to the handoff if the append was refused). A box that
  already holds it as a whole line is left alone.
- **A prompt can be neither sent nor put back in the box.** It is written to the transcript (not
  the decision log), joined to the handoff if the append was refused, so it can be copied back.
- **Two triggers at once.** The first to claim the handoff wins. The other prompt is not dropped.
- **The decision log cannot be written.** The failure goes to the debug log and the turn goes on.

## Settings

Set these in `/config`.

| Setting | Type | Default | What it does |
|---|---|---|---|
| `handoffMode` | `off`, `ask`, `act` | `off` | See [Modes](#modes). |
| `handoffContextTokens` | number, 80,000 to 2,000,000 | `150000` | The context size at which a signal becomes strong or weak. A fresh session starts near 48,000 tokens. |
| `compactBeforeClear` | boolean | `false` | Compact the old session before clearing, so resuming it later costs less. It costs one compaction per handoff. **When it is on, `claude --resume <old id>` reopens the compacted transcript, not the full one.** |

## Decision log

One JSON object per line, one per evaluation, in `$THRIFT_HOME/decisions.jsonl` (default
`~/.claude/thrift/decisions.jsonl`). The file is created readable by its owner only. Evaluations
that decide nothing are logged too, so you can compute a trigger rate. Prompt text never goes in
the log, and nothing from it is written into the session.

```json
{"ts":"2026-10-08T20:49:10.438Z","session_id":"abc","component":"handoff","mode":"active","action":"cleared","engine_version":"2.1.295","trigger_values":{"point":"turn-end","signal":"strong","context_tokens":200000,"threshold":150000,"is_background_busy":false,"setting":"act","cache_read_tokens":180000}}
```

| Field | Values |
|---|---|
| `ts` | ISO 8601 UTC |
| `session_id` | The session the decision is about. A `cleared` record carries the old session's id. |
| `component` | Always `handoff` |
| `mode` | `shadow` only when `action` is `none` and the plugin ran in `off`, otherwise `active`. The plugin runs in `off` when the setting is `off` and also when a fallback holds it there: an untested Claude Code build, a non-interactive session, or the start of a session before Claude Code reports it started, including right after a plugin reload. `trigger_values.setting` still shows what you configured. A record for `/handoff` is always `active`, because you asked for it. |
| `action` | `none`, `advised` (a band was shown), `cleared`, `compacted`, or `untested_engine` |
| `engine_version` | The Claude Code release (`base`), or the full version when there is no `base`. A change in behavior shows up as a split between versions. |
| `trigger_values.point` | `turn-end`, `prompt`, `command`, `button`, or `session-start` |
| `trigger_values.signal` | `none`, `weak`, or `strong` |
| `trigger_values.context_tokens` | The context size when the decision was made |
| `trigger_values.threshold` | `handoffContextTokens` |
| `trigger_values.is_background_busy` | Whether background work was running |
| `trigger_values.setting` | The configured `handoffMode` (the plugin may act as `off` anyway; see Compatibility) |
| `trigger_values.cache_read_tokens` | Cache-read tokens of the turn the decision was made at, read at that moment (including the end of a turn that did not finish with an answer) |
| `trigger_values.reason` | Present when it explains a `none`: `backoff`, `compaction_vetoed`, `compaction_failed`, `no_handoff_written`, `handoff_failed`, `clear_failed`, `band_failed`, `not_now`, `send_here`, or `background_busy` (a press that would clear was refused because background work is running) |

A prompt is evaluated, and so logged, only when it names new work.

To see whether it helped, compare `cache_read_tokens` per turn in `off` shadow records against the
turns after a `cleared` record.

## Compatibility

The plugin API is early access and changes between Claude Code releases, so an update can break a
plugin without any error. Four layers guard against that:

1. **CI.** Every pull request runs `claude plugin validate`, `tsc -p`, and `claude plugin test`
   against a pinned Claude Code build and against `latest`. Only the pinned build blocks a change.
   A weekly run of `latest` opens an issue titled `Claude Code <version> breaks handoff`.
2. **Engine assumptions.** Behavior the types do not state is pinned in
   `test/engine-assumptions.test.ts`, one test per assumption, with the build it was last confirmed
   on. The mocks come from `test/helpers.ts`, so a broken assumption is fixed in one place.
3. **A runtime fallback.** `TESTED_THROUGH` in `hooks/engine-version.ts` names the newest release
   the plugin was tested through. At session start, if `$.session.version()` reports a `base` that
   is newer, ends in `-dev`, is missing, or is malformed, the plugin acts as `off` for the session,
   shows one toast (when `handoffMode` is not `off`), and logs `untested_engine` once. The gate
   fails closed: the plugin acts as `off` until `session.start` has confirmed a tested engine and
   an interactive run, so a hot reload mid-session stays `off` until the next session start.
   `/handoff` still works, because you asked for it at a moment you chose.
4. **`engine_version` on every log record.**

| Release | Tested through Claude Code |
|---|---|
| 0.1.0 | 2.1.295 |

## What has not been verified

Everything above is covered by tests against the engine's own test kit. These need a live
terminal and have not been watched yet:

- How the band renders (its `subtle` shading, the `h:` labels, whether the colour reads well in light
  and dark themes), that `0` in an empty prompt, ctrl+x Tab then a letter or Enter, and a click each
  press a button, and that each button does what its label says.
- A press that waited colliding with a prompt queued mid-turn: the queued prompt may start the next
  turn before the scheduled clear or compaction runs.
- That `turn.start` and `turn.complete` bracket every model turn, so a press made mid-turn is held and
  then released.
- That `/handoff` survives a `/clear`, and that the plugin's re-registration after a clear works.
- That the advisor's call count is `1 + the advisor entries` in `serverToolUses`, and that
  `$.session.usage().context.tokens` is not a step behind the step's own total.
- That `claude --resume <old id>` reopens the old session after a handoff.
- That a held prompt refills the box, and what the box does across a `/clear`.
- That a background shell turns a handoff into a compact.

## Development

```sh
claude plugin validate plugins/handoff
tsc -p plugins/handoff
claude plugin test plugins/handoff
```

`claude plugin test` measures no coverage. Review enforces it: every exported function and every
branch in `hooks/` has a test whose name says which.

| File | What it holds |
|---|---|
| `hooks/register.tsx` | Engine wiring. Every function that takes `$` lives here, because the engine follows `$` only through functions declared at the top of this file. |
| `hooks/signals.ts` | Pure signal logic: command parsing, work references, classification, the mode table |
| `hooks/engine-version.ts` | `TESTED_THROUGH` and the untested-build check |
| `hooks/decision-record.ts` | The log record and the log location |
| `hooks/handoff-note.ts` | `HANDOFF_PROMPT` and the handoff message |
| `hooks/band-text.ts` | The band's wording |
| `hooks/tasks.ts` | Background task id helpers |
| `hooks/session-state.ts` | The per-session state object |
| `types/index.d.ts` | The band's `Offer` atom |
