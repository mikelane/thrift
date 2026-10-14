import type { ForkReason } from './fork-outcome'
import { isComposerOrigin } from './prompt-plan'
import { isGroupOfOrigin, type HeldPrompt, type HeldPromptGroup } from './session-state'

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
// the box is where the person at this terminal reviews what they typed.
const groupOrigin = (groupSoFar: HeldPrompt['origin'], joining: HeldPrompt['origin']): HeldPrompt['origin'] => (isComposerOrigin(groupSoFar) ? joining : groupSoFar)

// Prompts that follow the same origin are sent together, in arrival order; groups go in order of their first prompt.
export const groupHeldPrompts = (prompts: readonly HeldPrompt[]): HeldPromptGroup[] => {
  const groups: HeldPromptGroup[] = []
  for (const { text, isUnattended, origin } of prompts) {
    const index = groups.findIndex(group => isGroupOfOrigin(group, isUnattended))
    const group = groups[index]
    if (group === undefined) groups.push({ text, isUnattended, origin })
    else {
      const boxCopy = isComposerOrigin(origin) ? text : boxCopyOf(group)
      groups[index] = {
        text: `${group.text}${PROMPT_SEPARATOR}${text}`,
        isUnattended,
        origin: groupOrigin(group.origin, origin),
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
