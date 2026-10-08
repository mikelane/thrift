import { expect, test } from 'claude-code/testing'

import {
  bash,
  completeTurn,
  growTo200k,
  install,
  lastRecord,
  notify,
  runCommand,
  runStep,
  startSession,
  tool,
  usageOf,
} from './helpers'

// Each test below pins one thing the plugin assumes about the engine and the types do not say.
// The assumption itself lives in test/helpers.ts, so one edit there follows it through every test.
// "Last confirmed live" names the Claude Code build it was last watched on, and how. Until the
// maintainer runs the live checks in the issue, nothing here has been confirmed live: each says so.

// Assumption: /clear ends the session from the plugin's view. It fires session.end with reason
// 'clear' and no session.start follows, so state is reset at session.end and nothing waits on a start.
// Last confirmed live: never. Read from SessionEndInput in the 2.1.295 declarations.
test('It treats /clear as session.end with reason clear and no session.start', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runStep($, world, { usage: usageOf(10, 20, 170) })
  await runCommand($, 'clear')
  await completeTurn($)
  expect(lastRecord(world).trigger_values.context_tokens).toBe(0)
  expect(world.sessionId).toBe('new-session')
})

// Assumption: a command registered before /clear may not survive it, so the plugin registers
// /handoff again after any clear, whether it ran the clear or the person did.
// Last confirmed live: never. Check by typing /handoff right after a clear (issue "Live verification").
test('It registers /handoff again after a clear because a registration may not survive it', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runCommand($, 'clear')
  await world.clock.settle()
  const afterClear = world.effects.slice(world.effects.indexOf('clear'))
  expect(afterClear).toContain('register:handoff')
})

// Assumption: a step that includes advisor calls reports their tokens summed with the main model's,
// and the main model's calls are 1 plus the number of advisor entries in serverToolUses.
// Last confirmed live: never. The "1 +" is an inference from the types (issue "Design resolutions").
test('It counts the main model as one call beside each advisor call', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runStep($, world, { usage: usageOf(30, 60, 210), advisorCalls: 2 })
  await completeTurn($)
  expect(lastRecord(world).trigger_values.context_tokens).toBe(100)
})

// Assumption: $.model.fork answers { isAnswered: false, reason: 'nothing-to-fork' } right after a
// /clear and before the first response, and the plugin treats any isAnswered: false as no handoff.
// Last confirmed live: never. Declared on ModelForkResult in 2.1.295.
test('It writes no handoff when the fork has nothing to fork', async ($, on) => {
  const world = install($, on)
  world.fork = async () => ({ isAnswered: false, reason: 'nothing-to-fork' }) as never
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.effects).not.toContain('clear')
  expect(lastRecord(world).trigger_values.reason).toBe('no_handoff_written')
})

// Assumption: a task-notification prompt carries the finished task's id in a <task-id> element,
// and its origin is only { kind: 'task-notification' } with no id.
// Last confirmed live: never. The origin shape is from PromptOrigin in 2.1.295; the element is from the issue.
test('It reads the finished task from a task-id element in a task-notification prompt', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await bash($, world, 'sleep 100', { result: { backgroundTaskId: 'bg1' } })
  await notify($, 'bg1')
  await completeTurn($)
  expect(lastRecord(world).trigger_values.is_background_busy).toBe(false)
})

// Assumption: a backgrounded Bash call answers backgroundTaskId, a Monitor call answers taskId, and
// TaskStop takes task_id (or the deprecated shell_id); KillShell is no registered tool.
// Last confirmed live: never. Declared in the 2.1.295 tool declarations (claude-code-tools).
test('It reads task ids from Bash, Monitor, and TaskStop results and inputs', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await bash($, world, 'sleep 100', { result: { backgroundTaskId: 'bash1' } })
  await tool($, world, 'Monitor', { command: 'tail -f log' }, { result: { taskId: 'mon1', timeoutMs: 0 } })
  await tool($, world, 'TaskStop', { task_id: 'bash1' })
  await completeTurn($)
  expect(lastRecord(world).trigger_values.is_background_busy).toBe(true)
  await tool($, world, 'TaskStop', { shell_id: 'mon1' })
  await completeTurn($)
  expect(lastRecord(world).trigger_values.is_background_busy).toBe(false)
})

// Assumption: $.session.compact answers { skip } when a hook vetoes it, and { tokensAfter } is the
// size the backoff measures from.
// Last confirmed live: never. Declared on SessionCompactResult in 2.1.295.
test('It reads a veto from the skip field of a compaction', { options: { handoffMode: 'act' } }, async ($, on) => {
  const world = install($, on)
  world.compact = async () => ({ skip: 'a hook vetoed it' })
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  await world.clock.settle()
  expect(lastRecord(world).trigger_values.reason).toBe('compaction_vetoed')
})

// Assumption: $.session.append stores a text-only user row the model reads and the person does not
// see, and answers { deny } when a plugin above refuses it.
// Last confirmed live: never. Described on $.session.append in 2.1.295.
test('It treats an append answered with deny as not stored', async ($, on) => {
  const world = install($, on)
  world.appendDenied = true
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.effects.filter(effect => effect.startsWith('entered:plugin:Handoff from the previous session'))).toHaveLength(1)
})

// Assumption: a development build reports base ending in -dev, and base is absent only when the
// version is not spelled as a release; both count as untested.
// Last confirmed live: never. Declared on SessionVersion in 2.1.295.
test('It treats a -dev base as untested', { options: { handoffMode: 'act' } }, async ($, on) => {
  const world = install($, on)
  world.version = { version: '2.1.295-dev.20260920.t1.sha1', base: '2.1.295-dev' }
  await startSession($)
  expect(lastRecord(world).action).toBe('untested_engine')
})
