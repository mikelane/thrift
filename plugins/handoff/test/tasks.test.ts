import { expect, test } from 'claude-code/testing'

import { fieldOf, notifiedTaskId, validTaskId } from '../hooks/tasks'

const validIdCases = [
  ['bg1', 'bg1'],
  ['A_b-9', 'A_b-9'],
  ['', null],
  ['has space', null],
  ['semi;colon', null],
  ['new\nline', null],
  ['<tag>', null],
  [42, null],
  [null, null],
  [undefined, null],
] as const

for (const [input, expected] of validIdCases) {
  test(`It returns ${JSON.stringify(expected)} from validTaskId for ${JSON.stringify(input)}`, () => {
    expect(validTaskId(input)).toBe(expected)
  })
}

const fieldCases = [
  [{ taskId: 'a' }, 'taskId', 'a'],
  [{ taskId: 'a' }, 'other', undefined],
  ['text', 'taskId', undefined],
  [null, 'taskId', undefined],
  [undefined, 'taskId', undefined],
  [7, 'taskId', undefined],
] as const

for (const [value, key, expected] of fieldCases) {
  test(`It returns ${JSON.stringify(expected)} from fieldOf for ${JSON.stringify(value)} and key ${key}`, () => {
    expect(fieldOf(value, key)).toBe(expected)
  })
}

const notifiedCases = [
  ['<task-notification><task-id>bg1</task-id></task-notification>', 'bg1'],
  ['before <task-id>a-b_c</task-id> after', 'a-b_c'],
  ['<task-id></task-id>', null],
  ['<task-id>bad id</task-id>', null],
  ['<task-id>unclosed', null],
  ['no tag at all', null],
] as const

for (const [text, expected] of notifiedCases) {
  test(`It returns ${JSON.stringify(expected)} from notifiedTaskId for ${JSON.stringify(text)}`, () => {
    expect(notifiedTaskId(text)).toBe(expected)
  })
}
