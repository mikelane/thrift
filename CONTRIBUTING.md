# Contributing to thrift

Thanks for your interest. This guide covers filing issues and landing changes.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you
agree to uphold it.

## Ways to contribute

- **Bug reports**: open an issue with the bug report template. Include your Claude Code version
  (`claude --version`) and the relevant lines from your decision log.
- **Plugin ideas**: open an issue with the feature request template. Say which token cost the
  idea cuts and how you would measure it.
- **Docs and code**: fixes, features, tests. Follow the workflow below.

## Development setup

You need Claude Code. There is nothing else to install yet.

    git clone https://github.com/mikelane/thrift
    cd thrift
    claude --plugin-dir plugins/<name>     # run a plugin in a session; saves hot-reload

[CLAUDE.md](CLAUDE.md) lists the conventions every plugin follows: layout, hooks that never
block a turn, and the shared decision log.

## Pull request workflow

1. **File an issue first** for anything beyond a typo, so the approach is agreed before code.
2. Fork the repo and create a branch: `issue-NNN-short-description`.
3. Write the test before the code.
4. Before pushing, run these for each plugin you touched. All must be clean:

       claude plugin validate plugins/<name>
       tsc -p plugins/<name>
       claude plugin test plugins/<name>

5. Commit using [Conventional Commits](https://www.conventionalcommits.org/).
6. Open a PR and fill in the template, including what you verified in a live session and what
   you did not.

## Commit style

    type(scope): short imperative summary

    - type: feat | fix | chore | docs | test | refactor | perf | ci
    - scope: the plugin name when the change is inside one, e.g. (handoff)
    - summary: lowercase, no trailing period, at most 72 characters

## Reporting security issues

**Do not open a public issue for a security vulnerability.** See [SECURITY.md](SECURITY.md).
