import { describe, expect, test } from 'claude-code/testing'

import {
  compact,
  endSessionWith,
  install,
  isStub,
  lastRecord,
  putFile,
  read,
  runTool,
  SEVEN_LINES,
  triggerValues,
} from './world'

const ACT = { options: { readMode: 'act' } }

describe('noteCompaction on session.compact', () => {
  const triggers = ['manual', 'auto', 'plugin', 'precompute'] as const
  for (const trigger of triggers) {
    test(`It drops the main loop's reads after a ${trigger} compaction`, ACT, async ($, on) => {
      const world = install($, on)
      putFile(world, '/work/a.ts', SEVEN_LINES)
      await read($, '/work/a.ts')
      await compact($, trigger)
      const after = await read($, '/work/a.ts')
      expect(isStub(after)).toBe(false)
    })
  }

  test('It records the compaction as an invalidation with the count dropped', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    putFile(world, '/work/b.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/b.ts')
    await compact($, 'auto')
    expect([lastRecord(world).action, triggerValues(world).reason, triggerValues(world).dropped]).toEqual(['invalidate', 'compaction', 2])
  })

  test('It leaves a subagent’s reads when the main loop compacts', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts', { agentId: 'agent-1' })
    await compact($, 'auto')
    const after = await read($, '/work/a.ts', { agentId: 'agent-1' })
    expect(isStub(after)).toBe(true)
  })

  test('It drops only the subagent’s reads when the subagent compacts', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts', { agentId: 'agent-1' })
    await compact($, 'auto', 'agent-1')
    const [main, agent] = [await read($, '/work/a.ts'), await read($, '/work/a.ts', { agentId: 'agent-1' })]
    expect([isStub(main), isStub(agent)]).toEqual([true, false])
  })

  test('It records a subagent’s compaction as is_subagent', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts', { agentId: 'agent-1' })
    await compact($, 'auto', 'agent-1')
    expect(triggerValues(world).is_subagent).toBe(true)
  })

  test('It keeps the reads when the compaction was vetoed', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    world.compactSkips = true
    await compact($, 'manual')
    const after = await read($, '/work/a.ts')
    expect(isStub(after)).toBe(true)
  })

  test('It writes no record for a compaction that dropped nothing', ACT, async ($, on) => {
    const world = install($, on)
    await compact($, 'auto')
    expect(world.records).toEqual([])
  })
})

describe('noteSessionEnd on session.end', () => {
  const reasons = ['clear', 'resume', 'other'] as const
  for (const reason of reasons) {
    test(`It drops every read when the session ends with ${reason}`, ACT, async ($, on) => {
      const world = install($, on)
      putFile(world, '/work/a.ts', SEVEN_LINES)
      await read($, '/work/a.ts')
      await read($, '/work/a.ts', { agentId: 'agent-1' })
      await endSessionWith($, reason)
      const [main, agent] = [await read($, '/work/a.ts'), await read($, '/work/a.ts', { agentId: 'agent-1' })]
      expect([isStub(main), isStub(agent)]).toEqual([false, false])
    })
  }

  test('It records the drop with reason clear and the ending session’s id', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    world.sessionId = 'session-2'
    await endSessionWith($, 'clear', 'session-1')
    expect([lastRecord(world).session_id, triggerValues(world).reason, triggerValues(world).dropped]).toEqual(['session-1', 'clear', 1])
  })

  test('It writes no record when nothing was tracked', ACT, async ($, on) => {
    const world = install($, on)
    await endSessionWith($, 'clear')
    expect(world.records).toEqual([])
  })
})

