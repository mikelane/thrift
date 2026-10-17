import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderInput } from 'claude-code'

import type { BandState, Offer, Writing } from '../types'
import {
  BUTTON_LABELS,
  bandControls,
  bandHint,
  bandMessage,
  clearsSession,
  isSameOffer,
  isWriting,
  offerWithBusyState,
  statusText,
} from './band-text'
import { isBackgroundBusy } from './background-busy'
import { snapshotTrigger, type HandoffRequest, type Trigger } from './decision-record'
import { debug, logFailure } from './engine-log'
import { sendOrKeepInBox } from './handoff-delivery'
import { ALREADY_PENDING, busyRefusalMessage } from './handoff-note'
import { composerPrompt, emptyBoxIfHolding } from './prompt-box'
import { writeRecord } from './record-writer'
import type { ButtonPress, SessionState } from './session-state'
import { bandButtons, busyRefusalTrigger, type Button } from './signals'

const PRESS_WAITS_FOR_TURN = 'This turn is still running, so your choice will run when it ends.'
const PROMPT_NOT_HELD = 'That prompt is no longer held, so there is nothing to send.'

// What a press can start, with $ already bound: the engine follows $ past an import only into a function declaration,
// so register.tsx binds it. Both stay there, where the handoff and the compaction they schedule are run.
export type PressActions = {
  scheduleHandoff: (state: SessionState, request: HandoffRequest) => boolean
  scheduleCompaction: (state: SessionState, trigger: Trigger) => boolean
}

// The shape names the Offer fields, so a reload finds an offer an older version wrote (heldPrompt, not hasHeldPrompt) absent.
const offerAtom = atom({ plugin: 'handoff', key: 'offer' } as const, null, { shape: 'offer-has-held-prompt' })

export function readBand($: EngineInterface): Promise<BandState | null> {
  return read($, offerAtom)
}

export async function takeDownBand($: EngineInterface, state: SessionState): Promise<void> {
  if (!state.hasBand) return
  try {
    await update($, offerAtom, () => null)
    state.hasBand = false
  } catch (error) {
    debug($, `could not take down the band: ${String(error)}`)
  }
}

// The offer atom outlives a reload but `state.hasBand` does not, so a band left up would stick.
export async function takeDownBandFromBeforeReload($: EngineInterface, state: SessionState): Promise<void> {
  try {
    if ((await read($, offerAtom)) !== null) state.hasBand = true
  } catch (error) {
    debug($, `could not read the band: ${String(error)}`)
  }
  await takeDownBand($, state)
}

export async function offerBand($: EngineInterface, state: SessionState, trigger: Trigger, hasHeldPrompt: boolean): Promise<void> {
  const offer: Offer = {
    signal: trigger.signal === 'strong' ? 'strong' : 'weak',
    contextTokens: trigger.contextTokens,
    hasHeldPrompt,
    isBusy: trigger.isBusy,
  }
  try {
    await update($, offerAtom, () => offer)
    state.hasBand = true
    await writeRecord($, state, { ...trigger, action: 'advised' })
  } catch (error) {
    debug($, `could not show the band: ${String(error)}`)
    await writeRecord($, state, { ...trigger, action: 'none', reason: 'band_failed' })
  }
}

export async function redrawBand($: EngineInterface, state: SessionState, band: BandState): Promise<void> {
  try {
    await update($, offerAtom, () => band)
    state.hasBand = true
  } catch (error) {
    debug($, `could not redraw the band: ${String(error)}`)
  }
}

// Only the band the press was made on may be redrawn: one taken down or replaced since stays as it is.
async function redrawIfStillShown($: EngineInterface, state: SessionState, shown: Offer, redrawn: Offer): Promise<void> {
  try {
    const current = await read($, offerAtom)
    if (current !== null && isSameOffer(current, shown)) await redrawBand($, state, redrawn)
  } catch (error) {
    debug($, `could not read the band: ${String(error)}`)
  }
}

// A turn that ends without an answer gets no evaluation, so a band left up could still offer a handoff over work
// that started during it.
export async function refreshBandBusyState($: EngineInterface, state: SessionState): Promise<void> {
  try {
    const offer = await read($, offerAtom)
    if (offer === null || isWriting(offer)) return
    const isBusy = await isBackgroundBusy($, state)
    if (offer.isBusy !== isBusy) await redrawBand($, state, offerWithBusyState(offer, state.contextTokens, isBusy))
  } catch (error) {
    debug($, `could not read the band: ${String(error)}`)
  }
}

async function refuseToClear($: EngineInterface, state: SessionState, offer: Offer, trigger: Trigger): Promise<void> {
  $.ui.toast(busyRefusalMessage(false))
  await redrawIfStillShown($, state, offer, offerWithBusyState(offer, state.contextTokens, true))
  await writeRecord($, state, { ...busyRefusalTrigger(trigger), action: 'none', reason: 'background_busy' })
}

