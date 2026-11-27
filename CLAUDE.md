# thrift

A marketplace of Claude Code plugins that reduce token spend. The global `~/.claude/CLAUDE.md`
covers process (issues, worktrees, the gauntlet, review, merge). This file covers only what is
specific to this repo.

## Repo shape

- Each plugin is self-contained under `plugins/<name>/`. Plugins never import from each other.
- `.claude-plugin/marketplace.json` lists every plugin with `"source": "./plugins/<name>"`. A
  plugin's entry lands in the same PR that adds the plugin, never before.
- Tests for the repo's own CI live in `.github/tests/`, not under a plugin. `canary-report.sh` pulls
  the canary step scripts out of `ci.yml` and runs them, with `scripts/check.sh`, against stub `gh`,
  `claude` and `tsc`.
  - It needs these tools:
    - `jq`
    - `openssl`
    - `dash`: three live-harness tests run the session command under a POSIX `sh`.
    - `ruby`: the release-merge workflow test parses `release-merge.yml` with Psych and compares
      the merge job as data. `ubuntu-latest` has Ruby.
    - `python3`: the same test builds its workflow variants with it, and the release-merge stubs
      build the `pr-record` zips with it.
    - `unzip`: the release-merge gate reads each CI run's `pr-record` artifact with it, in the
      tests and in the workflow. `ubuntu-latest` and macOS have it.
  - It runs on bash 3.2 and 5.
  - Pass part of a test function's name (not a file name) to run only matching tests:
    `.github/tests/canary-report.sh [name-fragment]`. A fragment that matches no test exits 1.
  - It runs every `.github/tests/*.test.sh`, so a new test file needs no wiring; each ends with
    `run_tests "$@"` so it honors the fragment. The shared code sits in the `*-lib.sh` and `*.awk`
    files beside them.
