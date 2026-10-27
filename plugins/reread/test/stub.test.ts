import { describe, expect, test } from 'claude-code/testing'

import { lineByteLengths, savingsOf, stubContextLine, stubIsSmaller, stubResult, utf8Bytes } from '../hooks/stub'

describe('utf8Bytes', () => {
  test('It counts one byte for an ASCII character', () => {
    expect(utf8Bytes('abc')).toBe(3)
  })

  test('It counts the bytes of a multi-byte character', () => {
    expect(utf8Bytes('é€')).toBe(5)
  })
})

describe('lineByteLengths', () => {
  test('It counts each line with its newline', () => {
    expect(lineByteLengths('ab\ncde\nf')).toEqual([3, 4, 2])
  })

  test('It counts a multi-byte line in bytes', () => {
    expect(lineByteLengths('é')).toEqual([3])
  })

  test('It counts an empty file as one empty line', () => {
    expect(lineByteLengths('')).toEqual([1])
  })
})

describe('stubResult', () => {
  test('It answers with the native file_unchanged result for the path as given', () => {
    expect(stubResult('/work/a.ts')).toEqual({ type: 'file_unchanged', file: { filePath: '/work/a.ts' } })
  })
})

describe('stubContextLine', () => {
  test('It names the path, the turn and the line count', () => {
    expect(stubContextLine('/work/a.ts', 4, 120)).toBe(
      'reread: /work/a.ts is unchanged since you read it at turn 4 (same content, 120 lines). Its contents are earlier in this conversation. Read it again only if you need it in full.',
    )
  })

  test('It says one line in the singular', () => {
    expect(stubContextLine('/work/a.ts', 1, 1)).toContain('(same content, 1 line)')
  })
})

describe('savingsOf', () => {
  test('It takes the gross bytes the caller gives and the bytes of the stub result and context line', () => {
    const result = stubResult('/work/a.ts')
    const line = stubContextLine('/work/a.ts', 1, 3)
    expect(savingsOf(900, result, line)).toEqual({ grossBytes: 900, stubBytes: utf8Bytes(JSON.stringify(result)) + utf8Bytes(line) })
  })
})

describe('stubIsSmaller', () => {
  test('It is false when the stub is exactly as big as the text it replaces', () => {
    expect(stubIsSmaller({ grossBytes: 300, stubBytes: 300 })).toBe(false)
  })

  test('It is true when the stub is one byte smaller than the text it replaces', () => {
    expect(stubIsSmaller({ grossBytes: 300, stubBytes: 299 })).toBe(true)
  })

  test('It is false when the stub is bigger than the text it replaces', () => {
    expect(stubIsSmaller({ grossBytes: 58, stubBytes: 300 })).toBe(false)
  })
})
