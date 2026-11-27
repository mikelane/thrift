import type { EngineInterface } from 'claude-code'

import type { ReadMode } from '../types'
import { debug } from './engine-log'
import { isUnsupportedEngine } from './engine-version'
import type { RecordSetting } from './decision-record'
import { writeRecord } from './record-writer'
import type { SessionState } from './session-state'

export type EngineInfo = RecordSetting

async function readVersion($: EngineInterface) {
  try {
    const { version, base } = await $.session.version()
    return { engineVersion: base ?? version, base }
  } catch (error) {
    debug($, `could not read the engine version: ${String(error)}`)
    return { engineVersion: 'unknown', base: undefined }
  }
}

async function settle($: EngineInterface, setting: ReadMode): Promise<EngineInfo> {
  const { engineVersion, base } = await readVersion($)
  const isUnsupported = isUnsupportedEngine(base)
  const engine: EngineInfo = { engineVersion, setting, effectiveMode: isUnsupported ? 'off' : setting }
  if (isUnsupported) {
    debug($, `engine ${engineVersion} is older than the minimum reread runs on, or is not a release, so it runs as off`)
    await writeRecord($, engine, { decision: 'untested_engine', reason: 'untested_engine', isSubagent: false })
  }
  return engine
}

// The engine is read on first use and kept: no session.start follows a /clear, and the plugin can be started again mid-session.
// A plugin on an engine older than the minimum it was verified on, or on a build that is not a release, runs as off.
export function engineInfo($: EngineInterface, state: SessionState): Promise<EngineInfo> {
  state.engine ??= settle($, state.setting)
  return state.engine
}