describe('noteToolRan after a file-editing tool', () => {
  const editors = [
    ['Edit', { file_path: '/work/a.ts' }],
    ['Write', { file_path: '/work/a.ts' }],
    ['MultiEdit', { file_path: '/work/a.ts' }],
    ['NotebookEdit', { notebook_path: '/work/a.ts' }],
  ] as const
  for (const [tool, input] of editors) {
    test(`It drops the path's reads after ${tool}`, ACT, async ($, on) => {
      const world = install($, on)
      putFile(world, '/work/a.ts', SEVEN_LINES)
      await read($, '/work/a.ts')
      await runTool($, tool, input)
      const after = await read($, '/work/a.ts')
      expect(isStub(after)).toBe(false)
    })
  }

  test('It records the edit with the count dropped', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts', { offset: 1, limit: 2 })
    await read($, '/work/a.ts', { offset: 4, limit: 2 })
    await runTool($, 'Edit', { file_path: '/work/a.ts' })
    expect([lastRecord(world).action, triggerValues(world).reason, triggerValues(world).dropped]).toEqual(['invalidate', 'edit', 2])
  })

  test('It drops the path in every loop', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts', { agentId: 'agent-1' })
    await runTool($, 'Edit', { file_path: '/work/a.ts' })
    const [main, agent] = [await read($, '/work/a.ts'), await read($, '/work/a.ts', { agentId: 'agent-1' })]
    expect([isStub(main), isStub(agent)]).toEqual([false, false])
  })

  test('It drops the path when a subagent makes the edit', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await runTool($, 'Edit', { file_path: '/work/a.ts' }, 'agent-1')
    expect(isStub(await read($, '/work/a.ts'))).toBe(false)
  })

  test('It records an edit by a subagent as is_subagent', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await runTool($, 'Edit', { file_path: '/work/a.ts' }, 'agent-1')
    expect(triggerValues(world).is_subagent).toBe(true)
  })

  test('It leaves other files tracked', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    putFile(world, '/work/b.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/b.ts')
    await runTool($, 'Edit', { file_path: '/work/b.ts' })
    const untouched = await read($, '/work/a.ts')
    expect(isStub(untouched)).toBe(true)
  })

  test('It finds the path through a symlink by its real path', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    world.links.set('/work/link.ts', '/work/a.ts')
    await read($, '/work/a.ts')
    await runTool($, 'Edit', { file_path: '/work/link.ts' })
    const after = await read($, '/work/a.ts')
    expect(isStub(after)).toBe(false)
  })

  test('It drops a path the tool created, even when it is not on disk to resolve', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    world.statThrowsFor.add('/work/a.ts')
    await runTool($, 'Write', { file_path: '/work/a.ts' })
    world.statThrowsFor.clear()
    const after = await read($, '/work/a.ts')
    expect(isStub(after)).toBe(false)
  })

  test('It drops the path the tool was given when the engine resolves no real path', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    world.unresolvable.add('/work/a.ts')
    await runTool($, 'Edit', { file_path: '/work/a.ts' })
    world.unresolvable.clear()
    expect(isStub(await read($, '/work/a.ts'))).toBe(false)
  })

  test('It writes no record when the edit touched a path nobody read', ACT, async ($, on) => {
    const world = install($, on)
    await runTool($, 'Edit', { file_path: '/work/new.ts' })
    expect(world.records).toEqual([])
  })

  test('It ignores an editing call with no path', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await runTool($, 'Edit', {})
    const after = await read($, '/work/a.ts')
    expect(isStub(after)).toBe(true)
  })

  test('It returns the tool’s own result', ACT, async ($, on) => {
    const world = install($, on)
    const ran = await runTool($, 'Edit', { file_path: '/work/a.ts' })
    expect([ran.text, world.otherToolsThatRan]).toEqual(['ran Edit', ['Edit']])
  })
})

describe('noteToolRan after Bash', () => {
  test('It drops every read in every loop', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts', { agentId: 'agent-1' })
    await runTool($, 'Bash', { command: 'ls' })
    const [main, agent] = [await read($, '/work/a.ts'), await read($, '/work/a.ts', { agentId: 'agent-1' })]
    expect([isStub(main), isStub(agent)]).toEqual([false, false])
  })

  test('It records the drop with reason bash and the count', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await runTool($, 'Bash', { command: 'ls' })
    expect([lastRecord(world).action, triggerValues(world).reason, triggerValues(world).dropped]).toEqual(['invalidate', 'bash', 1])
  })

  test('It records a Bash from a subagent as is_subagent', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await runTool($, 'Bash', { command: 'ls' }, 'agent-1')
    expect(triggerValues(world).is_subagent).toBe(true)
  })

  test('It writes no record when nothing was tracked', ACT, async ($, on) => {
    const world = install($, on)
    await runTool($, 'Bash', { command: 'ls' })
    expect(world.records).toEqual([])
  })

  test('It records no invalidation as acting in off', { options: { readMode: 'off' } }, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await runTool($, 'Bash', { command: 'ls' })
    expect([lastRecord(world).action, lastRecord(world).mode, triggerValues(world).decision]).toEqual(['none', 'shadow', 'invalidate'])
  })
})

describe('noteToolRan after a tool that edits nothing', () => {
  test('It leaves the reads alone after a tool that changes no file', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await runTool($, 'Grep', { pattern: 'x' })
    const after = await read($, '/work/a.ts')
    expect(isStub(after)).toBe(true)
  })
})
