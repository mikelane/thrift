import { describe, expect, test } from 'claude-code/testing'

import { coveredLines, grossBytesOf, rangeKindOf } from '../hooks/coverage'
import { requestOf, type Found, type Tracked } from '../hooks/read-tracking'

const tracked = (overrides: Partial<Tracked> = {}): Tracked => ({
  toolUseId: 'toolu_1',
  realPath: '/work/a.ts',
  turn: 1,
  size: 100,
  mtimeMs: 5,
  sha256: 'h',
  startLine: 1,
  numLines: 5,
  totalLines: 5,
  textBytes: 500,
  isFull: true,
  lineBytes: [10, 20, 30, 40, 50],
  stubbedKeys: new Set(),
  ...overrides,
})

const found = (match: Found['match'], overrides: Partial<Tracked> = {}): Found => ({ tracked: tracked(overrides), key: 'k', match })

describe('grossBytesOf', () => {
  test('It takes the bytes of the original read for an exact repeat', () => {
    expect(grossBytesOf(found('exact'), requestOf('/work/a.ts', {}))).toBe(500)
  })

  test('It sums the lines of a range inside a full read', () => {
    expect(grossBytesOf(found('inside_full'), requestOf('/work/a.ts', { offset: 2, limit: 3 }))).toBe(90)
  })

  test('It sums to the end of the file for an open-ended range', () => {
    expect(grossBytesOf(found('inside_full'), requestOf('/work/a.ts', { offset: 4 }))).toBe(90)
  })

  test('It stops at the last line when the limit runs past the end', () => {
    expect(grossBytesOf(found('inside_full'), requestOf('/work/a.ts', { offset: 5, limit: 99 }))).toBe(50)
  })
})

describe('coveredLines', () => {
  test('It counts the lines of the original read for an exact repeat', () => {
    expect(coveredLines(found('exact'), requestOf('/work/a.ts', {}))).toBe(5)
  })

  test('It counts the lines of a range inside a full read', () => {
    expect(coveredLines(found('inside_full'), requestOf('/work/a.ts', { offset: 2, limit: 3 }))).toBe(3)
  })

  test('It counts to the end of the file for an open-ended range', () => {
    expect(coveredLines(found('inside_full'), requestOf('/work/a.ts', { offset: 4 }))).toBe(2)
  })

  test('It stops at the last line when the limit runs past the end', () => {
    expect(coveredLines(found('inside_full'), requestOf('/work/a.ts', { offset: 5, limit: 99 }))).toBe(1)
  })
})

describe('rangeKindOf', () => {
  test('It calls an exact repeat of a whole-file read full', () => {
    expect(rangeKindOf(found('exact'), requestOf('/work/a.ts', {}))).toBe('full')
  })

  test('It calls an exact repeat of a range a range', () => {
    expect(rangeKindOf(found('exact'), requestOf('/work/a.ts', { offset: 2, limit: 2 }))).toBe('range')
  })

  test('It calls a range inside a full read a subrange', () => {
    expect(rangeKindOf(found('inside_full'), requestOf('/work/a.ts', { offset: 2, limit: 2 }))).toBe('subrange')
  })
})
