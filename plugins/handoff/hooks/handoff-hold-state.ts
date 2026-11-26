import type { HandoffHold, HeldPrompt, HeldPromptGroup, SessionState } from './session-state'

export const isGroupOfOrigin = (group: HeldPromptGroup, isUnattended: boolean): boolean => group.isUnattended === isUnattended

// The prompt the handoff carries is the first held prompt, so it is delivered with its own origin's group.
export const beginHandoffHold = (state: SessionState, carried: HeldPrompt | null): void => {
  state.boxLeftover = null
  state.leftoverStrips = 0
  state.handoffHold = {
    phase: 'holding',
    heldPrompts: carried === null ? [] : [carried],
    promptCarriedByHandoff: carried === null ? null : carried.text,
  }
}

// True while this very prompt is still held and not yet taken to deliver or put back: collected before the handoff takes the
// held prompts, or a late arrival in the sending stage before the delivery takes the late arrivals. Once taken, the delivery
// and restore paths deal with what the engine left in the box, and a restore may have put the text back.
export const isAwaitingDelivery = (state: SessionState, prompt: HeldPrompt): boolean => {
  const hold = state.handoffHold
  if (hold.phase === 'holding') return hold.heldPrompts.includes(prompt)
  if (hold.phase === 'sending') return hold.lateArrivals.includes(prompt)
  return false
}

export const isHoldingForHandoff = (state: SessionState): boolean =>
  state.handoffHold.phase === 'holding' || state.handoffHold.phase === 'sending'

// Returns how many prompts are held now, or 0 when no handoff is holding and nothing was added.
export const addHeldPrompt = (state: SessionState, prompt: HeldPrompt): number => {
  const hold = state.handoffHold
  if (hold.phase === 'holding') {
    hold.heldPrompts.push(prompt)
    return hold.heldPrompts.length
  }
  if (hold.phase === 'sending') {
    hold.lateArrivals.push(prompt)
    return hold.lateArrivals.length
  }
  return 0
}

// before_draft puts the prompt ahead of whatever the box holds. after_draft puts it behind, so prompts that reach the box
// one after another keep their order.
export type BoxPlacement = 'before_draft' | 'after_draft'

// A prompt refused while the held ones are being put back comes after them in the box, as a held late arrival does.
export const refusedPromptPlacement = (hold: HandoffHold): BoxPlacement => (hold.phase === 'sending' ? 'after_draft' : 'before_draft')

export const isCarriedByHandoff = (state: SessionState, text: string): boolean =>
  state.handoffHold.phase !== 'idle' && state.handoffHold.promptCarriedByHandoff === text

// Once taken, a prompt that arrives is no longer held, until beginSending holds again: a handoff that goes on to the fresh
// session calls it before any await, and one that failed leaves later prompts to the old session.
export const takeHeldPrompts = (state: SessionState): HeldPrompt[] => {
  const hold = state.handoffHold
  if (hold.phase !== 'holding') return []
  state.handoffHold =
    hold.promptCarriedByHandoff === null
      ? { phase: 'idle' }
      : { phase: 'delivering', promptCarriedByHandoff: hold.promptCarriedByHandoff }
  return hold.heldPrompts
}

// Called at the top of the delivery, with no await since the held prompts were taken, so no prompt slips through unheld
// between the two. Holding stays on until takeLateArrivalsOrEndSending finds nothing left.
export const beginSending = (state: SessionState): void => {
  const hold = state.handoffHold
  state.handoffHold = {
    phase: 'sending',
    promptCarriedByHandoff: hold.phase === 'idle' ? null : hold.promptCarriedByHandoff,
    lateArrivals: [],
  }
}

// Prompts that arrived while sending, oldest first. Finding none ends the sending in the same synchronous run, so a prompt
// cannot land between the empty check and the end of the hold and be left unsent.
export const takeLateArrivalsOrEndSending = (state: SessionState): HeldPrompt[] => {
  const hold = state.handoffHold
  if (hold.phase !== 'sending') return []
  if (hold.lateArrivals.length === 0) {
    state.handoffHold = { phase: 'idle' }
    return []
  }
  return hold.lateArrivals.splice(0)
}

// The carried prompt is no longer a repeat to drop once it has been handed back or sent: a later copy is a new prompt.
export const releaseCarried = (state: SessionState): void => {
  const hold = state.handoffHold
  if (hold.phase === 'delivering') state.handoffHold = { phase: 'idle' }
  if (hold.phase === 'sending') hold.promptCarriedByHandoff = null
}

// The carried prompt travels in the group that shares the handoff's origin.
export const releaseCarriedGroup = (state: SessionState, group: HeldPromptGroup, handoffIsUnattended: boolean): void => {
  if (isGroupOfOrigin(group, handoffIsUnattended)) releaseCarried(state)
}

// Ends both the hold on prompts and the stage, so the session end after this point is no handoff's business.
export const endHandoff = (state: SessionState): void => {
  state.handoffHold = { phase: 'idle' }
  state.handoffStage = 'idle'
  state.isOwnClearQueued = false
  state.hasOwnClearReturned = false
  state.didForeignClearFinishFirst = false
  state.foreignClearsAhead = 0
  state.hasLateTurn = false
}
