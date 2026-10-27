# reread

When Claude reads a file it already read in the same context, and the file has not changed, the
full contents go into the context a second time. The first copy is still there. `reread` answers
that repeat `Read` with a short stub instead: Claude's own "this file is unchanged" result plus one
line saying where the contents are. The stub is a few hundred bytes where the repeat would be the
whole file, and a context that does not grow is a context that costs less on every later turn.

Success means fewer bytes of repeat file contents entering the context, measured by
`bytes_saved` summed per session in `decisions.jsonl` against the `bytes_would_save` baseline that
`off` mode logs.

> **Status:** early. The tests pass against Claude Code 2.1.311. One live session has been checked,
> in `ask` mode on Claude Code 2.1.308 in the Desktop app; see
> [What has been verified live](#what-has-been-verified-live).

## Install

Type this at the prompt of a Claude Code terminal session:

```
/plugin install reread --marketplace mikelane/thrift
```

Answer `y` to add the marketplace, then choose a scope. To run it from a checkout instead:

```sh
claude --plugin-dir ~/dev/thrift/plugins/reread
```

## Modes

`readMode` is `off` by default. Change it in `/config`.

| Mode | What it does |
|---|---|
| `off` | Sends no stubs. Runs every `Read` as usual and logs what a stub would have saved, so you can see the saving before you turn it on. A repeat whose stub would not be smaller than the text it replaces is logged as a pass (`stub_not_smaller`), with no saving. |
| `ask` | Answers a repeat `Read` with the stub, and shows one dim line in the transcript for each stub, so you can watch it work before you switch to `act`. |
| `act` | Answers a repeat `Read` with the stub and says nothing. |

`ask` and `act` decide the same way. The difference is only the transcript line.

## How it decides

The plugin watches the `Read` calls the model makes, in the main conversation and in each subagent
or teammate separately. For each one that reads text, it remembers the file's real path (symbolic
links followed), the range read, the file's size and modified time, a SHA-256 of its bytes, and the
id of the tool call whose result is in the context.

When the same range is read again, or a range that sits inside an earlier read of the whole file,
it goes down this list and stops at the first answer:

1. **Not a candidate.** A `Read` with `pages` set, a file that cannot be statted or read, a call
   raised by another plugin, and any result that is not plain text (an image, a PDF, a notebook,
   page images), an error, or a result Claude Code already answered with its own `file_unchanged`.
   These pass through untouched and are never tracked.
2. **Nothing tracked covers it.** The first read of a file, or a range no earlier read covers, passes
   and is tracked. A read that Claude Code cut short at its token cap is tracked as that partial
   read: a repeat of the same request is still answered, but it never covers a range.
3. **The last answer to this request was a stub.** The model asked again after being told the file is
   unchanged, so it wants the contents. The read passes, is logged as an `override`, and is tracked
   afresh. A third identical request then gets a stub again.
4. **The file changed.** A different size or modified time passes. If both match, the file is read and
   hashed, and a different hash passes too. A file that cannot be read passes.
5. **The original result is gone.** The plugin looks for the tool call's result in the conversation
   (`$.session.messages()`, or `{ agentId }` for a subagent). If it is not there, is there as an
   error (a plugin above withheld or refused it), no longer begins with the text the model read (a
   plugin above answered in its place), or the conversation cannot be read, the read passes. Absence
   always means pass.
6. **The stub would not be smaller.** The stub's cost is its result as JSON plus the context line, in
   UTF-8 bytes. The text it replaces is what the model read the first time (for a range inside a full
   read, the lower-bound sum of those lines). If the stub is not strictly smaller, as for a very short
   file or a range of a few lines, the read passes, is logged as a `stub_not_smaller` pass with the
   two sizes it compared, and reports no saving. It is not counted as a stub, so asking again is a
   plain pass, not an `override`. This is the same in all three modes.
