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
   1. Replace the band's content with a status line, "Writing a handoff note — this takes a few
      seconds…", with no buttons and no hotkeys, and show the same text as a toast. The status line shows
      whatever started the handoff: a band press, act mode, `/handoff`, or a held prompt handed off
      first. Presses and hotkeys do nothing while it is up.
      It comes down when the clear runs, when the handoff is abandoned, or when a step throws. If you
      type `/clear` before it goes up, it goes up in the fresh session and comes down just before
      the note is delivered there.
      While a turn is running (step 3) it reads "Handoff note written. The handoff continues when the
      current turn ends. Your prompts stay held.", and that text is a toast too.
   2. Fork the session with a fixed prompt. The fork reads the warm cache. It asks for the task and
      its goal, what is done (commits, branches, PRs, files, with paths), decisions and why, open
      threads, the next concrete step, and facts the next session would otherwise rediscover, in
      at most 400 words of plain Markdown.
   3. If a turn is running (one a peer or a finished background task started, or one that was queued
      before the handoff), wait for it to end, however long that takes. The wait has no limit. When
      the wait begins, the status line changes to the waiting text and a toast shows it once, unless
      the person has already cleared, in which case nothing shows. Person
      prompts stay held meanwhile, and presses and hotkeys still do nothing. The wait is written to
      the debug log when it begins and when it ends. The waiting text says "continues", not "clears",
      because the handoff can still stop after the wait (step 5).
   4. If `compactBeforeClear` is on, compact the old session now, after the wait, so the compaction
      never lands inside a turn. A failed or vetoed compaction is logged and the handoff goes on. A
      successful one writes no record of its own. The record that ends the handoff carries
      `compacted_before_clear` instead, so a handoff that stops later still shows the session was
      compacted. If a turn started during the compaction, go back to step 3.
   5. Check for background work again, because a turn may have started some while the handoff
      waited.
      - Work is running and the handoff did not come from a typed `/handoff`: stop. Nothing is
        cleared. A toast and a transcript line say a handoff would cut the work off, whether the
        session was compacted, and that typing `/handoff` hands off anyway. Held prompts go back as they do on any failure, and a
        `none` record with reason `background_busy` is written.
      - Work is running and the handoff came from a typed `/handoff`: go on, as it does when it
        starts while work is busy.
      - A turn started during this check: go back to step 3.
      - Otherwise queue `/clear` in the same tick as the last check for a running turn. `$.command.run`
        only queues the command, and a prompt the engine queued earlier (a peer's message, a task
        notification) runs first, in the old session, so a turn can still start before the clear
        takes effect. Such a turn is a late turn: it adds the "A turn ran in the previous session"
        line in step 6 and sets `late_turn` on the `cleared` record. The plugin reports a late turn; it
        does not prevent one. `command.run` takes no priority, and the declarations give no read of
        the prompt queue. A `session.receive` hook can take a delivery before it is queued (a peer's
        message, or a relay's event or trigger under origin `task-notification`) by returning
        `{ consumed }`, so one that arrives during the handoff could be held and sent after the
        clear. The plugin does not do that yet.
   6. Append the handoff as a message for the model, prefixed "Handoff from the previous session
      (&lt;id&gt;), written by Claude just before a /clear". If a turn ran in the old session after the
      note began to be written, the message ends with one more line saying so ("A turn ran in the previous session
      while or after this note was written, so the note may not cover it. To see that turn:
      `claude --resume <id>`"); the note itself is not rewritten.
   7. Say what happened to the note, in a transcript line and a toast with the same text. If it was
      appended, or the append was refused and it was submitted as a prompt: "Handed off. This session
      starts from a note summarizing the previous one. To reopen the full previous conversation:
      `claude --resume <id>`". If both were refused and it was put in the prompt box instead, the
      note is not sent until you press Enter: "Handed off. The note summarizing the previous session
      is in your prompt box. Press Enter to send it. To reopen the full previous conversation:
      `claude --resume <id>`". If nothing could carry it: "The handoff note could not be added to
      this session. To reopen the full previous conversation: `claude --resume <id>`". Claude Code puts
      the plugin's name in front of its toasts and transcript lines, so the plugin's own strings
      carry no `handoff:` prefix.
   8. Deliver any held prompts in the fresh session. If the note was not appended, it is submitted
      as a prompt. A scheduled handoff's note rides with the held scheduled prompts, and both go under
      the plugin's name. An attended handoff's note goes alone, and the held prompts follow it. Every
      held group that did not ride with the note is sent on its own: submitted first, then put in the
      prompt box if it was typed at this terminal, then written to the transcript. The
      `cleared` record's `held_other_delivery` field says how those groups went. This holds whether
      the handoff was started by handing it off first or by running `/handoff` while the prompt was
      held.
      A held prompt from a person (this terminal, the bridge, or the SDK) is submitted as their own
      words, so the model reads it bare, with no "The handoff plugin sent a message" in front. That
      goes for every way the plugin sends one again: after the clear, a prompt that arrived while the
      delivery ran, Hand off and send it, Send here, and the restore after an abandoned handoff. The
      plugin's own note and a scheduled prompt keep the plugin's name in front. Hooks and the
      transcript still show the plugin as the sender of all of them.
      A person's prompt follows the note, so it is not submitted when the note did not enter the
      fresh session as a message (it was left in the prompt box or written to the transcript), for
      an attended and a scheduled handoff alike. It is held back after the note instead: in the prompt
      box if it was typed at this terminal, otherwise in the transcript. That includes a prompt that
      arrives while the delivery runs. Scheduled prompts are still submitted.
      A prompt that arrives while this step runs is held too. It is delivered after everything above,
      one prompt at a time in the order it arrived, the same way: submitted, then put in the prompt box
      if it was typed at this terminal, then written to the transcript. A prompt from the bridge, the SDK,
      or a scheduled trigger is never put in the box: its sender is not at the terminal, and filling the
      box could displace the draft of the person who is. It never enters ahead of the note or the held
      prompts, but one of them left in the prompt box waits for Enter, so a later prompt can run first.
      Claude Code leaves the text of a prompt it dropped in the prompt box, so the plugin takes that
      text back out of the box for every prompt typed at this terminal:
      - As each prompt is held. Otherwise the next prompt is typed after the leftover text: `one`
        then `two` would be held as `one` and `onetwo`.
      - Before a handoff started by a prompt in `act` runs, since the handoff sends that prompt itself.
      - After a held prompt has been submitted in the fresh session, so Enter does not send it a
        second time. A group put back by an abandoned handoff and submitted rather than boxed is
        cleaned up the same way.

      Only the lines that match the prompt are removed: for a group, its last prompt typed at this
      terminal, even when a bridge or SDK prompt joined it. Any other text in the box is kept. A draft
      line that is word for word the same as the prompt just sent is removed too.

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
| Strong, prompt names new work | Log only | Hold the prompt and refill the box (only a prompt typed in this terminal; one from the bridge or an SDK client runs at once, and the turn it starts can still raise the band). Band: Hand off and send it, Send here. Enter again sends it here. | Drop the prompt, hand off, resend it in the fresh session |
| Weak, background work running | Log only | Band: Compact, Not now. No handoff button. | Compact |
| Weak, otherwise | Log only | Band: Compact, Hand off and clear, Not now | Compact |

A weak signal is acted on at the end of a turn. A prompt that names new work while the signal is
weak only logs.

Special cases:

- **Unattended prompts.** A prompt from a scheduled task, routine, or `/loop` acts on a strong
  signal in every mode except `off`, and ignores a weak signal. That covers the prompt itself and
  the end of the turn it started.
  A scheduled prompt a handoff held and sends again, in the fresh session or back in this one, is
  still treated this way: `prompt.submit` takes no origin, so the plugin marks the turn itself.
  It is also submitted under the plugin's name, not as a person's words, because nobody typed it.
- **Non-interactive runs.** Under `claude -p` or the SDK the plugin only logs. The process can exit
  before a handoff ends, and a held prompt would be lost.
- **Prompts never held.** A prompt that carries context or attachments (only its text can be
  resent), a prompt typed while a turn is running, a prompt from a plugin or another session (only
  the person origins `composer`, `bridge`, `sdk`, and `scheduled-trigger` count), and any prompt
  that arrives while a compaction is pending.
- **Turns started by something other than a person.** A peer prompt or a finished background
  task is not held, and a finished task is still marked done. This is deliberate and holds through
  the delivery too: they do not come from the person, so they have no place in the order of the
  person's prompts. A peer prompt or task notification can therefore run ahead of the held
  prompts. If it starts a turn while the handoff is pending, the handoff waits for that turn to end before it clears (step 3).
- **Prompts sent during a handoff.** A person prompt that arrives while the note is written, while
  the handoff waits for a turn, or while the session is compacted before the clear is held, so
  `/clear` never runs inside its turn.
  - Held: after the clear it is sent in the fresh session, after the note.
  - Held through the delivery: a prompt that arrives in the fresh session before the note and the
    held prompts have been delivered is held as well. It is sent after them, in arrival order, each on its own
    (not joined to the earlier prompts), and follows the same rule if its delivery fails. The drop
    says it is held.
  - Grouped by sender: prompts from the same kind of sender (a person, or a scheduled trigger) are
    joined with a blank line, in the order they arrived, and sent as one. Each kind follows its own
    rule if delivery fails. When the note has to be sent as a prompt, a scheduled handoff's note
    carries the scheduled prompts, and every person's prompt follows it as a prompt of its own.
  - Repeats of the carried prompt: a prompt is dropped as a duplicate only when its text matches the
    prompt the handoff is already carrying (say, "Hand off and send it" sent again). The drop says
    the repeat was not added. Every other prompt is kept, so two identical prompts sent on purpose
    are both sent.
  - On failure: if the handoff fails, a prompt typed at this terminal goes back in the box and any
    other is submitted here, whichever kind of sender started the handoff. Prompts are held while
    this happens, as they are during the delivery: one that arrives meanwhile is put back after
    them, one at a time in the order it arrived, the same way. It never enters ahead of them, but one
    of them left in the prompt box waits for Enter, so a later prompt can run first.
  - Refused: a prompt with attachments or context can't be held, because it can't be sent again. It
    is dropped with a short toast and is not sent in the fresh session. A prompt typed at this
    terminal is put back in the prompt box, or shown in the transcript if the box can't take it. A
    prompt from the bridge, the SDK, or a scheduled trigger is shown in the transcript only: its
    sender is not at the terminal, and the engine offers no way to answer them except the drop
    reason, so the box is left to the person typing in it. After the handoff, send it again and add
    the attachments or context again.
- **The session ends before the handoff clears.** This covers the note being written, the wait for a
  turn, and the compaction. The handoff's own `/clear` ends the session too, and that is not counted.
  - You typed `/clear`: the handoff runs no second clear. The note (with the turn-after-note line, if
    it applies) and the held prompts go into the fresh session you made, as they would after the
    handoff's own clear, and the record is `cleared`.
  - Any other end (`/resume` and so on): the handoff stops. Nothing is cleared and no note is added.
    A toast and a transcript line say the handoff stopped because the session ended and no note was
    carried over, held prompts go back as they do on any failure, and a `none` record with reason
    `session_ended` is written.
- **One at a time.** A handoff or compaction is claimed when it is scheduled, not when it starts. A
  turn that ends while one is pending is not evaluated, and a second Compact press is ignored.

### The band

The band draws above the prompt from a typed atom. It states the context in thousands, says that
accuracy drops as context grows, and varies its wording for a held prompt, a finished task,
background work, or plain size. In `ask` mode a dim hint line says how to answer and that `handoffMode` `act` does this
without asking. It yields to a survey. A band that cannot be taken down does not stop later turns
from being evaluated.

- The band is shaded and its buttons are drawn plain, like the built-in "Heads up" survey:
  `c: Compact`, `h: Hand off and clear`, `0: Not now`. Hand off is `h`, Compact is `c`, Send here is
  `s`, and Not now is `0`. A held-prompt band has `h: Hand off and send it` and `s: Send here`, and no
  `0`.
- Only Not now is a digit. A bare digit typed into an empty prompt presses a band button, so a digit
  on an action would start a handoff when you type `1` to answer one of Claude's numbered
  questions. Typing `0` into an empty prompt dismisses. The letters work once the band has the
  keyboard: press ctrl+x Tab, or click a button (fullscreen). The held-prompt band never takes `0`,
  because the box holds the prompt.
- The recommended button is the first one on every band. It has `autoFocus` and
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
  a handoff would cut the work off and that typing `/handoff` hands off anyway, the band is redrawn in its busy shape (Compact and Not now, or
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
  and a transcript line say no handoff was written and the session is unchanged. When Claude has
  not finished a reply in the session yet (a new session before its first turn ends, right after a
  `/clear`, or a resume that starts the conversation afresh), they say there is nothing to hand off
  yet and to type `/handoff` again once Claude has replied. A held prompt goes back in the box
  when someone is at the prompt. When nobody is, or the box will not take it, the prompt is
  submitted in the unchanged session.
- **`/clear` throws after the fork succeeded.** The session is unchanged, or compacted but not
  cleared when `compactBeforeClear` is on and the compaction worked. A toast and a transcript
  line say which and that typing `/handoff` tries again. The prompt is handled the same way. A
  scheduled prompt still runs.
- **The append is refused after the clear.** The handoff exists nowhere else, so it is submitted as
  a prompt, joined to any held scheduled prompt of a scheduled handoff. Held prompts from a person
  follow it as separate prompts, so the model reads them as the person's own words. If that submit
  is refused too, the note goes in the prompt box, or in the transcript when the handoff did not
  start at this terminal. The person's prompts are held back after it rather than run in a session
  that has no note.
- **The prompt cannot be sent after the clear, or Send here cannot send it.** When someone is at
  the prompt, it goes back in the box, after the handoff note when the note is in the box too. A box that
  already holds it as a whole line is left alone.
- **Prompt text in the engine's debug log.** A prompt or note kept in the transcript, and a refused
  remote prompt, are written with `$.ui.log`. The engine also copies every `$.ui.log` line, up to
  10000 characters, into Claude Code's own local debug log. The decision log never gets this text.
  This is accepted: the debug log stays on your machine, and the text already shows in the
  transcript.
- **A prompt can be neither sent nor put in the prompt box.** It is written to the transcript (not
  the decision log), so it can be copied back. A scheduled prompt stays joined to a scheduled
  handoff's note when the append was refused. The
  notice names what it holds: the prompt, the handoff note, or both. It says the prompt box was
  tried only when it was: for text that was typed at this terminal, or a note started there that
  carries no prompt from elsewhere.
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
`~/.claude/thrift/decisions.jsonl`). `THRIFT_HOME` must be an absolute path: a relative one, or one
that starts with `~`, would resolve against the session's working directory, so the plugin ignores it,
writes a debug line, and uses the default (or writes no log when `HOME` is not set either). The file is readable by its owner only, whether the plugin
created it or it already existed (each write sets the mode). Evaluations
that decide nothing are logged too, so you can compute a trigger rate. Prompt text never goes in
the log, and nothing from it is written into the session.

```json
{"ts":"2026-10-08T20:49:10.438Z","session_id":"abc","component":"handoff","mode":"active","action":"cleared","engine_version":"2.1.295","trigger_values":{"point":"turn-end","signal":"strong","context_tokens":200000,"threshold":150000,"is_background_busy":false,"setting":"act","cache_read_tokens":180000,"note":"appended","cleared_by":"handoff","held_groups":0,"held_unattended":false,"handoff_unattended":false,"held_other_delivery":"none","effective_mode":"act"}}
```

A check rebuilds this line through the code that writes the log and fails if the two differ in key order, names, or types. It copies every value from the line into the rebuild, so it does not compare values: a value the code would never write passes. It also cannot tell that an optional field was left out of the sample.

| Field | Values |
|---|---|
| `ts` | ISO 8601 UTC |
| `session_id` | The session the decision is about. A `cleared` record, and any record a handoff writes after the wait (an abandon, a failed or vetoed compaction), carries the id of the session the handoff started in, even if the session changed meanwhile. |
| `component` | Always `handoff` |
| `mode` | `shadow` only when `action` is `none` and the plugin ran in `off` when the decision was made, otherwise `active`. The plugin runs in `off` when the setting is `off` and also when a fallback holds it there: an untested Claude Code build, a non-interactive session, or the start of a session before Claude Code reports it started, including right after a plugin reload. `trigger_values.setting` still shows what you configured, and `trigger_values.effective_mode` shows the mode the plugin ran in when the decision was made. A record for `/handoff` or for a band button press is always `active`, because you asked for it. A press on a band shown before a plugin reload can arrive while the plugin runs in `off`, before the reload's own `session.start`: the record still says `active`, and `trigger_values.effective_mode` says `off`. |
| `action` | `none`, `advised` (a band was shown), `cleared`, `compacted`, or `untested_engine` |
| `engine_version` | The Claude Code release (`base`), or the full version when there is no `base`. A change in behavior shows up as a split between versions. |
| `trigger_values.point` | `turn-end`, `prompt`, `command`, `button`, or `session-start` |
| `trigger_values.signal` | `none`, `weak`, or `strong` |
| `trigger_values.context_tokens` | The context size when the decision was made |
| `trigger_values.threshold` | `handoffContextTokens` |
| `trigger_values.is_background_busy` | Whether background work was running |
| `trigger_values.setting` | The configured `handoffMode`. The plugin may run as `off` anyway (see Compatibility); `effective_mode` shows the mode it ran in |
| `trigger_values.effective_mode` | The mode the plugin ran in when the decision was made: `off`, `ask`, or `act`. Every record a handoff writes (a `cleared` record, an abandon, a failed or vetoed compaction) carries the mode from when the handoff began, so a `/handoff` that starts before Claude Code reports the session started keeps `off` even though its record is written after. It equals `setting` unless a fallback held the plugin at `off`: an untested Claude Code build, a non-interactive session, or the start of a session before Claude Code reports it started, including right after a plugin reload. When `setting` is already `off`, the two match even under a fallback. Present on every record. On a `/handoff` or band button record, where `mode` is always `active`, this is the field that shows a fallback. |
| `trigger_values.cache_read_tokens` | Cache-read tokens of the turn the decision was made at, read at that moment (including the end of a turn that did not finish with an answer) |
| `trigger_values.reason` | Present when it explains a `none`: `backoff`, `compaction_vetoed`, `compaction_failed`, `no_handoff_written`, `handoff_failed`, `clear_failed`, `session_ended` (the session ended before the handoff cleared and you did not type `/clear`), `band_failed`, `not_now`, `send_here`, or `background_busy` (a press or a handoff that would clear was refused because background work is running; a typed `/handoff` is never refused) |
| `trigger_values.fork_reason` | Present only on a `no_handoff_written` record: `nothing-to-fork` when Claude had not finished a reply in the session to fork (a new session before its first turn ends, right after a `/clear`, or a resume that starts the conversation afresh). Absent for every other reason the fork wrote no note |
| `trigger_values.note` | Present on a `cleared` record: how the handoff note reached the fresh session. `appended` (added to the session), `submitted` (sent as a prompt after the append was refused), `in_box` (left in the prompt box, unsent until you press Enter), or `not_carried` (nothing could carry it) |
| `trigger_values.cleared_by` | Present only on a `cleared` record: who ran the clear. `handoff` (the handoff's own `/clear`) or `person` (you typed `/clear` before the handoff's own clear, so the note went into the fresh session you made and no second clear ran) |
| `trigger_values.compacted_before_clear` | Present, as `true`, only on the record that ends a handoff (a `cleared` record, or the `none` record of an abandon) when `compactBeforeClear` was on and the compaction before the clear worked. It tells a `background_busy`, `clear_failed`, or `session_ended` record that left the session compacted from one that left it unchanged. A vetoed or failed compaction writes its own `none` record and leaves this off. A compaction in act mode outside a handoff writes a `compacted` record instead |
| `trigger_values.late_turn` | Present, as `true`, only on a `cleared` record, when a turn started in the old session after the handoff queued its `/clear` and before that clear ended the session. A prompt the engine had queued ahead of the `/clear` ran first. The note then ends with the "A turn ran in the previous session" line. Absent when no such turn started |
| `trigger_values.held_groups` | Present only on a `cleared` record and on the `none` record that ends a handoff (reason `no_handoff_written`, `handoff_failed`, `session_ended`, `clear_failed`, or `background_busy` from a handoff). A refused press carries none, and neither does a `compaction_vetoed` or `compaction_failed` record written mid-handoff. How many groups of prompts the handoff held, counting the prompt it carries: `0`, `1`, or `2` (one from a person, one from a scheduled trigger). It holds prompts from when it is scheduled until the note, every held prompt, and every prompt that arrived while those were delivered have been delivered (submitted, put in the prompt box, or written to the transcript). A prompt that arrived during the delivery counts toward the group of its origin. A handoff that is abandoned (including one whose `/clear` failed) holds prompts until they, and every prompt that arrived while they were put back, are back. A prompt sent after that is not counted. A count, never prompt text |
| `trigger_values.held_unattended` | Present exactly when `held_groups` is: `true` when one of the held groups came from a scheduled trigger (including a scheduled prompt the handoff carries), `false` otherwise |
| `trigger_values.handoff_unattended` | Present exactly when `held_groups` is: `true` when the handoff began from a scheduled trigger, `false` when a person began it. When the note is not appended, a scheduled handoff's note carries the held scheduled group; an attended handoff's note carries none |
| `trigger_values.held_other_delivery` | Present only on a `cleared` record. How the held groups the note did not carry, and any prompt that arrived during the delivery, were delivered in the fresh session. An appended note carries no group, and neither does an attended handoff's note, so every held group is sent separately; a scheduled handoff's note that is not appended carries the scheduled group, so only the other group is. Each group, and each prompt that arrived during the delivery, is submitted first; if that fails, one typed at this terminal is put in the prompt box. A person's prompt is not submitted when `note` is `in_box` or `not_carried`: it is held back after the note, so it reads `in_box` or `not_carried` here by design, not because a submit failed. A failed submit or box fill goes to the debug log with its reason. `submitted` (entered into the session), `in_box` (left in the prompt box, unsent), `not_carried` (neither worked, so the prompt was written to the transcript), or `none` (nothing was sent separately). With more than one, the worst outcome across all of them: `not_carried`, then `in_box`, then `submitted`. Never prompt text |
| `trigger_values.held_restore` | Present only on the `none` record that ends a handoff, the same records that carry `held_groups`. How the held groups were put back when the handoff was abandoned. A group typed at this terminal goes back in the prompt box first; if that fails, or the group came from the bridge, the SDK, or a scheduled trigger (or mixes them with prompts typed here), it is submitted. A prompt that arrived while the groups were put back is put back after them in the same way and counts here and in `held_groups`. `in_box` (back in the prompt box), `submitted` (entered into the session), `not_carried` (neither worked, so the prompt was written to the transcript), or `none` (no group was held). With more than one, the worst outcome across all of them: `not_carried`, then `in_box`, then `submitted`. The record is written after the groups are put back. Never prompt text |

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
   on. The engine mocks live in `test/mocks.ts` and `test/helpers.ts` installs them, so a broken
   assumption is fixed in one place.
3. **A runtime fallback.** `TESTED_THROUGH` in `hooks/engine-version.ts` names the newest release
   the plugin was tested through. At session start, if `$.session.version()` reports a `base` that
   is newer, ends in `-dev`, is missing, or is malformed, the plugin acts as `off` for the session,
   shows one notice as a toast and in the transcript (when `handoffMode` is not `off`), and logs `untested_engine` once. The gate
   fails closed: the plugin acts as `off` until `session.start` has confirmed a tested engine and
   an interactive run, so after a hot reload it stays `off` until the reload's own `session.start`
   has run. The engine's declarations say `session.start` fires once per fresh load of a plugin, a reload included
   (never for a `/clear`); whether it does for a setting changed in `/config` is not yet verified live.
   In an interactive session `/handoff` still works, because you asked for it at a moment you
   chose, and the toast says so. A session with no prompt (`-p`, the SDK) never registers
   `/handoff`, so there the toast does not mention it.
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
- How the band lays out in a narrow terminal (around 40 columns), in fullscreen and on the main
  screen: that the buttons wrap onto new rows rather than clip, and that the message and hint lines
  wrap.
- A press that waited colliding with a prompt queued mid-turn: the queued prompt may start the next
  turn before the scheduled clear or compaction runs.
- That `turn.start` and `turn.complete` bracket every model turn, so a press made mid-turn is held and
  then released.
- That `/handoff` survives a `/clear`, and that the plugin's re-registration after a clear works.
- That the advisor's call count is `1 + the advisor entries` in `serverToolUses`, and that
  `$.session.usage().context.tokens` is not a step behind the step's own total.
- That `claude --resume <old id>` reopens the old session after a handoff.
- That the status lines (writing, then waiting for a turn) show and are gone after the clear, and that no `handoff:`
  appears twice in a transcript line or toast.
- Whether the appended note shows in the fresh session's transcript, or only in its context. If it
  does not show, a "note loaded" line would be needed; none is written yet.
- That a held prompt refills the box, and what the box does across a `/clear`.
- That a held prompt typed at this terminal leaves the box empty once the fresh session has it, and that a draft typed meanwhile survives (#56).
- That a background shell turns a handoff into a compact.

## Development

```sh
claude plugin validate plugins/handoff
tsc -p plugins/handoff
claude plugin test plugins/handoff
```

`claude plugin test` measures no coverage. Review enforces it: every exported function and every
branch in `hooks/` has a test whose name says which.

A hot reload in the middle of a handoff (a code change under `--plugin-dir` watch, or a setting
changed in `/config`) starts fresh state. The handoff already running keeps the old state: its
prompts are no longer held, `/clear` can land inside a turn, and it waits forever if it was waiting
for a turn to end. This needs a reload while a handoff runs, from the note being written until its
prompts are delivered, and it is not guarded. After a reload, run `/handoff` again.

| File | What it holds |
|---|---|
| `hooks/register.tsx` | Engine wiring. Every function that takes `$` lives here, because the engine follows `$` only through functions declared at the top of this file. |
| `hooks/signals.ts` | Pure signal logic: setting parsers (`asMode`, `asThreshold`), context size (`contextFromStep`, `formatTokens`), classification (`classify`), the band's buttons (`bandButtons`), the mode table (`respond`), and the busy-refusal trigger (`busyRefusalTrigger`) |
| `hooks/turn-end-plan.ts` | What a turn's end calls for: the signal and the plan from `planTurnEnd` (advise, compact, hand off, back off, or nothing), and the back-off window (`isBackedOff`) |
| `hooks/prompt-plan.ts` | What a submitted prompt calls for: prompt origins (`isPersonOrigin`, `isComposerOrigin`, `isUnattendedOrigin`), the sender named in a message (`senderLabel`), attachments or context (`carriesExtras`), what to do with one that arrives during a handoff (`planPromptDuringHandoff`), whether one can be held (`canHoldPrompt`), and the plan for new work (`planNewWorkPrompt`) |
| `hooks/tool-call-tracking.ts` | What a tool call tells the state: background tasks that start or stop, and a finished task (`noteToolCall`) |
| `hooks/command-parse.ts` | The shell lexer: command segments with heredocs skipped (`commandSegments`), its quoting step (`readQuotingStep`), and `finishesTask` |
| `hooks/work-refs.ts` | Work-reference parsing: branch and URL ticket prefixes (`branchTicketPrefixes`, `ticketUrlPrefixes`), ticket-shaped tokens (`hasTicketShapedToken`), ticket and pull request references (`workRefs`), and new-work detection (`namesNewWork`) |
| `hooks/engine-version.ts` | `TESTED_THROUGH` and the untested-build check |
| `hooks/decision-record.ts` | The log record and the log location |
| `hooks/handoff-note.ts` | `HANDOFF_PROMPT`, the handoff message, `NoteDelivery` (`appended`, `submitted`, `in_box`, `not_carried`) and `Carried` (the same without `appended`), the message the person sees for each delivery, and the grouping of held prompts |
| `hooks/held-delivery.ts` | `GroupDelivery` and `worstDelivery`: the worst outcome among the held groups sent or put back, as one value |
| `hooks/band-text.ts` | The band's wording |
| `hooks/tasks.ts` | Background task id helpers |
| `hooks/session-state.ts` | The per-session state object |
| `types/index.d.ts` | The band's atom: an `Offer`, or a status line (writing the note, or waiting for a turn) |
