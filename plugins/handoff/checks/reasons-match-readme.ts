import { readFileSync } from 'node:fs'

import { DECISION_REASONS } from '../hooks/decision-reasons.ts'
import { readmeReasons } from '../hooks/readme-reasons.ts'

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
const documented = new Set(readmeReasons(readme))
const declared = new Set<string>(DECISION_REASONS)

const missingFromReadme = [...declared].filter(reason => !documented.has(reason))
const missingFromUnion = [...documented].filter(reason => !declared.has(reason))

for (const reason of missingFromReadme) {
  console.error(`DecisionReason has "${reason}", but the README trigger_values.reason row does not list it.`)
}
for (const reason of missingFromUnion) {
  console.error(`The README trigger_values.reason row lists "${reason}", but DecisionReason does not have it.`)
}
process.exit(missingFromReadme.length + missingFromUnion.length === 0 ? 0 : 1)
