import type { ToolCallInput, ToolCallResult } from 'claude-code'

import { finishesTask } from './command-parse'
import type { SessionState } from './session-state'
import { fieldOf, validTaskId } from './tasks'

export const noteToolCall = (state: SessionState, e: ToolCallInput, ran: ToolCallResult) => {
  const didSucceed = ran.deny === undefined && ran.isError !== true
  if (e.tool === 'Bash') {
    const started = validTaskId(fieldOf(ran.result, 'backgroundTaskId'))
    if (started !== null) state.backgroundTasks.add(started)
    else if (didSucceed && finishesTask(e.command)) state.hasFinishedTask = true
  } else if (e.tool === 'Monitor') {
    const started = validTaskId(fieldOf(ran.result, 'taskId'))
    if (started !== null) state.backgroundTasks.add(started)
  } else if (ran.deny === undefined && (e.tool === 'TaskStop' || String(e.tool) === 'KillShell')) {
    const input: Readonly<Record<string, unknown>> = e
    const stopped = validTaskId(input.task_id ?? input.shell_id)
    if (stopped !== null) state.backgroundTasks.delete(stopped)
  }
}
