import { finishesTask } from './command-parse'
import type { SessionState } from './session-state'
import { fieldOf, validTaskId } from './tasks'

// Only the keys this reads, so a call's input and result need no cast to reach it (KillShell is in no tool union).
export type TrackedCall = { readonly tool: string } & Readonly<Record<string, unknown>>
export type TrackedResult = { readonly deny?: string; readonly isError?: boolean; readonly result?: unknown }

export const noteToolCall = (state: SessionState, call: TrackedCall, ran: TrackedResult): void => {
  const didSucceed = ran.deny === undefined && ran.isError !== true
  if (call.tool === 'Bash') {
    const started = validTaskId(fieldOf(ran.result, 'backgroundTaskId'))
    if (started !== null) state.backgroundTasks.add(started)
    else if (didSucceed && typeof call.command === 'string' && finishesTask(call.command)) state.hasFinishedTask = true
  } else if (call.tool === 'Monitor') {
    const started = validTaskId(fieldOf(ran.result, 'taskId'))
    if (started !== null) state.backgroundTasks.add(started)
  } else if (ran.deny === undefined && (call.tool === 'TaskStop' || call.tool === 'KillShell')) {
    const stopped = validTaskId(call.task_id ?? call.shell_id)
    if (stopped !== null) state.backgroundTasks.delete(stopped)
  }
}
