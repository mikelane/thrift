import type { EngineInterface, PromptSubmitInput } from 'claude-code'

import { debug, logFailure } from './engine-log'
import { clearBoxCopyWhileHeld, returnToBox } from './prompt-box'
import { carriesExtras, isComposerOrigin, isUnattendedOrigin, planPromptDuringHandoff, senderLabel } from './prompt-plan'
import {
  addHeldPrompt,
  isAwaitingDelivery,
  isCarriedByHandoff,
  isHoldingForHandoff,
  noteBoxLeftover,
  noteLeftoverStrip,
  refusedPromptPlacement,
  typedAfterBoxLeftover,
  type BoxPlacement,
  type HeldPrompt,
  type SessionState,
} from './session-state'

const HELD_FOR_HANDOFF = "A handoff is in progress, so your prompt is held. It is sent when the handoff ends, or, if the handoff fails and a person sent it, put in this terminal's prompt box. If that can't be done, it is kept another way, at worst in the transcript."
const REPEAT_NOT_ADDED = 'The handoff already carries this prompt, so this repeat was not added.'
const REFUSED_DURING_HANDOFF =
  'A handoff is in progress, and a prompt with attachments or context cannot be held. Send it again after the handoff.'
const REFUSED_TOAST = "Not held: a prompt with attachments or context can't wait for a handoff. Send it again after."
const keptRefusedPrompt = (kind: string, text: string): string =>
  `A prompt from ${senderLabel(kind)} had attachments or context, so it could not be held during the handoff and did not run. Its attachments and context were not kept. Its text, to send again after the handoff:\n${text}`

// An attachment or context can't be resent, so the prompt is handed back instead. A person at this terminal gets it in the
// box to send again. For any other sender the box is not where they are, and filling it could displace the draft of the
// person who is: the engine has no channel back to the sender beyond the drop reason, so the text goes in the transcript.
async function handBackRefused($: EngineInterface, e: PromptSubmitInput, placement: BoxPlacement): Promise<void> {
  if (isComposerOrigin(e.origin.kind)) return returnToBox($, e.text, placement)
  $.ui.log(keptRefusedPrompt(e.origin.kind, e.text))
}

// The placement is read now: by the time the clock fires, the delivery may be over.
// SAFETY: during a restore, a refused composer prompt can land in the box after a held composer prompt that arrived later,
// because the hand-back waits for clock.after(0). That takes two composer submits within one engine round trip, which a real
// session cannot produce, so no code guards it.
function refuseDuringHandoff($: EngineInterface, state: SessionState, e: PromptSubmitInput): { drop: string } {
  const placement = refusedPromptPlacement(state.handoffHold)
  debug($, 'refused a prompt with attachments or context during the handoff')
  $.ui.toast(REFUSED_TOAST)
  $.clock.after(0, () => {
    void logFailure($, handBackRefused($, e, placement))
  })
  return { drop: REFUSED_DURING_HANDOFF }
}

function holdForHandoff($: EngineInterface, state: SessionState, e: PromptSubmitInput): { drop: string } {
  const isFromComposer = isComposerOrigin(e.origin.kind)
  // The engine submits the leftover of the last prompt it dropped together with the one typed after it; the person typed only
  // the part after the leftover.
  const typedText = isFromComposer ? typedAfterBoxLeftover(state, e.text) : e.text
  if (typedText !== e.text) noteLeftoverStrip(state)
  const prompt: HeldPrompt = {
    text: typedText,
    isUnattended: isUnattendedOrigin(e.origin.kind),
    origin: e.origin.kind,
    author: 'person',
    ...(typedText === e.text ? {} : { boxText: e.text }),
  }
  const heldCount = addHeldPrompt(state, prompt)
  debug($, `held a prompt for the handoff (${heldCount} held)`)
  // Claude Code leaves a dropped prompt's text in the box, so the next prompt would be typed after it and held as
  // "onetwo". Deferred like the other box work in a hook, because the declarations do not say whether the engine puts the
  // text back after the hook returns. Only while this prompt is still held, whether collected or arrived during the delivery:
  // once the handoff took it, a restore may have put the text back, and the delivery and restore paths deal with what the
  // engine left. The deferred clear can run before the engine has put the text back, so the text is also remembered until a
  // clear finds it, and the next prompt is held without it.
  // SAFETY: a handoff that ends and a second one that starts inside this one tick would let the clear run in the second hold,
  // but only for this same prompt object, which the second hold never holds. No code guards it.
  if (isFromComposer) {
    noteBoxLeftover(state, e.text)
    $.clock.after(0, () => {
      if (isAwaitingDelivery(state, prompt)) void logFailure($, clearBoxCopyWhileHeld($, state, e.text))
    })
  }
  return { drop: HELD_FOR_HANDOFF }
}

export function decideDuringHandoff($: EngineInterface, state: SessionState, e: PromptSubmitInput): { drop: string } | undefined {
  const action = planPromptDuringHandoff({
    isCarried: isCarriedByHandoff(state, e.text),
    isHolding: isHoldingForHandoff(state),
    hasExtras: carriesExtras(e),
  })
  // The handoff already carries this text and sends or restores it itself, so a repeat of it would run twice.
  if (action === 'drop-repeat') {
    debug($, 'dropped a repeat of the prompt the handoff carries')
    return { drop: REPEAT_NOT_ADDED }
  }
  if (action === 'refuse') return refuseDuringHandoff($, state, e)
  if (action === 'hold') return holdForHandoff($, state, e)
  return undefined
}
