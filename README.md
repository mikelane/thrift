# thrift

Claude Code plugins that keep your token spend down.

Every model call re-reads the whole session context, so a long session pays for its history on
every turn, mostly as cache reads. Accuracy also drops as context grows. Each plugin here pulls
one lever on that cost and logs what it decided, so you can measure whether it helped.

> **Status:** early development. `handoff` installs from this marketplace but has not yet been
> verified in a live terminal.

## Plugins

| Plugin | Status | What it does |
|---|---|---|
| [`handoff`](plugins/handoff) | early, not yet verified live | Past a context size you set, at a good stopping point, moves the work to a fresh session with a handoff note Claude writes. The old session stays resumable. |

## Install

Type this at the prompt of a Claude Code terminal session:

```
/plugin install <plugin> --marketplace mikelane/thrift
```

Answer `y` to add the marketplace, then choose a scope.

## Decision log

Every plugin appends one JSON object per evaluation to a shared log:

- Path: `$THRIFT_HOME/decisions.jsonl`, or `~/.claude/thrift/decisions.jsonl` when `THRIFT_HOME` is unset.
- The file is created readable by its owner only.
- Records are told apart by their `component` field (the plugin's name).
- Plugins log non-triggers too, so you can compute trigger rates. A plugin's `off` mode logs a
  shadow baseline: what it would have done, without doing it.
- Records hold scalars only, never prompt text.

## Development

Each plugin is self-contained under `plugins/<name>/`:

```sh
claude --plugin-dir ~/dev/thrift/plugins/<name>   # run it in a session; saves hot-reload
claude plugin validate plugins/<name>             # what the engine would load or refuse
claude plugin test plugins/<name>                 # run its *.test.ts files
```

See [CLAUDE.md](CLAUDE.md) for the conventions every plugin follows, and
[CONTRIBUTING.md](CONTRIBUTING.md) for how to propose a change.

## License

[MIT](LICENSE)
