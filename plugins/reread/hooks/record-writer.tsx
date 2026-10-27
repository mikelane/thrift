import type { EngineInterface } from 'claude-code'

import { decisionRecord, isUsableThriftHome, LOG_WRITER, logLocation, type Evaluation, type RecordSetting } from './decision-record'
import { debug } from './engine-log'

// Never throws: a log that cannot be written goes to the debug log and the turn goes on.
export async function writeRecord($: EngineInterface, setting: RecordSetting, evaluation: Evaluation, sessionId?: string): Promise<void> {
  try {
    const [now, id, thriftHome, home] = await Promise.all([
      $.clock.now(),
      sessionId ?? $.session.id(),
      $.env.get('THRIFT_HOME'),
      $.env.get('HOME'),
    ])
    const location = logLocation(thriftHome, home)
    const isThriftHomeIgnored = Boolean(thriftHome) && !isUsableThriftHome(thriftHome)
    if (isThriftHomeIgnored) {
      debug($, `THRIFT_HOME is not an absolute path, so ${location === null ? 'HOME is needed for a log location, and it is not set' : 'the default log location is used'}`)
    }
    if (location === null) return isThriftHomeIgnored ? undefined : debug($, 'no log location: neither THRIFT_HOME nor HOME is set')
    const record = decisionRecord({ ...setting, now, sessionId: id }, evaluation)
    const ran = await $.process.run([...LOG_WRITER, location.dir, location.file], { stdin: `${JSON.stringify(record)}\n` })
    if (ran.exitCode !== 0) debug($, `log write to ${location.file} failed (exit ${ran.exitCode}): ${ran.stderr.trim()}`)
  } catch (error) {
    debug($, `could not write a decision record: ${String(error)}`)
  }
}
