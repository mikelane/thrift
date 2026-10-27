import { describe, expect, test } from 'claude-code/testing'

import {
  contextOf,
  dropAll,
  dropContext,
  dropPaths,
  findTracked,
  hasPath,
  isFullResult,
  newReads,
  requestOf,
  trackRead,
  type Tracked,
} from '../hooks/read-tracking'

const tracked = (overrides: Partial<Tracked> = {}): Tracked => ({
  toolUseId: 'toolu_1',
  realPath: '/work/a.ts',
  turn: 1,
  size: 100,
  mtimeMs: 5,
  sha256: 'h',
  startLine: 1,
  numLines: 10,
  totalLines: 10,
  textBytes: 500,
  isFull: true,
  lineBytes: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
  modelTextSha256: '',
  modelTextLength: 0,
  stubbedKeys: new Set(),
  ...overrides,
})

describe('contextOf', () => {
  test('It names the main loop when there is no agent id', () => {
    expect(contextOf(undefined)).toBe('main')
  })

  test('It names a subagent by its id', () => {
    expect(contextOf('agent-7')).toBe('agent-7')
  })
})

describe('requestOf', () => {
  test('It keys a read with no range as full', () => {
    expect(requestOf('/work/a.ts', {}).key).toBe('/work/a.ts|full')
  })

  test('It keys an offset of 1 with no limit as full', () => {
    expect(requestOf('/work/a.ts', { offset: 1 }).key).toBe('/work/a.ts|full')
  })

  test('It keys an offset of 0 with no limit as full', () => {
    expect(requestOf('/work/a.ts', { offset: 0 }).key).toBe('/work/a.ts|full')
  })

  test('It keys a range by its offset and limit', () => {
    expect(requestOf('/work/a.ts', { offset: 5, limit: 3 }).key).toBe('/work/a.ts|5:3')
  })

  test('It keys a limit with no offset from line 1', () => {
    expect(requestOf('/work/a.ts', { limit: 3 }).key).toBe('/work/a.ts|1:3')
  })

  test('It keys an offset with no limit as open-ended', () => {
    expect(requestOf('/work/a.ts', { offset: 5 }).key).toBe('/work/a.ts|5:end')
  })

  // Read reads to the end of the file for a limit of zero or less, as with no limit (2.1.311).
  test('It keys a limit of 0 as open-ended', () => {
    expect(requestOf('/work/a.ts', { offset: 5, limit: 0 }).key).toBe('/work/a.ts|5:end')
  })

  test('It keys a negative limit as open-ended', () => {
    expect(requestOf('/work/a.ts', { offset: 5, limit: -2 }).key).toBe('/work/a.ts|5:end')
  })

  test('It keys a negative limit from line 1 as full', () => {
    expect(requestOf('/work/a.ts', { limit: -2 }).isFull).toBe(true)
  })

  test('It adds the allow_large flag to the key', () => {
    expect(requestOf('/work/a.ts', { allow_large: true }).key).toBe('/work/a.ts|full+large')
  })

  test('It leaves the flag out when allow_large is false', () => {
    expect(requestOf('/work/a.ts', { allow_large: false }).key).toBe('/work/a.ts|full')
  })

  test('It reports a read with no range as full', () => {
    expect(requestOf('/work/a.ts', {}).isFull).toBe(true)
  })

  test('It reports a ranged read as not full', () => {
    expect(requestOf('/work/a.ts', { offset: 2, limit: 3 }).isFull).toBe(false)
  })

  test('It starts a request at line 1 when the offset is below 1', () => {
    expect(requestOf('/work/a.ts', { offset: -4, limit: 2 }).start).toBe(1)
  })

  test('It carries the limit when there is one', () => {
    expect(requestOf('/work/a.ts', { offset: 2, limit: 3 }).limit).toBe(3)
  })
})

