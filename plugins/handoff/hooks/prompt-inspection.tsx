import type { EngineInterface } from 'claude-code'

import { debug } from './engine-log'
import type { SessionState } from './session-state'
import { branchTicketPrefixes, hasTicketShapedToken, namesNewWork, ticketUrlPrefixes, workRefs } from './work-refs'

const BRANCH_READ_TIMEOUT_MS = 5000

async function readBranch($: EngineInterface): Promise<string> {
  try {
    const ran = await $.process.run(['git', 'branch', '--show-current'], { timeoutMs: BRANCH_READ_TIMEOUT_MS })
    return ran.exitCode === 0 ? ran.stdout.trim() : ''
  } catch (error) {
    debug($, `could not read the git branch: ${String(error)}`)
    return ''
  }
}

export async function inspectPrompt($: EngineInterface, state: SessionState, text: string): Promise<boolean> {
  for (const prefix of ticketUrlPrefixes(text)) state.urlPrefixes.add(prefix)
  const branchPrefixes = hasTicketShapedToken(text) ? branchTicketPrefixes(await readBranch($)) : []
  const prefixes = [...state.urlPrefixes, ...branchPrefixes]
  const isNewWork = namesNewWork(text, state.seenRefs, prefixes)
  for (const ref of workRefs(text, prefixes)) state.seenRefs.add(ref)
  return isNewWork
}
