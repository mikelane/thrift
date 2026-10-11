import { expect, test } from 'claude-code/testing'

import { createState } from '../hooks/session-state'
import { noteToolCall, type TrackedCall, type TrackedResult } from '../hooks/tool-call-tracking'

const noteCall = (call: TrackedCall, ran: TrackedResult, tasksBefore: readonly string[]) => {
  const state = createState({ setting: 'ask', threshold: 150_000, compactBeforeClear: false })
  state.backgroundTasks = new Set(tasksBefore)
  noteToolCall(state, call, ran)
  return { tasks: [...state.backgroundTasks], hasFinishedTask: state.hasFinishedTask }
}

const callCases = [
  ['a Bash call that starts a background task', { tool: 'Bash', command: 'sleep 9' }, { result: { backgroundTaskId: 'bg1' } }, [], ['bg1'], false],
  [
    'a Bash call that starts a background task with a finishing command',
    { tool: 'Bash', command: 'git push' },
    { result: { backgroundTaskId: 'bg1' } },
    [],
    ['bg1'],
    false,
  ],
  [
    'a Bash call whose background task id is not valid',
    { tool: 'Bash', command: 'git push' },
    { result: { backgroundTaskId: 'has space' } },
    [],
    [],
    true,
  ],
  ['a Bash call that finishes a task', { tool: 'Bash', command: 'git commit -m x' }, { result: {} }, [], [], true],
  ['a Bash call with no command', { tool: 'Bash' }, { result: {} }, [], [], false],
  ['a Bash call that does not finish a task', { tool: 'Bash', command: 'ls' }, { result: {} }, [], [], false],
  ['a Bash call that finishes a task and reports no error', { tool: 'Bash', command: 'git push' }, { isError: false, result: {} }, [], [], true],
  ['a Bash call that failed', { tool: 'Bash', command: 'git push' }, { isError: true, result: {} }, [], [], false],
  ['a Bash call that was denied', { tool: 'Bash', command: 'git push' }, { deny: 'no' }, [], [], false],
  ['a Monitor call that starts a task', { tool: 'Monitor' }, { result: { taskId: 'mon1' } }, ['bg1'], ['bg1', 'mon1'], false],
  ['a Monitor call whose task id is not valid', { tool: 'Monitor' }, { result: { taskId: 'a b' } }, ['bg1'], ['bg1'], false],
  ['a TaskStop call that stops a task', { tool: 'TaskStop', task_id: 'bg1' }, { result: {} }, ['bg1', 'bg2'], ['bg2'], false],
  ['a Monitor call that was denied', { tool: 'Monitor' }, { deny: 'no' }, ['bg1'], ['bg1'], false],
  ['a TaskStop call that errored', { tool: 'TaskStop', task_id: 'bg1' }, { isError: true, result: {} }, ['bg1', 'bg2'], ['bg2'], false],
  ['a TaskStop call for a task not tracked', { tool: 'TaskStop', task_id: 'bg9' }, { result: {} }, ['bg1'], ['bg1'], false],
  [
    'a TaskStop call that carries both a task id and a shell id',
    { tool: 'TaskStop', task_id: 'bg1', shell_id: 'bg2' },
    { result: {} },
    ['bg1', 'bg2'],
    ['bg2'],
    false,
  ],
  ['a TaskStop call that was denied', { tool: 'TaskStop', task_id: 'bg1' }, { deny: 'no' }, ['bg1'], ['bg1'], false],
  ['a TaskStop call whose task id is not valid', { tool: 'TaskStop', task_id: 'a b' }, { result: {} }, ['bg1'], ['bg1'], false],
  ['a KillShell call that stops a shell', { tool: 'KillShell', shell_id: 'bg1' }, { result: {} }, ['bg1'], [], false],
  ['a KillShell call that was denied', { tool: 'KillShell', shell_id: 'bg1' }, { deny: 'no' }, ['bg1'], ['bg1'], false],
  ['a KillShell call whose shell id is not valid', { tool: 'KillShell', shell_id: 'a b' }, { result: {} }, ['bg1'], ['bg1'], false],
  ['a Read call', { tool: 'Read', file_path: 'a.md' }, { result: {} }, ['bg1'], ['bg1'], false],
] as const

for (const [name, call, ran, tasksBefore, tasksAfter, hasFinishedTask] of callCases) {
  test(`It leaves tasks ${JSON.stringify(tasksAfter)} and finished ${hasFinishedTask} after ${name}`, () => {
    expect(noteCall(call, ran, tasksBefore)).toEqual({ tasks: tasksAfter, hasFinishedTask })
  })
}
