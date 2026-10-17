import type { EngineInterface } from 'claude-code'

import { isUsableThriftHome, LOG_WRITER, logLocation, recordFromEvaluation, type Evaluation } from './decision-record'
import { debug } from './engine-log'
import type { SessionState } from './session-state'

export async function writeRecord($: EngineInterface, state: SessionState, evaluation: Evaluation): Promise<void> {
  try {
    const [now, id, thriftHome, home] = await Promise.all([
      $.clock.now(),
      evaluation.sessionId ?? $.session.id(),
      $.env.get('THRIFT_HOME'),
      $.env.get('HOME'),
    ])
    const location = logLocation(thriftHome, home)
    const isThriftHomeIgnored = Boolean(thriftHome) && !isUsableThriftHome(thriftHome)
    if (isThriftHomeIgnored) {
      debug($, `THRIFT_HOME is not an absolute path, so ${location === null ? 'HOME is needed for a log location, and it is not set' : 'the default log location is used'}`)
    }
    if (location === null) return isThriftHomeIgnored ? undefined : debug($, 'no log location: neither THRIFT_HOME nor HOME is set')
    const record = recordFromEvaluation(state, evaluation, now, id)
    const ran = await $.process.run([...LOG_WRITER, location.dir, location.file], {
      stdin: `${JSON.stringify(record)}\n`,
    })
    if (ran.exitCode !== 0) debug($, `log write failed: ${ran.stderr.trim()}`)
  } catch (error) {
    debug($, `log write failed: ${String(error)}`)
  }
}
