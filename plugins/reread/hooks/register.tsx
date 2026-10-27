import type { Register } from 'claude-code'

import { debug } from './engine-log'
import { noteCompaction, noteSessionEnd, noteToolRan } from './invalidation'
import { asReadMode } from './read-mode'
import { readTool } from './read-tool'
import { createState } from './session-state'

export const register: Register = (on, options) => {
  const state = createState(asReadMode(options.readMode))

  // next<string> skips inferring the tool name from every MCP tool in the types file, which made tsc time grow with the connected servers.
  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Read') return readTool($, state, e, { origin: next.origin, run: () => next<string>(e) })
    const ran = await next<string>(e)
    await noteToolRan($, state, e)
    return ran
  }).catch(($, e, next) => {
    debug($, `the tool.call hook failed on ${e.tool} (next called: ${next.called}):${next.error.message ?? next.error.kind}`)
    return next<string>(e)
  })

  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    await noteCompaction($, state, e.agentId, compacted.skip !== undefined)
    return compacted
  }).catch(($, e, next) => {
    debug($, `the session.compact hook failed: ${next.error.message ?? next.error.kind}`)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await noteSessionEnd($, state, e.sessionId)
    return next(e)
  }).catch(($, e, next) => {
    debug($, `the session.end hook failed: ${next.error.message ?? next.error.kind}`)
    return next(e)
  })
}
