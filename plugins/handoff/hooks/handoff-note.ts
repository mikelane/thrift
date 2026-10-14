import type { ForkReason } from './fork-outcome'
import { isComposerOrigin, isPersonOrigin } from './prompt-plan'
import { isGroupOfOrigin, type BoxPlacement, type HeldPrompt, type HeldPromptGroup } from './session-state'

export const HANDOFF_PROMPT = `Write a handoff for the next session, which will start fresh with only this note.
Cover, under short headings:
- The task and its goal.
- What is done: commits, branches, PRs, and files, with paths.
- Decisions made, and why.
- Open threads.
- The next concrete step.
- Facts the next session would otherwise rediscover.
Use plain Markdown, at most 400 words, and no preamble.`

export type NoteDelivery = 'appended' | 'submitted' | 'in_box' | 'not_carried'

export type Carried = Exclude<NoteDelivery, 'appended'>

export const turnAfterNoteLine = (oldSessionId: string): string =>
  `A turn ran in the previous session while or after this note was written, so the note may not cover it. To see that turn: ${resumeCommand(oldSessionId)}`

export const handoffMessage = (oldSessionId: string, note: string, hasTurnAfterNote: boolean): string => {
  const message = `Handoff from the previous session (${oldSessionId}), written by Claude just before a /clear:\n\n${note}`
  return hasTurnAfterNote ? `${message}\n\n${turnAfterNoteLine(oldSessionId)}` : message
}

// One wording for the session's state in every message that stops a handoff, so each outcome reads the same.
const COMPACTED_NOT_CLEARED = 'This session was compacted, not cleared.'

const sessionLeftLine = (hasCompacted: boolean): string => (hasCompacted ? COMPACTED_NOT_CLEARED : 'This session is unchanged.')

// The session that ended is the one that was compacted; the session the person sees now never was.
export const sessionEndedMessage = (hasCompacted: boolean, oldSessionId: string): string => {
  const message = 'The session ended before the handoff could clear, so it stopped. No note was carried over.'
  return hasCompacted ? `${message} The previous session was compacted. To reopen it: ${resumeCommand(oldSessionId)}` : message
}

export const NO_HANDOFF_MESSAGE = 'No handoff was written. This session is unchanged.'

export const NO_REPLY_MESSAGE = "Nothing to hand off yet: Claude hasn't finished a reply in this session. Type /handoff again once it has."

export const noHandoffMessage = (forkReason: ForkReason | undefined): string => (forkReason === 'nothing-to-fork' ? NO_REPLY_MESSAGE : NO_HANDOFF_MESSAGE)

export const clearFailedMessage = (hasCompacted: boolean): string =>
  `The handoff was written but /clear failed. ${sessionLeftLine(hasCompacted)} Type /handoff to try again.`

export const busyRefusalMessage = (hasCompacted: boolean): string =>
  `Background work is running, and a handoff would cut it off. ${sessionLeftLine(hasCompacted)} Type /handoff to hand off anyway.`

export const resumeCommand = (sessionId: string): string => `claude --resume ${sessionId}`

export const handedOffMessage = (oldSessionId: string): string =>
  `Handed off. This session starts from a note summarizing the previous one. To reopen the full previous conversation: ${resumeCommand(oldSessionId)}`

export const noteInBoxMessage = (oldSessionId: string): string =>
  `Handed off. The note summarizing the previous session is in your prompt box. Press Enter to send it. To reopen the full previous conversation: ${resumeCommand(oldSessionId)}`

export const noteNotCarriedMessage = (oldSessionId: string): string =>
  `The handoff note could not be added to this session. To reopen the full previous conversation: ${resumeCommand(oldSessionId)}`

export const FINAL_MESSAGES: Record<NoteDelivery, (oldSessionId: string) => string> = {
  appended: handedOffMessage,
  submitted: handedOffMessage,
  in_box: noteInBoxMessage,
  not_carried: noteNotCarriedMessage,
}

const PROMPT_SEPARATOR = '\n\n'

export const joinPrompts = (handoff: string, heldPrompts: string | undefined): string =>
  heldPrompts ? `${handoff}${PROMPT_SEPARATOR}${heldPrompts}` : handoff

// A group is the composer's only while every prompt in it is; one remote prompt keeps the whole group out of the box, because
// the box is where the person at this terminal reviews what they typed. A group is a person's only while every prompt in it
// comes from a person: one prompt from another sender (a finished task) takes the group's origin, whatever order they arrived in.
const groupOrigin = (groupSoFar: HeldPrompt['origin'], joining: HeldPrompt['origin']): HeldPrompt['origin'] =>
  isComposerOrigin(groupSoFar) || (isPersonOrigin(groupSoFar) && !isPersonOrigin(joining)) ? joining : groupSoFar