- Releases come from release-please in manifest mode (`.github/workflows/release-please.yml`, on
  push to `main`).
  - Config: `release-please-config.json` has one package per plugin (`plugins/<name>`,
    `release-type: simple`, `component: <name>`, tag `<name>-vX.Y.Z`) and
    `.release-please-manifest.json` holds each plugin's current version.
  - Release PRs: `separate-pull-requests` is `false`, so release-please keeps one combined release
    PR open (branch `release-please--branches--main`, title `chore: release main`) for every plugin
    with a `feat` or `fix` commit under its path. One PR avoids the conflicts separate PRs had:
    each rewrote `.release-please-manifest.json`, so once one merged the rest conflicted. The PR
    writes each released plugin's `plugins/<name>/CHANGELOG.md` and the `version` in its
    `plugin.json`; versions, changelogs and tags (`<name>-vX.Y.Z`, with a GitHub release each) stay
    per plugin. Never edit a plugin's `CHANGELOG.md` or the `version` in its `plugin.json` by hand.
    A commit that touches no plugin path (`scripts/`, `.github/`, root docs) releases nothing.
  - Which plugins a release-merge annotation covers: annotation titles name the PR number
    (`Release PR #N not merged`), never a plugin; two failures name no PR, `Release PR sweep failed`
    and `Release merge failed`. The combined PR's title names no plugin either, so a refused or
    failed merge holds every plugin in the PR. The PR body (one section per plugin) or its changed
    `plugins/<name>/` files say which. A refusal for a file outside the allowlist names that file
    (`plugins/<name>/... is not a file a release PR changes`). #215 tracks naming the plugins in
    annotations.
  - New plugin: it gets its config package and manifest entry in the same PR that adds it to
    `marketplace.json`. `.github/tests/release-config.test.sh` fails when either is missing, when
    the component is not the marketplace name, or when a manifest version differs from
    `plugin.json`.
  - Opening the PR: the release PR is opened with a GitHub App token (`RELEASE_APP_ID`,
    `RELEASE_APP_PRIVATE_KEY`), because a PR opened with `GITHUB_TOKEN` runs no CI.
  - Merging it: `.github/workflows/release-merge.yml` squash-merges the release PR once the CI
    workflow succeeds on it, so nobody approves or merges it. GitHub shows "Review required" on it
    while CI runs (about two minutes); that is expected. An agent never approves or merges a
    release PR by hand. If one is still open after CI passed, close and reopen it: that
    starts a fresh CI run, with a `pr-record`. Don't rerun an old run with `gh run rerun`: GitHub
    allows that only within 30 days of the first run, and a rerun reuses the run's original workflow
    file, so a run made before the `pr-record` job existed never gets a record.
  - The merge gate: the PR must be open, from a `release-please--*` branch in this repo, authored
    by the App, at the commit CI tested, and change only the manifest and each package's changelog,
    version file and extra-files, and the files API must have listed every file the PR changes
    (it stops at 3000, so the PR's `changed_files` must match the count listed and be at most
    3000). A CI run counts only if its `pr-record` artifact names this PR into `main` (next
    bullet). Anything else waits for a person.
  - The CI run record: `ci.yml`'s `pr-record` job (pull_request runs only) uploads an artifact
    `pr-record` holding `{"number": N, "base": "<ref>"}`, taken from the run's own event through
    `env:`. The runs API's `pull_requests` is no longer used: it lists every open PR at the head, and
    omits one that has closed. The gate counts a run only if its record names the release PR with
    base `main`. A run with no record, an expired or unreadable one, or one naming another PR does
    not count, and the PR is refused (CI path, with a warning annotation) or skipped (sweep, with
    the reason per run on stderr; a run whose record names another PR, a decoy, also gets a warning
    annotation naming the run and the record, while one with no record stays on stderr). A finished run with no record, or a record that cannot be read
    (a download cut short, or a record over 4096 bytes), that did not succeed (failed or cancelled) is
    not skipped: the lookup stops there and reports its conclusion, so an older success cannot stand
    in for it. A running one holds the PR the same way. Only a record that names another PR is skipped. Such a decoy run can hold a release PR for a person; that is fail-closed.
    It would come from a base whose `ci.yml` lacks the `pr-record` job, and only someone with write
    access can create one. A failed artifact lookup or download turns the job red ("cannot
    check the gate"); it never reads as a refusal. Records live 30 days. A release PR whose CI is older than that, or
    whose CI ran before the `pr-record` job existed, has no usable record, and a rerun does not help
    (GitHub allows one only within 30 days, and it reuses the run's original workflow file): close and
    reopen the PR, which starts a fresh CI run with a record. The remaining limit: a base branch whose `ci.yml` was edited
    by someone with write access can write any record it likes. The author, SHA and allowlist
    checks still apply.
  - Where the code lives: the gate, the sweep and the merge step live in three files under
    `.github/scripts/` (production code, so not under `.github/tests/`): `release-merge-lib.sh`
    (the gate and the merge step), `release-merge-ci-lookup.sh` (the CI-run and `pr-record`
    lookups, and the sweep) and `release-merge-outcome.sh` (the helpers that say how a merge
    attempt ended). The workflow step only sources `release-merge-lib.sh`, which sources the other
    two from its own directory, and calls `release_merge_run`. The merge job's sparse checkout lists
    each lib file by name, so a new lib file must be added there, and to
    `release-merge-workflow.expected.json`, or the step cannot source it. The tests find the lib
    through `RELEASE_MERGE_LIB`, defined in `canary-report-lib.sh`. The `release-merge-*.test.sh`
    files are split by subject (gate, sweep, record-check, step, ci-path, run, workflow,
    unparsed-pr, adversarial) and run the lib against the stub `gh` in `release-merge-stubs-lib.sh`;
    the step, ci-path and run files share `release-merge-step-lib.sh`.
    `release-merge-adversarial.test.sh` holds cases where the gate disagrees with what
    release-please writes or with the PR the workflow should merge.
  - Running that family: the name fragment `canary-report.sh` takes matches test *function* names,
    so `release_merge` matches almost nothing. Run the `release-merge-*.test.sh` files directly.
  - The workflow fixture: the workflow test compares the whole parsed `release-merge.yml` with
    `.github/tests/release-merge-workflow.expected.json`, so any change to the workflow must update
    that fixture in the same PR. Psych reads the YAML key `on` as `true`, so the fixture has a
    `"true"` key where the triggers are.
  - The sweep: the workflow has a second trigger, the Release Please workflow completing on a push
    to `main`. A commit that touches no plugin path leaves the release PR alone, so CI never
    reruns on it. That run sweeps every open `release-please--*` PR whose latest `CI` run at its
    current head succeeded and sends each through the same gate and merge. A head with no CI run
    yet, or one still running, is skipped (its own CI completion merges it). A CI lookup that fails
    turns the job red instead of reading as "no run yet". "Succeeded" means the latest run whose
    `pr-record` names the PR into `main`. The gate always checks one run's record, a required third
    argument: the CI-completion path (which the job `if` limits to a run of
    `.github/workflows/ci.yml`, as the sweep's lookup does) passes the triggering run (`CI_RUN_ID`) once `release_merge_ci_outcome` for the PR (number, tested
    SHA, head ref, base `main`) returns 0 with that same run id as the latest qualifying run (a manual
    rerun of an older success after a newer failure is refused with a warning naming both run ids; a
    failed lookup turns the job red), and the sweep passes
    the run it chose (it prints `<number> <sha> <run-id>`), so a swept PR's record is downloaded
    twice. An empty id is refused. The gate also still refuses a release PR while another open PR has
    the same head branch (for example a PR from the release branch into another base).
  - Tokens: the gate reads CI runs and their `pr-record` artifacts with the workflow's own
    `GITHUB_TOKEN` (job permission `actions: read`), because the App token has no Actions access; the PR list, the gate and the
    merge use the App token. The private key is `RELEASE_APP_PRIVATE_KEY` in the `release`
    environment, limited to `main` (both token-minting jobs set `environment: release`), so a
    branch workflow cannot mint a token.
  - Rulesets: the App must be a bypass actor (pull requests only) on the "main code-owner review"
    ruleset, or the merge is refused for want of a code-owner approval. A user-owned repo can't use
    classic `bypass_pull_request_allowances`, so the bypass has to live in a ruleset. That ruleset
    holds only the `pull_request` rule, and the required status checks stay in classic branch
    protection, because a ruleset bypass actor skips every rule in its ruleset. A second ruleset,
    "release-please branches", restricts creating, updating, deleting and force-pushing
    `refs/heads/release-please--*`, with the App as the only bypass actor (always). Only the App
    can write a release branch, so every commit the merge gate sees came from release-please. A
    gate check on commit authors would not be enough: GitHub takes a commit's author from its
    email, which anyone can set.
- `ci.yml` runs on `pull_request` only for PRs into `main` (`branches: [main]`, pinned by
  `ci-trigger.test.sh`), so an ordinary PR into another base produces no CI run. That is not a
  guarantee: a run takes its workflow file from the PR's merge commit, so a base branch whose
  `ci.yml` has no filter can still put a run on a release head. The release gate no longer trusts
  the run for that: it reads the run's `pr-record` (see "The CI run record" above), so such a decoy
  run names another PR and does not count (#117). A base branch whose `ci.yml` writes a forged
  record is the one thing left, and only someone with write access can create it; the gate's author,
  SHA and file-allowlist checks still apply. The cost: PRs into a base other than `main`, including
  the upper layers of a native stack, get no CI until GitHub retargets them to `main`.
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
  hooks/<helper>.tsx           engine-wiring helpers; `$` only in `function` declarations
  hooks/<logic>.ts             pure functions, no `$`, no engine calls
  types/index.d.ts             PluginState['<name>'] for every $.state value
  test/<name>.test.ts
```

- `hooks/register.tsx` does engine wiring. Other `hooks/*.tsx` are engine-wiring helpers: they
  may take `$`, but only through `function` declarations (`export function f($) {}`). On
  2.1.302, `claude plugin validate` refuses a `$`-taking `const` arrow in an imported module.
- `hooks/<logic>.ts` stays pure: no `$`, no engine calls.
- Wrap every hook: `on(...).catch(($, e, next) => next(e))`. A plugin here never blocks or
  breaks a turn.
- Claude Code refuses `/clear`, compaction, and `$.prompt.submit` inside a hook the turn is
  waiting on. Run them inside `$.clock.after(0, ...)`.
- `/clear` fires `session.end` with `reason: 'clear'`, and no `session.start` follows. State
  that must outlive a clear can't sit in the end-of-session reset, and anything registered at
  `session.start` has to be registered again by the plugin.
- `$.state` values used for drawing are atoms declared in `types/index.d.ts`. Module variables reset
  when the engine restarts the plugin (a `/config` change did on 2.1.299). Editing a `--plugin-dir`
  file does not reload the plugin; the change waits for `/reload-plugins`, which kept the plugin's
  state.

## Shared conventions

- **Mode setting**: `off` | `ask` | `act`, default `off`. `off` acts on nothing and logs a
  shadow baseline.
- **Decision log**: `$THRIFT_HOME/decisions.jsonl`, default `~/.claude/thrift/decisions.jsonl`.
  One record per evaluation, non-triggers included:
  `{ ts, session_id, component, mode, action, engine_version, trigger_values }`.
  - `ts`: ISO 8601 UTC.
  - `component`: the plugin's name.
  - `mode`: `shadow` only when the action is `none` and the plugin ran in `off` (the setting, or a
    fallback that holds it there); otherwise `active`. A request the person made, such as `/handoff`
    or a band press, is always `active`.
  - `engine_version`: the Claude Code release (`$.session.version()`'s `base`), or its `version`
    when `base` is missing. A change in behavior then shows up as a split between versions.
  - `trigger_values`: scalars only. Never prompt text, file contents, or paths the person typed.
- Append with `sh -c 'umask 077 && mkdir -p -- "$dir" && cat >> "$file" && chmod 600 "$file"'`
  through `$.process.run`, so the file is owner-only. `umask` applies only when the file is
  created; the `chmod` covers a file that already exists. Give `chmod` no `--`: BSD chmod reads
  it as a file and fails. A failed write goes to the debug log and the turn continues.
  Nothing from the log is ever written into context.

## Checks before every push

Run `npm ci` once, then `scripts/check.sh <name>...` with each plugin the change touches (no
arguments checks every plugin). CI runs the same script. For each plugin it lets the engine write
the type declarations, then runs these in order and stops at the first failure:

1. `claude plugin validate plugins/<name>`: no refusals.
2. `tsc -p plugins/<name>` (the root `package.json` pins TypeScript): zero errors.
   `claude plugin test` does not type-check, so only this step fails a `@ts-expect-error` test
   whose guarded type has been loosened.
3. `claude plugin test plugins/<name>`: all pass, no skipped tests, no network access.
   `plugin test` measures no coverage (checked on 2.1.294), so review enforces it: every
   exported function and every branch in `hooks/` has a test whose name says which, and
   `test-coverage-mapper` reports no uncovered changed function. A test cannot call a
   `$`-taking helper directly, so for those a `describe` named for the function meets "a test
   whose name says which". Go back to a measured 100% once `plugin test` reports coverage.

A check that reads a plugin's files goes in `plugins/<name>/checks/*.ts`, because `plugin test`
has no file system. `scripts/check.sh` runs each one with `node --experimental-strip-types` after
`tsc` and before `plugin test`. A non-zero exit, or a dangling symlink in `checks/`, fails the run.
This needs Node 22.6 or newer; older Node exits with "bad option", which also fails the run. Node
strips types without resolving imports, so a check imports its siblings with explicit `.ts`
extensions, and each module it imports uses only erasable TypeScript and has no runtime imports.
`tsc` does not cover `checks/` (that would need `@types/node` and `allowImportingTsExtensions`),
so a check only reads files, calls pure functions in `hooks/`, prints, and sets the exit code.
Everything else lives in `hooks/`, where `tsc` and `plugin test` cover it.

Tests use `claude-code/testing`. The kit mocks the clock, store, env, and `session.append`
directly (`mock.*`). Every other engine call (`model.fork`, `process.run`, `agent.list`,
`prompt.read`/`fill`, `command.run`, `session.compact`, `session.usage`) is mocked by the
test's own hooks beneath the plugin.

## Verifying in a real session

Some behavior only shows in an interactive terminal: bands, buttons, `/clear`, and resuming.
`scripts/live/live.sh <plugin> <scenario>` drives real sessions in tmux and prints PASS or FAIL
with the evidence. It is local only (CI has no authenticated `claude`); see
`scripts/live/README.md`. For anything it does not cover, verify by hand with
`claude --resume <id> --plugin-dir ~/dev/thrift/plugins/<name>` and paste the log records into the
PR. Say in the PR what was not verified live.
