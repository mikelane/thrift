import { describe, expect, test } from 'claude-code/testing'

import { showsLines } from '../hooks/shown-lines'

const FILE = 'one\ntwo\nthree\nfour'

describe('showsLines', () => {
  test('It is true when the content is the whole file', () => {
    expect(showsLines(FILE, { startLine: 1, numLines: 4, totalLines: 4 }, FILE)).toBe(true)
  })

  test('It is true when the content is the lines of the range', () => {
    expect(showsLines(FILE, { startLine: 2, numLines: 2, totalLines: 4 }, 'two\nthree')).toBe(true)
  })

  test('It is false when a line of the range differs', () => {
    expect(showsLines(FILE, { startLine: 2, numLines: 2, totalLines: 4 }, 'two\nTHREE')).toBe(false)
  })

  test('It is false when the content has fewer lines than the result says', () => {
    expect(showsLines(FILE, { startLine: 1, numLines: 4, totalLines: 4 }, 'one\ntwo\nthree')).toBe(false)
  })

  test('It is true for a CRLF file whose content Read gave without the carriage returns', () => {
    expect(showsLines('one\r\ntwo\r\n', { startLine: 1, numLines: 3, totalLines: 3 }, 'one\ntwo\n')).toBe(true)
  })

  test('It is true for a CRLF file whose content Read gave with the carriage returns', () => {
    expect(showsLines('one\r\ntwo\r\n', { startLine: 1, numLines: 3, totalLines: 3 }, 'one\r\ntwo\r\n')).toBe(true)
  })

  test('It is true for an empty file', () => {
    expect(showsLines('', { startLine: 1, numLines: 1, totalLines: 1 }, '')).toBe(true)
  })
})
