import type { EngineInterface } from 'claude-code'

import { debug } from './engine-log'
import { boxCopiesOf, holdsPrompt, withoutBoxCopy, withoutPrompt, type Carried } from './handoff-note'
import { isComposerOrigin } from './prompt-plan'
import { forgetBoxLeftover, noteBoxCleared, type BoxPlacement, type HeldPrompt, type SessionState } from './session-state'

export const UNSENT_PROMPT = 'Your prompt could not be sent or put in the prompt box. Here it is:'
export const UNSENT_OTHER_PROMPT = 'A prompt could not be sent, so here it is:'

type BoxPrompt = Pick<HeldPrompt, 'text' | 'boxText'>

// A prompt the box already holds as whole lines is not added again, so an identical prompt sent twice shows once; the box
// is for the person to review and send, and a second copy of a line they can see would only be noise to delete.
// The engine keeps a dropped prompt's text in the box, which for a group is its last prompt: that copy is replaced by the
// group's text, not left beside it.
export async function refillBox($: EngineInterface, prompt: BoxPrompt, placement: BoxPlacement = 'before_draft'): Promise<boolean> {
  try {
    const draft = (await $.prompt.read()).text
    if (holdsPrompt(draft, prompt.text)) return true
    const otherDraft = withoutBoxCopy(draft, prompt)
    const withDraft = placement === 'before_draft' ? `${prompt.text}\n${otherDraft}` : `${otherDraft}\n${prompt.text}`
    const filled = await $.prompt.fill({ text: otherDraft === '' ? prompt.text : withDraft, mode: 'replace' })
    if (!filled.isFilled) debug($, `the prompt box refused the prompt: ${filled.refusal ?? 'refused by a hook'}`)
    return filled.isFilled
  } catch (error) {
    debug($, `could not refill the prompt box: ${String(error)}`)
    return false
  }
}

// Once a person's prompt went into the fresh session, the text the engine kept in the box would send it a second time. Only
// that copy is taken out, as whole lines: anything else in the box is a draft the person typed since, and stays. A copy taken
// out is no longer a leftover the next prompt can be joined to.
export async function emptySentPromptFromBox($: EngineInterface, state: SessionState, prompt: HeldPrompt): Promise<void> {
  const copies = boxCopiesOf(prompt)
  if (copies.length === 0) return
  try {
    const draft = (await $.prompt.read()).text
    const removal = copies
      .map(copy => ({ copy, remainingDraft: withoutPrompt(draft, copy) }))
      .find((candidate): candidate is { copy: string; remainingDraft: string } => candidate.remainingDraft !== null)
    if (removal === undefined) return
    const emptied = await $.prompt.fill({ text: removal.remainingDraft, mode: 'replace' })
    if (emptied.isFilled) noteBoxCleared(state, removal.copy)
    else debug($, `the prompt box refused to be emptied: ${emptied.refusal ?? 'refused by a hook'}`)
  } catch (error) {
    debug($, `could not empty the prompt box: ${String(error)}`)
  }
}

// A held prompt kept in the box for the person to send: text typed after it is sent with it on purpose.
export function markKeptInBox(state: SessionState): Carried {
  forgetBoxLeftover(state)
  return 'in_box'
}

export function composerPrompt(text: string): HeldPrompt {
  return { text, isUnattended: false, origin: 'composer', author: 'person' }
}

// Only a prompt typed at this terminal is offered to the box. The sender of any other prompt is somewhere else, and filling
// the box could displace the draft of the person who is here.
export function canUseBox(prompt: HeldPrompt): boolean {
  return isComposerOrigin(prompt.origin)
}

// A prompt that is never offered to the box is not the person's own, so it gets a notice that claims neither.
export function keepInTranscript($: EngineInterface, prompt: HeldPrompt, notice?: string) {
  return $.ui.log(`${notice ?? (canUseBox(prompt) ? UNSENT_PROMPT : UNSENT_OTHER_PROMPT)}\n${prompt.text}`)
}

export async function returnToBox($: EngineInterface, text: string, placement: BoxPlacement): Promise<void> {
  if (!(await refillBox($, { text }, placement))) keepInTranscript($, composerPrompt(text))
}

// True when the prompt's text was found in the box and taken out.
export async function emptyBoxIfHolding($: EngineInterface, text: string): Promise<boolean> {
  try {
    const remainingDraft = withoutPrompt((await $.prompt.read()).text, text)
    if (remainingDraft === null) return false
    const emptied = await $.prompt.fill({ text: remainingDraft, mode: 'replace' })
    if (!emptied.isFilled) debug($, `the prompt box refused to be emptied: ${emptied.refusal ?? 'refused by a hook'}`)
    return emptied.isFilled
  } catch (error) {
    debug($, `could not empty the prompt box: ${String(error)}`)
    return false
  }
}

export async function clearBoxCopyWhileHeld($: EngineInterface, state: SessionState, boxText: string) {
  if (await emptyBoxIfHolding($, boxText)) noteBoxCleared(state, boxText)
}
