import type { EngineInterface } from 'claude-code'

import type { Trigger } from './decision-record'
import { debug, logFailure } from './engine-log'
import { writeRecord } from './record-writer'
import { claimPending, type SessionState } from './session-state'

async function runCompaction($: EngineInterface, state: SessionState, trigger: Trigger): Promise<void> {
  const sizeBefore = state.contextTokens
  try {
    const compaction = await $.session.compact()
    if (compaction.skip !== undefined) {
      state.backoffFrom = sizeBefore
      await writeRecord($, state, { ...trigger, action: 'none', reason: 'compaction_vetoed' })
    } else {
      await writeRecord($, state, { ...trigger, action: 'compacted' })
      state.backoffFrom = compaction.tokensAfter ?? sizeBefore
      state.contextTokens = compaction.tokensAfter ?? sizeBefore
    }
  } catch (error) {
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
