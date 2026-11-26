import type { HeldPrompt } from './session-state'

const SCHEDULED_PREFACE = "A scheduled task the person set up fired while the handoff was under way. The handoff plugin is passing its prompt on. The prompt:"

const PREFACE_SEPARATOR = '\n\n'

// The engine presents a plugin's submission as the plugin's own message. A prompt the person did not type must say where it
// came from in its text, or the model takes it for the plugin's own instruction.
// SAFETY: only a scheduled prompt is ever carried this way. Held prompts are authored by the person, and speaksForPerson sends
// every one but the unattended (scheduled) ones asUser, so a submission without asUser that carries a person's prompt is a
// scheduled task's. A peer's message is never held (see the SAFETY note on groupOrigin in handoff-note.ts), so no peer,
// task-notification or other origin needs a line.
export const withPreface = (text: string): string => `${SCHEDULED_PREFACE}${PREFACE_SEPARATOR}${text}`

// The one condition for the line, shared by every path that submits a held prompt, so they cannot drift apart: a person's
// prompt that is submitted without asUser, which today means an unattended one. The plugin's own prompts are not carried.
export const carriedText = (prompt: Pick<HeldPrompt, 'text' | 'author'>, asUser: boolean): string =>
  !asUser && prompt.author === 'person' ? withPreface(prompt.text) : prompt.text
