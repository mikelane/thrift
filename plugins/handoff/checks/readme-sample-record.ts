// Limit: the README line supplies its own field set and values, which are carried through rather than compared. This
// catches a key placed, named or typed differently from what recordFromEvaluation writes, but not an optional key
// dropped from the sample or a value the code would never write.
import { readFileSync } from 'node:fs'

import { recordFromEvaluation } from '../hooks/decision-record.ts'
import { findSampleDrift } from '../hooks/readme-sample-record.ts'

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
const messages = findSampleDrift(readme, recordFromEvaluation)

for (const message of messages) {
  console.error(message)
}
process.exit(messages.length === 0 ? 0 : 1)