7. **Otherwise it answers with the stub** in `ask` and `act`. In `off` it runs the tool and logs the
   saving it would have made.

The file is statted before the tool runs and again after it. If the two differ, the file changed
while it was being read and the read is not tracked. Nor is it tracked when the file, read by the
plugin after the tool ran, does not hold at the result's lines the exact content the tool returned:
a stat cannot see a rewrite that keeps the size within one modified-time tick, or a link that
pointed elsewhere while the tool ran.

### What the model sees

The result is Claude Code's own `{ type: "file_unchanged", file: { filePath } }`, which Claude Code
checks against `Read`'s output schema and renders with `Read`'s own text. Beside it the plugin adds
one line of context, for example:

> reread: /work/a.ts is unchanged since you read it at turn 3 (same content, 120 lines). Its
> contents are earlier in this conversation. Read it again only if you need it in full.

The turn is the number of prompts you had sent when the file was read. The line count is the lines
the repeat asked for. Claude Code renders the `file_unchanged` result as its own text, quoted under
[What has been verified live](#what-has-been-verified-live).

### What drops the tracked reads

| Event | What is dropped |
|---|---|
| The session ends, for any reason (`/clear`, resume, branch, exit) | Everything |
| A compaction of a loop, for any trigger including `precompute`, once it has run and was not vetoed | That loop's reads |
| `Write`, `Edit`, `MultiEdit` or `NotebookEdit`, from any loop | That path (its real path, and the path as given) in every loop |
| `Bash`, from any loop | Everything in every loop, because a command can change any file |

An invalidation that drops nothing writes no record, so a `Bash` command in a session that has read
nothing costs no log write.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `readMode` | `off` | `off`, `ask` or `act`. Any other stored value is treated as `off`. |

## Decision log

One JSON object per line in `$THRIFT_HOME/decisions.jsonl` (default `~/.claude/thrift/decisions.jsonl`).
`THRIFT_HOME` must be an absolute path: a relative one, or one that starts with `~`, would resolve
against the session's working directory, so the plugin ignores it, writes a debug line, and uses the
default (or writes no log when `HOME` is not set either). The file is readable by its owner only,
whether the plugin created it or it already existed. A log that cannot be written goes to the debug
log and never touches the turn. Nothing from the log is written into the session.

The plugin writes one record per `Read` it evaluates (passes included, so you can compute a rate),
one per invalidation that dropped at least one read, and one `untested_engine` record per session on
a build it was not tested through.

```json
{"ts":"2026-10-26T20:49:10.438Z","session_id":"abc","component":"reread","mode":"active","action":"dedupe","engine_version":"2.1.311","trigger_values":{"decision":"dedupe","reason":"exact_repeat","bytes_saved":6520,"gross_bytes":6910,"stub_bytes":390,"lines":120,"range_kind":"full","turns_since_read":3,"is_subagent":false,"path_hash":"3f2a9c1d7b0e4a58","effective_mode":"act","setting":"act"}}
```

| Field | Values |
|---|---|
| `ts` | ISO 8601 UTC |
| `session_id` | The session the decision is about. An invalidation at the end of a session carries the id of the session that ended. |
| `component` | Always `reread` |
| `mode` | `shadow` only when `action` is `none`, otherwise `active`. A plugin in `off`, or held in `off` by an untested build, writes `none` and `shadow`. |
| `action` | `dedupe` (answered with a stub), `pass` (let through), `override` (let through because the model asked again after a stub), `invalidate` (dropped tracked reads), `untested_engine`, or `none` (in `off`, whatever the logic decided) |
| `engine_version` | The Claude Code release (`base`), or the full version when there is no `base`, or `unknown` when it could not be read. |
| `trigger_values.decision` | What the logic decided: `dedupe`, `pass`, `override`, `invalidate`, or `untested_engine`. In `off` this is what `action` would have been. |
| `trigger_values.reason` | Why the decision came out as it did: `first_read`, `exact_repeat` (the same request again), `inside_full_read` (a range inside an earlier read of the whole file), `changed` (size, modified time or hash differ, or the file changed during the read), `different_range` (the file was read, but no earlier read covers this range), `not_text` (an image, PDF, notebook, page images or other non-text result), `pdf_pages` (a `pages` read), `error_result` (the tool refused or failed), `token_cap_truncated` (Claude Code cut the read short at its token cap, so it is tracked as partial), `not_in_context` (the original result is not in the conversation, is there as an error, no longer begins with the text the model read, or the conversation could not be read), `plugin_call` (another plugin raised the read), `override_after_stub` (the model asked again after a stub), `stub_not_smaller` (a stub would not have been smaller, in UTF-8 bytes, than the text it replaces, so the read passed), `core_dedup` (Claude Code answered with its own `file_unchanged`), `unreadable` (the file could not be statted, read or hashed, or tracking it failed), `untested_engine` (the build is newer than the plugin was tested through, or is not a release), `compaction`, `clear` (the session ended), `edit` (a file-editing tool ran), or `bash` (a Bash command ran) |
| `trigger_values.bytes_saved` | `act` and `ask` only, on a `dedupe`: the net bytes the stub kept out of the context, `gross_bytes - stub_bytes`. Always positive: a stub that would not be smaller is not sent. |
| `trigger_values.bytes_would_save` | `off` only, on a `dedupe`: the same net figure, for the saving a stub would have made |
| `trigger_values.gross_bytes` | On a `dedupe` or a `stub_not_smaller` pass: the UTF-8 bytes of the text the model read the first time, line numbers included. For a range inside a full read, the bytes of those lines in the file's own text, which leaves out the line-number prefixes, so it is a lower bound. |
| `trigger_values.stub_bytes` | On a `dedupe` or a `stub_not_smaller` pass: the bytes of the stub result as JSON plus the context line. Claude Code's rendering of the result is not visible to a hook, so this is an estimate. |
| `trigger_values.lines` | On a `dedupe`: the lines the repeat asked for |
| `trigger_values.range_kind` | On a `dedupe`: `full` (the whole file), `range` (the same range as an earlier read) or `subrange` (a range inside an earlier read of the whole file) |
| `trigger_values.turns_since_read` | On a `dedupe`: prompts sent since the file was read |
| `trigger_values.is_subagent` | Whether the read, or the loop that was invalidated, was a subagent's or teammate's |
| `trigger_values.path_hash` | The first 16 hex digits of a SHA-256 over a random salt and the file's real path. The salt is made in memory when the plugin starts and again at each session end, and is never written down, so the same file hashes differently in different sessions and the value cannot be looked up against a list of paths. Absent where no path was resolved. |
| `trigger_values.dropped` | On an `invalidate`: how many tracked reads were dropped |
| `trigger_values.effective_mode` | The mode the plugin ran in: `off`, `ask` or `act`. It equals `setting` unless an untested build held the plugin at `off`. |
| `trigger_values.setting` | The configured `readMode` |

To see whether it helped, sum `bytes_saved` per `session_id` after switching to `act`, and compare it
with the `bytes_would_save` the same kind of session logged in `off`. The `off` records also show
how often `core_dedup` fires, which tells you whether Claude Code's own dedup ever does this work
first.

## Compatibility

The plugin API is early access and changes between Claude Code releases, so an update can break a
plugin without any error. The plugin was tested through Claude Code 2.1.311. On the first `Read` of a
session it reads `$.session.version()`. If the `base` is missing, is not exactly `MAJOR.MINOR.PATCH`
(a development build such as `2.1.311-dev`), or names a release newer than 2.1.311, it runs as `off`
for the rest of the plugin's life and writes one `untested_engine` record. It says nothing in the
session. Every record carries `engine_version`, so a change in behavior shows up as a split between
versions.

State lives in memory. If the engine starts the plugin again mid-session (a change in `/config` did
on 2.1.299), the tracked reads are lost and the plugin starts again from empty. That is safe: it only
means fewer stubs until the files are read once more.

## Known limits

- **Rewind has no event.** After a rewind the conversation no longer holds some tool results the
  plugin still tracks. The only cover is step 5 above, which asks the conversation whether the
  original result is still there. Whether `$.session.messages()` reflects the live context after a
  rewind is something to verify live, not something this plugin assumes.
- **Installing a precomputed summary.** A `precompute` compaction installs nothing when it runs, and
  whether installing its summary later raises another `session.compact` is unverified. The plugin
  drops a loop's reads on every trigger, `precompute` included, which over-invalidates and costs a
  few stubs, never a wrong one.
- **Claude Code's own dedup.** Core has a `file_unchanged` path of its own. It did not fire in a live
  session on 2.1.311 (three reads of one file returned the full contents each time), nor in the
  2.1.308 Desktop check, so it is gated or conditional. When it does fire, the plugin logs `core_dedup`, counts no saving, and tracks
  nothing.
- **Subrange bytes are a lower bound.** A range inside an earlier whole-file read is costed from the
  file's own lines, without the line-number prefixes the model saw.
- **The stub size is an estimate.** The comparison behind `stub_not_smaller` counts the stub as its
  result as JSON plus the context line, because a hook cannot see how Claude Code renders the
  result. For a subrange the replaced text is the lower-bound sum, which leaves out the line-number
  prefixes, so a borderline subrange may pass when a stub would just have won.
- **Read before Edit after a stub.** Claude Code refuses an `Edit` of a file the model has not read.
  Whether a stub counts as having read it is Claude Code's own check, which does not run under
  `claude plugin test`, so the tests cannot cover it. In the 2.1.308 Desktop check an `Edit` right
  after a stub was accepted, and so was one after a stub and an override.
- **Files that change without a tool the plugin watches.** `Write`, `Edit`, `MultiEdit`,
  `NotebookEdit` and `Bash` drop the tracked reads. A file changed by anything else (an MCP tool, an
  editor, another process) is caught only by the size and modified-time check and the hash, which
  run on every candidate repeat.
- **Files over 4 MiB.** A file `$.fs.read` cannot return is not tracked (`unreadable`).
- **`MultiEdit`.** The 2.1.311 declarations list no `MultiEdit` tool. The plugin still matches it by
  name, which does nothing on that build.

## What has been verified live

The testing-kit tests cover every decision, every reason, both loops, every invalidation and the
log. The current live check ran on top of them in the Code tab of the Claude Desktop app, with
`engine_version` 2.1.308 in every record. The plugin was loaded from branch head `d91c138`, with
`readMode` set to `ask`. The main probe file had 80 lines (`Read` showed 81, the last one empty).
Every step ran in one user turn, and every record had `mode: active` and `effective_mode: ask`.

| Step | Outcome |
|---|---|
| A. Read the whole file | Full, `pass`, `first_read` |
| B. Read it again | Stub: `dedupe`, `exact_repeat`, `gross_bytes` 865, `stub_bytes` 271, `bytes_saved` 594 |
| C. Read it a third time | Full: `override`, `override_after_stub` |
| D. Read `offset` 10, `limit` 20 | Full: `pass`, `stub_not_smaller` (160 bytes of lines against a 271-byte stub) |
| E. `Edit` line 40 | Accepted, no "file not read" error. `invalidate`, `edit`, 2 dropped |
| F. Read the whole file | Full, with the edit: `pass`, `first_read` |
| G. Read it again, then `Edit` | Stub (868/271/597), then the edit was accepted. `invalidate`, `edit`, 1 dropped |
| H. A subagent reads the file twice | Full, then a stub (875/271/604). Both records carry `is_subagent: true` |
| I. `Bash` (`true`), then a read | Full: `pass`, `first_read`, then `invalidate`, `bash`, 2 dropped (see the note) |
| J1. Read with `limit` 0 | Full: `pass`, `first_read` (see the note) |
| J2. Read with `limit` 0 again | Stub (875/271/604), `range_kind: full` |
| K. A 30-line CRLF file, read twice | Full (31 lines), then a stub (465/269/196) |
| L. A 30-line file with a BOM, read twice | Full (31 lines, BOM not shown), then a stub (435/267/168) |
| M. A 20-line file whose line 5 is 5000 `x`, read twice | Full (21 lines, line 5 not truncated), then a stub (5294/277/5017) |

Stub byte counts are `gross_bytes`/`stub_bytes`/`bytes_saved`. A `Bash` call that created the K, L
and M files logged `invalidate`, `bash`, 1 dropped.

What the model read for a stub, verbatim, in the main context and the subagent alike. Claude Code
rendered the `file_unchanged` result as:

> Wasted call — file unchanged since your last Read. Refer to that earlier tool_result instead.

and the plugin's context line beside it was:

> reread: &lt;path&gt; is unchanged since you read it at turn 1 (same content, 81 lines). Its contents
> are earlier in this conversation. Read it again only if you need it in full.

The line has the same shape for every file. Only the line count changes (31 for the CRLF and BOM
files, 21 for the long-line file).

The same run also showed:

- The content-match check tracks LF, CRLF, BOM and 5000-character-line files. All four were stubbed
  on the repeat read, and none fell back to a pass.
- `lines` in the record and the context line counts the trailing empty line (81 for an 80-line
  file), the same as the `Read` tool's own numbering.
- An `Edit` after a stubbed read is accepted. Claude Code still treats the file as read.
- `Edit` and `Bash` invalidation work, and `dropped` counts the entries cleared.
- Subagent reads are tracked and stubbed apart from the parent's, with the same stub text.
- All 17 path-specific records carry `path_hash`. The 4 `invalidate` records carry `dropped` and no
  `path_hash`. No record contains a raw path or file contents.
- `bytes_saved` is `gross_bytes` minus `stub_bytes` in every `dedupe` record.

Note on I and J1: the `Bash` call and the read in step I were sent in one message, as parallel tool
calls. The read was logged and tracked first, and the `Bash` hook's `invalidate` landed in the same
second and dropped it (2 entries: the main context's and the subagent's). That is why J1 came back
full as a `first_read` and not as a full-range repeat. Dropping a read that raced a `Bash` call is
the fail-safe result. A `Bash` call followed by a separate read logs the `invalidate` first.

An earlier live check, at `cba0844`, also passed steps A to J, before the content-match fix.

### Not verified live

- The `ask`-mode transcript line (the model cannot see it, and no person looked).
- `off` and `act` modes in a live session (only `ask` ran).
- The terminal CLI (only Desktop ran, on engine 2.1.308).
- Compaction, `/clear` and resume invalidation, and `turns_since_read` above 0 (every step ran in
  one user turn, so every stub says "turn 1").
- Rewind, and whether `$.session.messages()` reflects it.
- `precompute` install.
- A file changed on disk by something other than `Edit` or `Bash` in the session.
- The content-mismatch path. No step produced a read that was not tracked, so the fail-safe pass for
  mismatched content was not seen live.
- A line longer than the `Read` tool's own per-line truncation limit (the 5000-character line was
  shown in full).

## Development

```sh
claude --plugin-dir ~/dev/thrift/plugins/reread   # edits apply after /reload-plugins
claude plugin validate plugins/reread             # what the engine would load or refuse
scripts/check.sh reread                           # validate, tsc, the checks, and the tests
```

The README's `trigger_values.reason` row is checked against `DECISION_REASONS` by
`checks/reasons-match-readme.ts`, which `scripts/check.sh` runs, so a reason added to the code and
missing here fails the check.