describe('isFullResult', () => {
  test('It accepts a read from line 1 that returned every line', () => {
    expect(isFullResult({ startLine: 1, numLines: 10, totalLines: 10 })).toBe(true)
  })

  test('It refuses a read that started later', () => {
    expect(isFullResult({ startLine: 2, numLines: 9, totalLines: 10 })).toBe(false)
  })

  test('It refuses a read that stopped early', () => {
    expect(isFullResult({ startLine: 1, numLines: 5, totalLines: 10 })).toBe(false)
  })

  test('It refuses a read the token cap cut short', () => {
    expect(isFullResult({ startLine: 1, numLines: 10, totalLines: 10, truncatedByTokenCap: true })).toBe(false)
  })
})

describe('findTracked', () => {
  test('It finds nothing when the context holds no reads', () => {
    expect(findTracked(newReads(), 'main', requestOf('/work/a.ts', {}))).toBeUndefined()
  })

  test('It finds an exact repeat', () => {
    const reads = newReads()
    const first = tracked()
    trackRead(reads, 'main', '/work/a.ts|full', first)
    expect(findTracked(reads, 'main', requestOf('/work/a.ts', {}))).toEqual({ tracked: first, key: '/work/a.ts|full', match: 'exact' })
  })

  test('It finds a range inside a full read', () => {
    const reads = newReads()
    const full = tracked()
    trackRead(reads, 'main', '/work/a.ts|full', full)
    expect(findTracked(reads, 'main', requestOf('/work/a.ts', { offset: 3, limit: 4 }))?.match).toBe('inside_full')
  })

  test('It finds a range that runs past the end of a full read', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|full', tracked())
    expect(findTracked(reads, 'main', requestOf('/work/a.ts', { offset: 8, limit: 500 }))?.match).toBe('inside_full')
  })

  test('It finds an open-ended range inside a full read', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|full', tracked())
    expect(findTracked(reads, 'main', requestOf('/work/a.ts', { offset: 4 }))?.match).toBe('inside_full')
  })

  test('It finds nothing for a range that starts past the end of a full read', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|full', tracked())
    expect(findTracked(reads, 'main', requestOf('/work/a.ts', { offset: 11, limit: 2 }))).toBeUndefined()
  })

  test('It does not let a truncated read cover a range', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|full', tracked({ isFull: false, numLines: 6 }))
    expect(findTracked(reads, 'main', requestOf('/work/a.ts', { offset: 2, limit: 2 }))).toBeUndefined()
  })

  test('It finds an exact repeat of a truncated read', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|full', tracked({ isFull: false, numLines: 6 }))
    expect(findTracked(reads, 'main', requestOf('/work/a.ts', {}))?.match).toBe('exact')
  })

  test('It answers a full request from a full read taken with allow_large', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|full+large', tracked())
    expect(findTracked(reads, 'main', requestOf('/work/a.ts', {}))?.match).toBe('exact')
  })

  test('It does not let a range cover a full read', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|2:3', tracked({ isFull: false, startLine: 2, numLines: 3 }))
    expect(findTracked(reads, 'main', requestOf('/work/a.ts', {}))).toBeUndefined()
  })

  test('It does not let a different range cover another', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|2:3', tracked({ isFull: false, startLine: 2, numLines: 3 }))
    expect(findTracked(reads, 'main', requestOf('/work/a.ts', { offset: 4, limit: 3 }))).toBeUndefined()
  })

  test('It keeps the main loop and a subagent apart', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|full', tracked())
    expect(findTracked(reads, 'agent-1', requestOf('/work/a.ts', {}))).toBeUndefined()
  })

  test('It keeps two files apart', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|full', tracked())
    expect(findTracked(reads, 'main', requestOf('/work/b.ts', {}))).toBeUndefined()
  })

  test('It prefers the exact entry over a covering full read', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|full', tracked())
    const range = tracked({ isFull: false, startLine: 3, numLines: 4, toolUseId: 'toolu_2' })
    trackRead(reads, 'main', '/work/a.ts|3:4', range)
    expect(findTracked(reads, 'main', requestOf('/work/a.ts', { offset: 3, limit: 4 }))?.tracked).toBe(range)
  })
})

