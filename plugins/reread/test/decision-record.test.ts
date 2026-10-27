import { describe, expect, test } from 'claude-code/testing'

import {
  decisionRecord,
  isUsableThriftHome,
  LOG_WRITER,
  logLocation,
  type Evaluation,
  type RecordContext,
} from '../hooks/decision-record'

const NOW = Date.UTC(2026, 9, 8, 20, 0, 0)

const context = (overrides: Partial<RecordContext> = {}): RecordContext => ({
  now: NOW,
  sessionId: 's1',
  engineVersion: '2.1.311',
  setting: 'act',
  effectiveMode: 'act',
  ...overrides,
})

const dedupe: Evaluation = {
  decision: 'dedupe',
  reason: 'exact_repeat',
  isSubagent: false,
  pathHash: 'abc123',
  savings: { grossBytes: 1000, stubBytes: 300 },
}

describe('decisionRecord', () => {
  test('It stamps the time as ISO 8601 UTC', () => {
    expect(decisionRecord(context(), dedupe).ts).toBe('2026-10-08T20:00:00.000Z')
  })

  test('It names reread as the component', () => {
    expect(decisionRecord(context(), dedupe).component).toBe('reread')
  })

  test('It carries the session id and the engine version', () => {
    const record = decisionRecord(context(), dedupe)
    expect([record.session_id, record.engine_version]).toEqual(['s1', '2.1.311'])
  })

  test('It records the decision as the action when the plugin acts', () => {
    expect(decisionRecord(context(), dedupe).action).toBe('dedupe')
  })

  test('It marks an acting record active', () => {
    expect(decisionRecord(context(), dedupe).mode).toBe('active')
  })

  test('It records none as the action in off', () => {
    expect(decisionRecord(context({ setting: 'off', effectiveMode: 'off' }), dedupe).action).toBe('none')
  })

  test('It marks an off record shadow', () => {
    expect(decisionRecord(context({ setting: 'off', effectiveMode: 'off' }), dedupe).mode).toBe('shadow')
  })

  test('It keeps the decision the logic reached in an off record', () => {
    const record = decisionRecord(context({ setting: 'off', effectiveMode: 'off' }), dedupe)
    expect(record.trigger_values.decision).toBe('dedupe')
  })

  test('It records the setting apart from the effective mode when an untested engine holds the plugin in off', () => {
    const record = decisionRecord(context({ setting: 'act', effectiveMode: 'off' }), dedupe)
    expect([record.trigger_values.setting, record.trigger_values.effective_mode, record.mode]).toEqual(['act', 'off', 'shadow'])
  })

  test('It records a pass as the action in ask', () => {
    const pass: Evaluation = { decision: 'pass', reason: 'changed', isSubagent: false, pathHash: 'abc123' }
    expect(decisionRecord(context({ effectiveMode: 'ask', setting: 'ask' }), pass).action).toBe('pass')
  })

  test('It records the reason', () => {
    expect(decisionRecord(context(), dedupe).trigger_values.reason).toBe('exact_repeat')
  })

  test('It names the net bytes saved when the plugin acts', () => {
    expect(decisionRecord(context(), dedupe).trigger_values.bytes_saved).toBe(700)
  })

  test('It leaves bytes_would_save out when the plugin acts', () => {
    expect('bytes_would_save' in decisionRecord(context(), dedupe).trigger_values).toBe(false)
  })

  test('It names the net bytes as bytes_would_save in off', () => {
    const record = decisionRecord(context({ setting: 'off', effectiveMode: 'off' }), dedupe)
    expect(record.trigger_values.bytes_would_save).toBe(700)
  })

  test('It leaves bytes_saved out in off', () => {
    const record = decisionRecord(context({ setting: 'off', effectiveMode: 'off' }), dedupe)
    expect('bytes_saved' in record.trigger_values).toBe(false)
  })

  test('It records gross and stub bytes beside the net', () => {
    const { gross_bytes, stub_bytes } = decisionRecord(context(), dedupe).trigger_values
    expect([gross_bytes, stub_bytes]).toEqual([1000, 300])
  })

  test('It records a negative net when the stub costs more than the contents', () => {
    const tiny: Evaluation = { ...dedupe, savings: { grossBytes: 60, stubBytes: 300 } }
    expect(decisionRecord(context(), tiny).trigger_values.bytes_saved).toBe(-240)
  })

  test('It records the compared bytes of a stub_not_smaller pass without a net in either mode', () => {
    const pass: Evaluation = { decision: 'pass', reason: 'stub_not_smaller', isSubagent: false, savings: { grossBytes: 60, stubBytes: 300 } }
    const keys = [context(), context({ setting: 'off', effectiveMode: 'off' })].map(each => Object.keys(decisionRecord(each, pass).trigger_values).filter(key => key.includes('bytes')))
    expect(keys).toEqual([['gross_bytes', 'stub_bytes'], ['gross_bytes', 'stub_bytes']])
  })

  test('It leaves the byte fields out of a pass', () => {
    const pass: Evaluation = { decision: 'pass', reason: 'changed', isSubagent: false }
    const keys = Object.keys(decisionRecord(context(), pass).trigger_values)
    expect(keys.filter(key => key.includes('bytes'))).toEqual([])
  })

  test('It records whether the read ran in a subagent', () => {
    expect(decisionRecord(context(), { ...dedupe, isSubagent: true }).trigger_values.is_subagent).toBe(true)
  })

  test('It records the path hash and leaves it out when there is none', () => {
    const withoutPath: Evaluation = { decision: 'invalidate', reason: 'bash', isSubagent: false, dropped: 2 }
    expect([decisionRecord(context(), dedupe).trigger_values.path_hash, 'path_hash' in decisionRecord(context(), withoutPath).trigger_values]).toEqual(['abc123', false])
  })

  test('It records the lines, range kind and turns since the read of a dedupe', () => {
    const detailed: Evaluation = { ...dedupe, lines: 40, rangeKind: 'subrange', turnsSinceRead: 3 }
    const { lines, range_kind, turns_since_read } = decisionRecord(context(), detailed).trigger_values
    expect([lines, range_kind, turns_since_read]).toEqual([40, 'subrange', 3])
  })

  test('It records how many reads an invalidation dropped', () => {
    const invalidate: Evaluation = { decision: 'invalidate', reason: 'compaction', isSubagent: true, dropped: 4 }
    expect(decisionRecord(context(), invalidate).trigger_values.dropped).toBe(4)
  })

  test('It records the untested engine as its own action in active mode', () => {
    const untested: Evaluation = { decision: 'untested_engine', reason: 'untested_engine', isSubagent: false }
    const record = decisionRecord(context({ effectiveMode: 'off' }), untested)
    expect([record.action, record.mode]).toEqual(['untested_engine', 'active'])
  })
})

