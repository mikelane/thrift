import { readFileSync } from 'node:fs'

import { DECISION_REASONS } from '../hooks/decision-reasons.ts'
import { driftExitCode, findReasonDrift, formatDriftMessages, parseReadmeReasons } from '../hooks/readme-reasons.ts'

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
const messages = formatDriftMessages(findReasonDrift(DECISION_REASONS, parseReadmeReasons(readme)))

for (const message of messages) {
  console.error(message)
}
process.exit(driftExitCode(messages))
