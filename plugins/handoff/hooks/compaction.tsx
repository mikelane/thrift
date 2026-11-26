import type { EngineInterface } from 'claude-code'

import type { Trigger } from './decision-record'
import { debug, logFailure } from './engine-log'
import { writeRecord } from './record-writer'
import { claimPending, type SessionState } from './session-state'

const knownFloor = (state: SessionState): number | undefined => (state.floorTokens > 0 ? state.floorTokens : undefined)

async function runCompaction($: EngineInterface, state: SessionState, trigger: Trigger): Promise<void> {
  const sizeBefore = state.contextTokens
  const generation = state.sessionGeneration
  // A /clear that lands while the compaction runs starts a new session. Nothing from this compaction belongs to it, so the
  // checks below come before each write, with no await between a check and the write it guards.
  const isSameSession = (): boolean => state.sessionGeneration === generation
  try {
    const compaction = await $.session.compact()
    if (!isSameSession()) return
    if (compaction.skip !== undefined) {
      state.backoffFrom = sizeBefore
      await writeRecord($, state, { ...trigger, action: 'none', reason: 'compaction_vetoed' })
    } else {
      const floorTokens = knownFloor(state)
      state.backoffFrom = compaction.tokensAfter ?? sizeBefore
      state.contextTokens = compaction.tokensAfter ?? sizeBefore
      state.isAwaitingPostCompactionContext = true
      await writeRecord($, state, { ...trigger, action: 'compacted', floorTokens })
    }
  } catch (error) {
    if (!isSameSession()) return
    state.backoffFrom = sizeBefore
    debug($, `compaction failed: ${String(error)}`)
    await writeRecord($, state, { ...trigger, action: 'none', reason: 'compaction_failed' })
  } finally {
    state.pending = null
  }
}

export function scheduleCompaction($: EngineInterface, state: SessionState, trigger: Trigger): boolean {
  if (!claimPending(state, 'compact')) return false
  $.clock.after(0, () => {
    void logFailure($, runCompaction($, state, trigger))
  })
  return true
}
