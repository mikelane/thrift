import type { EngineInterface } from 'claude-code'

import { debug } from './engine-log'

// `contextPhrase` is the call site's phrase after "the session id", such as " for the move check", or '' when there is none.
export async function tryReadSessionId($: EngineInterface, contextPhrase = ''): Promise<string | undefined> {
  try {
    return await $.session.id()
  } catch (error) {
    debug($, `could not read the session id${contextPhrase}: ${String(error)}`)
    return undefined
  }
}
