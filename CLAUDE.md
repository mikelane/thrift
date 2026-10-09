# thrift

A marketplace of Claude Code plugins that reduce token spend. The global `~/.claude/CLAUDE.md`
covers process (issues, worktrees, the gauntlet, review, merge). This file covers only what is
specific to this repo.

## Repo shape

- Each plugin is self-contained under `plugins/<name>/`. Plugins never import from each other.
- `.claude-plugin/marketplace.json` lists every plugin with `"source": "./plugins/<name>"`. A
  plugin's entry lands in the same PR that adds the plugin, never before.
- Each plugin has its own `README.md` covering its mechanism, settings, and log fields. The root
  README keeps only the plugin table.

## API authority

The engine's type declarations are the only source for API shapes (`$`, events, elements, the
testing kit). The API is early access and changes between releases.

- After a `--plugin-dir` load: `plugins/<name>/.claude-plugin/types/claude-code/index.d.ts`
  (gitignored; the engine rewrites it on every load).
- Before the first load: invoke the `plugin-authoring` skill, which writes the declarations and
  names their path.

Never take a shape from memory, from a README, or from another plugin's code. Grep the
declarations for the name and read the declaration you land on.

## Plugin conventions

```
plugins/<name>/
  .claude-plugin/plugin.json   name, one-line description, version, userConfig, "types"
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           engine wiring; session state in one object
  hooks/<logic>.ts             pure functions, no `$`, no engine calls
  types/index.d.ts             PluginState['<name>'] for every $.state value
  test/<name>.test.ts
```

- Wrap every hook: `on(...).catch(($, e, next) => next(e))`. A plugin here never blocks or
  breaks a turn.
- Claude Code refuses `/clear`, compaction, and `$.prompt.submit` inside a hook the turn is
  waiting on. Run them inside `$.clock.after(0, ...)`.
- `/clear` fires `session.end` with `reason: 'clear'`, and no `session.start` follows. State
  that must outlive a clear can't sit in the end-of-session reset, and anything registered at
  `session.start` has to be registered again by the plugin.
- `$.state` values used for drawing are atoms declared in `types/index.d.ts`. Module variables
  reset on every hot reload.

## Shared conventions

- **Mode setting**: `off` | `ask` | `act`, default `off`. `off` acts on nothing and logs a
  shadow baseline.
- **Decision log**: `$THRIFT_HOME/decisions.jsonl`, default `~/.claude/thrift/decisions.jsonl`.
  One record per evaluation, non-triggers included:
  `{ ts, session_id, component, mode, action, engine_version, trigger_values }`.
  - `ts`: ISO 8601 UTC.
  - `component`: the plugin's name.
  - `mode`: `shadow` only when the action is `none` and the plugin ran in `off` (the setting, or a fallback that holds it there); otherwise `active`.
  - `engine_version`: the Claude Code release (`$.session.version()`'s `base`), or its `version`
    when `base` is missing. A change in behavior then shows up as a split between versions.
  - `trigger_values`: scalars only. Never prompt text, file contents, or paths the person typed.
- Append with `sh -c 'umask 077 && mkdir -p "$dir" && cat >> "$file"'` through `$.process.run`,
  so the file is created owner-only. A failed write goes to the debug log and the turn continues.
  Nothing from the log is ever written into context.

## Checks before every push

Run these for each plugin the change touches:

1. `claude plugin validate plugins/<name>`: no refusals.
2. `tsc -p plugins/<name>`: zero errors.
3. `claude plugin test plugins/<name>`: all pass, no skipped tests, no network access.
   `plugin test` measures no coverage (checked on 2.1.294), so review enforces it: every
   exported function and every branch in `hooks/` has a test whose name says which, and
   `test-coverage-mapper` reports no uncovered changed function. Go back to a measured 100%
   once `plugin test` reports coverage.

Tests use `claude-code/testing`. The kit mocks the clock, store, env, and `session.append`
directly (`mock.*`). Every other engine call (`model.fork`, `process.run`, `agent.list`,
`prompt.read`/`fill`, `command.run`, `session.compact`, `session.usage`) is mocked by the
test's own hooks beneath the plugin.

## Verifying in a real session

Some behavior only shows in an interactive terminal: bands, buttons, `/clear`, and resuming.
Verify it with `claude --resume <id> --plugin-dir ~/dev/thrift/plugins/<name>` and paste the log
records into the PR. Say in the PR what was not verified live.