async function pressHeldPromptButton(
  $: EngineInterface,
  state: SessionState,
  actions: PressActions,
  trigger: Trigger,
  button: Button,
): Promise<void> {
  const heldPrompt = state.heldPrompt
  if (heldPrompt === null) {
    debug($, `dropped a ${button} press: no prompt is held`)
    $.ui.toast(PROMPT_NOT_HELD)
    return takeDownBand($, state)
  }
  state.heldPrompt = null
  await takeDownBand($, state)
  await emptyBoxIfHolding($, heldPrompt)
  if (button === 'handoff-send' && actions.scheduleHandoff(state, { trigger, heldPrompt, isUnattended: false })) return
  await writeRecord($, state, { ...trigger, action: 'none', reason: 'send_here' })
  $.clock.after(0, () => {
    void logFailure($, sendOrKeepInBox($, state, composerPrompt(heldPrompt)))
  })
}

// Busyness is read when the press runs, not taken from the offer: a shell may have started since the band was drawn.
async function runPress($: EngineInterface, state: SessionState, actions: PressActions, { offer, button }: ButtonPress): Promise<void> {
  const isBusy = await isBackgroundBusy($, state)
  if (state.pending !== null) {
    debug($, `dropped a ${button} press: a ${state.pending} is already pending`)
    return $.ui.toast(ALREADY_PENDING)
  }
  const trigger = snapshotTrigger(state, 'button', offer.signal, isBusy)
  if (isBusy && clearsSession(button)) return refuseToClear($, state, offer, trigger)
  if (button === 'handoff-send' || button === 'send-here') return pressHeldPromptButton($, state, actions, trigger, button)
  if (button === 'not-now') state.backoffFrom = state.contextTokens
  else if (button === 'compact') actions.scheduleCompaction(state, trigger)
  else return void actions.scheduleHandoff(state, { trigger, isUnattended: false })
  await takeDownBand($, state)
  if (button === 'not-now') await writeRecord($, state, { ...trigger, action: 'none', reason: 'not_now' })
}

// runPress awaits the busy check before it claims anything, so the press is marked in flight in the same tick:
// a second press, Not now included, is dropped until this one settles.
export async function claimAndRunPress(
  $: EngineInterface,
  state: SessionState,
  actions: PressActions,
  press: ButtonPress,
): Promise<void> {
  state.isPressRunning = true
  try {
    await runPress($, state, actions, press)
  } finally {
    state.isPressRunning = false
  }
}

// A press that clears or compacts made mid-turn waits, so /clear and compaction never land inside a turn. The first
// press wins; the band stays up until it runs, and it runs at the end of that turn in place of a fresh evaluation.
// Not now has no such hazard, so it runs at once.
async function pressButton($: EngineInterface, state: SessionState, actions: PressActions, offer: Offer, button: Button): Promise<void> {
  if (state.pending !== null || state.deferredPress !== null || state.isPressRunning) {
    return debug($, `dropped a ${button} press: another press or a handoff or compaction comes first`)
  }
  if (!state.isTurnRunning || button === 'not-now') return claimAndRunPress($, state, actions, { offer, button })
  state.deferredPress = { offer, button }
  $.ui.toast(PRESS_WAITS_FOR_TURN)
}

function drawWritingStatus($: EngineInterface, e: RenderInput<'AbovePrompt'>, band: Writing) {
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="column" backgroundColor="subtle">
      <Text>{statusText(band)}</Text>
    </Box>
  )
}

function drawOffer($: EngineInterface, state: SessionState, actions: PressActions, e: RenderInput<'AbovePrompt'>, offer: Offer) {
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box flexDirection="column" backgroundColor="subtle">
      <Text>{bandMessage(offer)}</Text>
      <Box flexWrap="wrap" columnGap={2}>
        {bandControls(bandButtons(offer)).map(({ button, hotkey, isPrimary, isDismiss }) => (
          <Button
            key={button}
            label={BUTTON_LABELS[button]}
            hotkey={hotkey}
            plain
            {...(isPrimary ? { variant: 'primary' as const, autoFocus: true as const } : {})}
            {...(isDismiss ? { role: 'dismiss' as const } : {})}
            onPress={() => logFailure($, pressButton($, state, actions, offer, button))}
          />
        ))}
      </Box>
      <Text dimColor>{bandHint(offer)}</Text>
    </Box>
  )
}

export function drawBand(
  $: EngineInterface,
  state: SessionState,
  actions: PressActions,
  e: RenderInput<'AbovePrompt'>,
  band: BandState,
) {
  return isWriting(band) ? drawWritingStatus($, e, band) : drawOffer($, state, actions, e, band)
}
