import type { HeldPrompt } from './session-state'

const SCHEDULED_PREFACE = "A scheduled task fired while the handoff was under way, so the handoff carried its prompt here. The task's prompt:"
const PEER_PREFACE = 'A message from another Claude session arrived while the handoff was under way, so the handoff carried it here:'
const TASK_NOTIFICATION_PREFACE = 'A background task notification arrived while the handoff was under way, so the handoff carried it here:'

const PREFACES = new Map([
  ['scheduled-trigger', SCHEDULED_PREFACE],
  ['peer', PEER_PREFACE],
  ['peer-send-message', PEER_PREFACE],
  ['task-notification', TASK_NOTIFICATION_PREFACE],
])

const PREFACE_SEPARATOR = '\n\n'

const genericPreface = (originKind: string): string =>
  `A prompt (${originKind}) arrived while the handoff was under way, so the handoff carried it here:`

// A prompt marked unattended came from a scheduler whatever origin it borrowed.
export const prefaceFor = ({ origin, isUnattended }: Pick<HeldPrompt, 'origin' | 'isUnattended'>): string => {
  const kind = isUnattended ? 'scheduled-trigger' : origin
  return PREFACES.get(kind) ?? genericPreface(kind)
}

// The engine frames a plugin's submission as the plugin's own message, so a prompt the person did not type needs its origin
// said in the text, or the model reads it as the plugin's instruction with no provenance.
export const withPreface = (prompt: Pick<HeldPrompt, 'text' | 'origin' | 'isUnattended'>): string =>
  `${prefaceFor(prompt)}${PREFACE_SEPARATOR}${prompt.text}`
