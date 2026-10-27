import type { EngineInterface } from 'claude-code'

import type { DecisionReason } from './decision-record'
import { engineInfo } from './engine-info'
import { debug } from './engine-log'
import { contextOf, dropAll, dropContext, dropPaths } from './read-tracking'
import { writeRecord } from './record-writer'
import { endSession, type SessionState } from './session-state'

// Only the keys this reads, so a call's input needs no cast to reach them.
type ToolCall = { readonly tool: string; readonly agentId?: string } & Readonly<Record<string, unknown>>

const FILE_EDITING_TOOLS: readonly string[] = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']

const pathOf = (call: ToolCall): string | undefined => {
  const path = call.file_path ?? call.notebook_path
  return typeof path === 'string' ? path : undefined
}

// A file written for the first time has no real path before the tool runs, so this is asked after it.
async function pathsNamedBy($: EngineInterface, path: string): Promise<string[]> {
  try {
    const { realPath } = await $.fs.stat(path, { resolve: true })
    return realPath === undefined ? [path] : [path, realPath]
  } catch (error) {
    debug($, `could not resolve an edited path: ${String(error)}`)
    return [path]
  }
}

async function noteDropped($: EngineInterface, state: SessionState, dropped: number, reason: DecisionReason, agentId: string | undefined, sessionId?: string) {
  if (dropped === 0) return
  const engine = await engineInfo($, state)
  await writeRecord($, engine, { decision: 'invalidate', reason, dropped, isSubagent: agentId !== undefined }, sessionId)
}

// Runs after the tool, and never throws: the tool has already run, and a failure here must not run it again.
// SAFETY: every call inside the try catches its own engine failures, so no test reaches this catch. Keep it: the hook's own
// .catch would run the tool a second time, and a second Bash or Edit is not harmless.
export async function noteToolRan($: EngineInterface, state: SessionState, call: ToolCall): Promise<void> {
  try {
    if (call.tool === 'Bash') return await noteDropped($, state, dropAll(state.reads), 'bash', call.agentId)
    const path = FILE_EDITING_TOOLS.includes(call.tool) ? pathOf(call) : undefined
    if (path === undefined) return
    await noteDropped($, state, dropPaths(state.reads, await pathsNamedBy($, path)), 'edit', call.agentId)
  } catch (error) {
    debug($, `could not drop reads after ${call.tool}: ${String(error)}`)
  }
}

// SAFETY: as for noteToolRan, no test reaches the catch; it is the guard against an unhandled rejection if a call inside changes.
// A compaction that stands replaces the loop's context with a summary; one that was vetoed leaves it as it is.
export async function noteCompaction($: EngineInterface, state: SessionState, agentId: string | undefined, isVetoed: boolean): Promise<void> {
  try {
    if (isVetoed) return
    await noteDropped($, state, dropContext(state.reads, contextOf(agentId)), 'compaction', agentId)
  } catch (error) {
    debug($, `could not drop reads after a compaction: ${String(error)}`)
  }
}

// SAFETY: as for noteToolRan, no test reaches the catch.
export async function noteSessionEnd($: EngineInterface, state: SessionState, sessionId: string): Promise<void> {
  try {
    await noteDropped($, state, endSession(state), 'clear', undefined, sessionId)
  } catch (error) {
    debug($, `could not drop reads at the end of a session: ${String(error)}`)
  }
}
