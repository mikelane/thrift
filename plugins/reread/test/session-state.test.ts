import { describe, expect, test } from 'claude-code/testing'

import { asReadMode } from '../hooks/read-mode'
import { createState, endSession } from '../hooks/session-state'
import { requestOf, trackRead, findTracked, type Tracked } from '../hooks/read-tracking'

const entry: Tracked = {
  toolUseId: 't',
  realPath: '/work/a.ts',
  turn: 1,
  size: 1,
  mtimeMs: 1,
  sha256: 'h',
  startLine: 1,
  numLines: 1,
  totalLines: 1,
  textBytes: 1,
  isFull: true,
  lineBytes: [1],
  stubbedKeys: new Set(),
}

describe('asReadMode', () => {
  const accepted = ['off', 'ask', 'act'] as const
  for (const mode of accepted) {
    test(`It accepts ${mode}`, () => {
      expect(asReadMode(mode)).toBe(mode)
    })
  }

  test('It reads anything else as off', () => {
    expect(asReadMode('always')).toBe('off')
  })

  test('It reads an unset value as off', () => {
    expect(asReadMode(undefined)).toBe('off')
  })
})

describe('createState', () => {
  test('It holds the setting it is given', () => {
    expect(createState('ask').setting).toBe('ask')
  })

  test('It starts with no reads tracked', () => {
    expect(createState('act').reads.size).toBe(0)
  })

  test('It gives each session state its own salt', () => {
    expect(createState('act').salt).not.toBe(createState('act').salt)
  })
})

describe('endSession', () => {
  test('It returns how many reads it dropped', () => {
    const state = createState('act')
    trackRead(state.reads, 'main', '/work/a.ts|full', entry)
    expect(endSession(state)).toBe(1)
  })

  test('It leaves no read to find', () => {
    const state = createState('act')
    trackRead(state.reads, 'main', '/work/a.ts|full', entry)
    endSession(state)
    expect(findTracked(state.reads, 'main', requestOf('/work/a.ts', {}))).toBeUndefined()
  })

  test('It draws a new salt for the next session', () => {
    const state = createState('act')
    const before = state.salt
    endSession(state)
    expect(state.salt).not.toBe(before)
  })
})
