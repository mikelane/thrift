import { describe, expect, test } from 'claude-code/testing'

import { classifyReadResult } from '../hooks/read-result'

const textFile = { filePath: '/work/a.ts', content: 'one\ntwo', numLines: 2, startLine: 1, totalLines: 2 }

describe('classifyReadResult', () => {
  test('It classifies a text result with its file and the text the model read', () => {
    const classified = classifyReadResult({ result: { type: 'text', file: textFile }, text: '1\tone\n2\ttwo' })
    expect(classified).toEqual({ kind: 'text', lines: { startLine: 1, numLines: 2, totalLines: 2 }, modelText: '1\tone\n2\ttwo' })
  })

  test('It carries the token cap flag of a text result', () => {
    const classified = classifyReadResult({
      result: { type: 'text', file: { ...textFile, truncatedByTokenCap: true } },
      text: 'x',
    })
    expect(classified).toEqual({ kind: 'text', lines: { startLine: 1, numLines: 2, totalLines: 2, truncatedByTokenCap: true }, modelText: 'x' })
  })

  test('It reads the model text as empty when the result has none', () => {
    expect(classifyReadResult({ result: { type: 'text', file: textFile } })).toMatchObject({ kind: 'text', modelText: '' })
  })

  test('It classifies core file_unchanged result as core_dedup', () => {
    expect(classifyReadResult({ result: { type: 'file_unchanged', file: { filePath: '/work/a.ts' } } })).toEqual({ kind: 'file_unchanged' })
  })

  test('It classifies a deny as an error', () => {
    expect(classifyReadResult({ deny: 'no' })).toEqual({ kind: 'error' })
  })

  test('It classifies an errored result as an error', () => {
    expect(classifyReadResult({ isError: true, result: 'failed', text: 'failed' })).toEqual({ kind: 'error' })
  })

  const nonTextTypes = ['image', 'pdf', 'parts', 'notebook']
  for (const type of nonTextTypes) {
    test(`It classifies a ${type} result as not text`, () => {
      expect(classifyReadResult({ result: { type, file: {} } })).toEqual({ kind: 'not_text' })
    })
  }

  test('It classifies a result that is not an object as not text', () => {
    expect(classifyReadResult({ result: 'plain' })).toEqual({ kind: 'not_text' })
  })

  test('It classifies a text result with no file as not text', () => {
    expect(classifyReadResult({ result: { type: 'text' } })).toEqual({ kind: 'not_text' })
  })

  test('It classifies a text result whose line counts are not numbers as not text', () => {
    expect(classifyReadResult({ result: { type: 'text', file: { ...textFile, numLines: '2' } } })).toEqual({ kind: 'not_text' })
  })

  test('It classifies a missing result as not text', () => {
    expect(classifyReadResult({})).toEqual({ kind: 'not_text' })
  })
})
