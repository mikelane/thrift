import type { HeldPrompt } from './session-state'

const SCHEDULED_PREFACE = "A scheduled task fired while the handoff was under way, so the handoff carried its prompt here. The task's prompt:"

const PREFACE_SEPARATOR = '\n\n'

// The engine frames a plugin's submission as the plugin's own message, so a prompt the person did not type needs its origin
// said in the text, or the model reads it as the plugin's instruction with no provenance.
// SAFETY: only a scheduled prompt is ever carried this way. Held prompts are authored by the person, and speaksForPerson sends
// every one but the unattended (scheduled) ones asUser, so a submission without asUser that carries a person's prompt is a
// scheduled task's. A peer's message is never held (see the SAFETY note on groupOrigin in handoff-note.ts), so no peer,
// task-notification or other origin needs a line.
export const withPreface = (text: string): string => `${SCHEDULED_PREFACE}${PREFACE_SEPARATOR}${text}`

// The one condition for the line, shared by every path that submits a held prompt, so they cannot drift apart: a person's
// prompt that is submitted without asUser, which today means an unattended one. The plugin's own prompts are not carried.
export const carriedText = (prompt: Pick<HeldPrompt, 'text' | 'author'>, asUser: boolean): string =>
  !asUser && prompt.author === 'person' ? withPreface(prompt.text) : prompt.text