// Prompts that follow the same origin are sent together, in arrival order; groups go in order of their first prompt.
export const groupHeldPrompts = (prompts: readonly HeldPrompt[]): HeldPromptGroup[] => {
  const groups: HeldPromptGroup[] = []
  for (const { text, isUnattended, origin, author } of prompts) {
    const index = groups.findIndex(group => isGroupOfOrigin(group, isUnattended))
    const group = groups[index]
    if (group === undefined) groups.push({ text, isUnattended, origin, author })
    else {
      const boxCopy = isComposerOrigin(origin) ? text : boxCopyOf(group)
      groups[index] = {
        text: `${group.text}${PROMPT_SEPARATOR}${text}`,
        isUnattended,
        origin: groupOrigin(group.origin, origin),
        author: group.author === 'plugin' || author === 'plugin' ? 'plugin' : 'person',
        ...(boxCopy === undefined ? {} : { boxText: boxCopy }),
      }
    }
  }
  return groups
}

// Only a scheduled handoff's note rides with the scheduled group, and both go under the plugin's frame. The attended group is
// the person's own words and is sent apart from the note, so the model reads it bare.
export const groupJoiningNote = (groups: readonly HeldPromptGroup[], handoffIsUnattended: boolean): HeldPromptGroup | undefined =>
  handoffIsUnattended ? groups.find(group => isGroupOfOrigin(group, true)) : undefined

// A note that was appended to the session leaves every group to send; a note that was sent as a prompt already carried the group
// that joined it, and only that one.
export const groupsLeftToSend = (
  groups: readonly HeldPromptGroup[],
  handoffIsUnattended: boolean,
  noteDelivery: NoteDelivery,
): HeldPromptGroup[] =>
  noteDelivery === 'appended' ? [...groups] : groups.filter(group => group !== groupJoiningNote(groups, handoffIsUnattended))

// A note sent as a prompt may have taken the scheduled group along; the carried prompt is released with that group, as with any other.
export const noteTookGroupAlong = (
  groups: readonly HeldPromptGroup[],
  handoffIsUnattended: boolean,
  noteDelivery: NoteDelivery,
): boolean => noteDelivery !== 'appended' && groupJoiningNote(groups, handoffIsUnattended) !== undefined

// A person's prompt follows the note. If the note never entered the fresh session, it is held back instead: in the box or the
// transcript, after the note, rather than running in a session that knows nothing of the work. A note left in the box is read
// first, so a prompt that also lands there goes after it.
export const deliveryAfterNote = (noteDelivery: NoteDelivery): { holdBackPerson: boolean; placement: BoxPlacement } => ({
  holdBackPerson: noteDelivery === 'in_box' || noteDelivery === 'not_carried',
  placement: noteDelivery === 'in_box' ? 'after_draft' : 'before_draft',
})

// The text the engine left in the box for a group: the last prompt typed at the composer, which a remote prompt joined
// after it does not replace. A group with no composer prompt left nothing there.
export const boxCopyOf = (group: Pick<HeldPrompt, 'text' | 'origin' | 'boxText'>): string | undefined =>
  group.boxText ?? (isComposerOrigin(group.origin) ? group.text : undefined)

// What the prompt box can still hold of a prompt that was dropped and then sent on: the engine leaves the dropped text in it,
// which for a group is its last composer prompt. The joined text is a copy only for a prompt sent from the composer.
export const boxCopiesOf = (prompt: Pick<HeldPrompt, 'text' | 'origin' | 'boxText'>): string[] => [
  ...(isComposerOrigin(prompt.origin) ? [prompt.text] : []),
  ...(prompt.boxText === undefined ? [] : [prompt.boxText]),
]

// A person's prompt is read by the model as the person's own words, not as a message from this plugin. A scheduled prompt and
// the plugin's own note keep the plugin's frame: nobody typed them.
export const speaksForPerson = (prompt: Pick<HeldPrompt, 'isUnattended' | 'origin' | 'author'>): boolean =>
  prompt.author === 'person' && !prompt.isUnattended && isPersonOrigin(prompt.origin)

export const holdsPrompt = (draft: string, prompt: string): boolean => `\n${draft}\n`.includes(`\n${prompt}\n`)

export const withoutPrompt = (draft: string, prompt: string): string | null => {
  const padded = `\n${draft}\n`
  const promptStart = padded.indexOf(`\n${prompt}\n`)
  if (promptStart === -1) return null
  return `${padded.slice(0, promptStart)}${padded.slice(promptStart + prompt.length + 1)}`.slice(1, -1)
}

// The draft without the copy of a group's last prompt the engine kept in the box. A draft that no longer holds it is left as is.
export const withoutBoxCopy = (draft: string, { boxText }: Pick<HeldPrompt, 'boxText'>): string =>
  boxText === undefined ? draft : (withoutPrompt(draft, boxText) ?? draft)