describe('hasPath', () => {
  test('It is false for a path the loop never read', () => {
    expect(hasPath(newReads(), 'main', '/work/zzz.ts')).toBe(false)
  })

  test('It is true for a path the loop read as a range', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|2:3', tracked({ isFull: false }))
    expect(hasPath(reads, 'main', '/work/a.ts')).toBe(true)
  })

  test('It is false for a path only another loop read', () => {
    const reads = newReads()
    trackRead(reads, 'agent-1', '/work/a.ts|full', tracked())
    expect(hasPath(reads, 'main', '/work/a.ts')).toBe(false)
  })
})

describe('trackRead', () => {
  test('It replaces the entry for the same key', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|full', tracked({ toolUseId: 'old' }))
    const fresh = tracked({ toolUseId: 'new' })
    trackRead(reads, 'main', '/work/a.ts|full', fresh)
    expect(findTracked(reads, 'main', requestOf('/work/a.ts', {}))?.tracked).toBe(fresh)
  })
})

describe('dropPaths', () => {
  test('It drops every entry for the path in every context', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|full', tracked())
    trackRead(reads, 'agent-1', '/work/a.ts|full', tracked())
    trackRead(reads, 'main', '/work/b.ts|full', tracked({ realPath: '/work/b.ts' }))
    expect(dropPaths(reads, ['/work/a.ts'])).toBe(2)
  })

  test('It leaves other files tracked', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|full', tracked())
    trackRead(reads, 'main', '/work/b.ts|full', tracked({ realPath: '/work/b.ts' }))
    dropPaths(reads, ['/work/a.ts'])
    expect(findTracked(reads, 'main', requestOf('/work/b.ts', {}))).toBeDefined()
  })

  test('It drops the ranges of the path too', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|full', tracked())
    trackRead(reads, 'main', '/work/a.ts|2:3', tracked({ isFull: false }))
    expect(dropPaths(reads, ['/work/a.ts'])).toBe(2)
  })

  test('It drops the entries of any path in the list', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|full', tracked())
    trackRead(reads, 'main', '/work/b.ts|full', tracked({ realPath: '/work/b.ts' }))
    expect(dropPaths(reads, ['/work/a.ts', '/work/b.ts'])).toBe(2)
  })

  test('It drops nothing for a path nobody read', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|full', tracked())
    expect(dropPaths(reads, ['/work/new.ts'])).toBe(0)
  })
})

describe('dropAll', () => {
  test('It drops every entry in every context and counts them', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|full', tracked())
    trackRead(reads, 'agent-1', '/work/b.ts|full', tracked({ realPath: '/work/b.ts' }))
    expect(dropAll(reads)).toBe(2)
  })

  test('It leaves nothing to find', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|full', tracked())
    dropAll(reads)
    expect(findTracked(reads, 'main', requestOf('/work/a.ts', {}))).toBeUndefined()
  })
})

describe('dropContext', () => {
  test('It drops the loop it is given and counts its entries', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|full', tracked())
    trackRead(reads, 'main', '/work/b.ts|full', tracked({ realPath: '/work/b.ts' }))
    expect(dropContext(reads, 'main')).toBe(2)
  })

  test('It leaves the other loops tracked', () => {
    const reads = newReads()
    trackRead(reads, 'main', '/work/a.ts|full', tracked())
    trackRead(reads, 'agent-1', '/work/a.ts|full', tracked())
    dropContext(reads, 'main')
    expect(findTracked(reads, 'agent-1', requestOf('/work/a.ts', {}))).toBeDefined()
  })

  test('It counts zero for a loop that read nothing', () => {
    expect(dropContext(newReads(), 'agent-9')).toBe(0)
  })
})