describe('LOG_WRITER', () => {
  test('It appends under umask 077 and chmods the file to 600', () => {
    expect(LOG_WRITER[2]).toBe('umask 077 && mkdir -p -- "$1" && cat >> "$2" && chmod 600 "$2"')
  })
})

describe('isUsableThriftHome', () => {
  test('It accepts an absolute path', () => {
    expect(isUsableThriftHome('/var/thrift')).toBe(true)
  })

  test('It refuses a relative path', () => {
    expect(isUsableThriftHome('relative/dir')).toBe(false)
  })

  test('It refuses a path that starts with a tilde', () => {
    expect(isUsableThriftHome('~/thrift')).toBe(false)
  })

  test('It refuses an unset value', () => {
    expect(isUsableThriftHome(undefined)).toBe(false)
  })
})

describe('logLocation', () => {
  test('It uses THRIFT_HOME when it is absolute', () => {
    expect(logLocation('/var/thrift', '/home/u')).toEqual({ dir: '/var/thrift', file: '/var/thrift/decisions.jsonl' })
  })

  test('It strips trailing slashes from THRIFT_HOME', () => {
    expect(logLocation('/var/thrift//', '/home/u')).toEqual({ dir: '/var/thrift', file: '/var/thrift/decisions.jsonl' })
  })

  test('It puts the log in the root directory for THRIFT_HOME=/', () => {
    expect(logLocation('/', '/home/u')).toEqual({ dir: '/', file: '/decisions.jsonl' })
  })

  test('It falls back to HOME/.claude/thrift when THRIFT_HOME is not absolute', () => {
    expect(logLocation('relative', '/home/u')).toEqual({ dir: '/home/u/.claude/thrift', file: '/home/u/.claude/thrift/decisions.jsonl' })
  })

  test('It strips trailing slashes from HOME', () => {
    expect(logLocation(undefined, '/home/u/')).toEqual({ dir: '/home/u/.claude/thrift', file: '/home/u/.claude/thrift/decisions.jsonl' })
  })

  test('It returns null when neither is usable', () => {
    expect(logLocation(undefined, undefined)).toBeNull()
  })
})
