import type { EngineInterface } from 'claude-code'

import { isBackgroundBusy } from './background-busy'
import { snapshotTrigger } from './decision-record'
import { scheduleHandoff } from './handoff-run'
import { ALREADY_PENDING } from './handoff-note'
import { emptyBoxIfHolding } from './prompt-box'
import type { SessionState } from './session-state'

const WRITING_COMMAND_REPLY = 'Writing a handoff for a fresh session...'

export async function startHandoffCommand($: EngineInterface, state: SessionState): Promise<{ text: string }> {
  const trigger = snapshotTrigger(state, 'command', 'none', await isBackgroundBusy($, state))
  const heldPrompt = state.heldPrompt
  const emptyBox = heldPrompt === null ? undefined : () => emptyBoxIfHolding($, heldPrompt)
  const isClaimed = scheduleHandoff(
    $,
    state,
    { trigger, ...(heldPrompt === null ? {} : { heldPrompt }), isUnattended: false },
    emptyBox,
  )
  return { text: isClaimed ? WRITING_COMMAND_REPLY : ALREADY_PENDING }
}
