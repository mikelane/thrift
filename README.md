# thrift

Claude Code plugins that keep your token spend down.

Every model call re-reads the whole session context, so a long session pays for its history on
every turn, mostly as cache reads. Accuracy also drops as context grows. Each plugin here pulls
one lever on that cost and logs what it decided, so you can measure whether it helped.

> **Status:** early development. `handoff` is listed in this marketplace; an install from it has
> not been tried yet. Parts of the plugin have been verified in live terminals on Claude Code
> 2.1.299 through 2.1.302, by hand and with a tmux harness; the rest has not. See the
> [verified and unverified lists](plugins/handoff/README.md#what-has-been-verified-live).

## Plugins

| Plugin | Status | What it does |
|---|---|---|
| [`handoff`](plugins/handoff) | early, partly verified live on 2.1.302 ([details](plugins/handoff/README.md#what-has-been-verified-live)) | Past a context size you set, at a good stopping point, moves the work to a fresh session with a handoff note Claude writes. The old session stays resumable. |

## Install

Type this at the prompt of a Claude Code terminal session:

```
/plugin install <plugin> --marketplace mikelane/thrift
```

Answer `y` to add the marketplace, then choose a scope.

## Update

Claude Code installs a copy of each plugin and replaces it only when the plugin's `version` changes.
Each plugin is released on its own: a release PR bumps the `version` in its `plugin.json` and writes
its `CHANGELOG.md`, and merging that PR tags `<plugin>-vX.Y.Z` and publishes a GitHub release. Until
a release lands, an update finds nothing new.

To update by hand, either type this in a session:

```
/plugin marketplace update thrift
```

or run this in a shell:

```sh
claude plugin update <plugin>@thrift
```

The running session keeps the version it loaded. Run `/reload-plugins` to switch to the new one, or
start a new session.

Auto-update is off by default for a third-party marketplace like this one. To turn it on, type
`/plugin`, go to **Marketplaces**, select `thrift`, and select **Enable auto-update**. Claude Code
then refreshes the marketplace and its installed plugins in the background after a session starts.

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
claude --plugin-dir ~/dev/thrift/plugins/<name>   # edits apply after /reload-plugins
claude plugin validate plugins/<name>             # what the engine would load or refuse
claude plugin test plugins/<name>                 # run its *.test.ts files
```

See [CLAUDE.md](CLAUDE.md) for the conventions every plugin follows, and
[CONTRIBUTING.md](CONTRIBUTING.md) for how to propose a change.

## License

[MIT](LICENSE)
