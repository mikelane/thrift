import { describe, expect, mock, test } from 'claude-code/testing'
import type { UiPane } from 'claude-code'

import { START, breakdownOf, install, measure, mountPane, runMeter, startSession, textsOf, usageOf } from './meter-world'

// Engine-wiring helpers a test cannot call directly, each driven through the events that reach it.

const CLEAR = { reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as const

describe('logFailure', () => {
  test('It writes background work failed to the debug log when the auto-opened pane is refused', { options: { meterAutoOpen: true } }, async ($, on) => {
    const world = install($, on)
    world.isOpenFailing = true
    await startSession($)
    await world.clock.settle()
    expect(world.debugLines).toHaveLength(1)
    expect(world.debugLines[0]).toStartWith('meter: background work failed:')
    expect(world.debugLines[0]).toContain('open refused')
  })

  test('It writes background work failed to the debug log when the pane list cannot be read during a measure', async ($, on) => {
    const debugLines: string[] = []
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('ui.panes', () => ({ deny: 'panes gone' }))
    on('ui.log', (_$, e) => {
      debugLines.push(e.text)
      return { value: undefined }
    })
    await startSession($)
    expect(await measure($, usageOf(150000), ['context'])).toEqual({ changed: ['context'] })
    expect(debugLines).toHaveLength(1)
    expect(debugLines[0]).toStartWith('meter: background work failed:')
    expect(debugLines[0]).toContain('panes gone')
  })
})

describe('debug', () => {
  test('It writes its line to the debug log and nowhere else', async ($, on) => {
    const destinations: unknown[] = []
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('command.register', () => ({ deny: 'register refused' }))
    on('ui.log', (_$, e) => {
      destinations.push(e.to)
      return { value: undefined }
    })
    await startSession($)
    expect(destinations).toEqual(['debug'])
  })
})

describe('rememberInteractivity', () => {
  test('It still registers /meter when the store refuses the interactivity write', async ($, on) => {
    const world = install($, on)
    on('state.set', (_$, e, next) => (e.key === 'isInteractive' ? { deny: 'store full' } : next(e)))
    await startSession($)
    expect(world.registered).toEqual(['meter'])
    expect(world.debugLines[0]).toStartWith('meter: background work failed:')
    expect(world.debugLines[0]).toContain('store full')
  })
})

describe('currentReading', () => {
  test('It draws the reading the store already holds when the plugin starts again', async ($, on) => {
    install($, on)
    const stored = { headline: { contextWindow: 200000, rateLimits: [], costUsd: 4.82 }, breakdown: null, isStale: false }
    on('state.get', (_$, e, next) => (e.key === 'reading' ? { value: { value: { shape: 'reading-1', value: stored }, version: 0 } } : next(e)))
    expect((await textsOf(await mountPane($))).join('\n')).toContain('$4.82 at API rates')
  })
})

describe('changeReading', () => {
  test('It answers that it could not run when the store refuses the reading write', async ($, on) => {
    install($, on)
    on('state.set', (_$, e, next) => (e.key === 'reading' ? { deny: 'store full' } : next(e)))
    await startSession($)
    expect(await runMeter($)).toEqual({ text: 'Could not run /meter.' })
  })
})

describe('restartMeterReading', () => {
  // The refused count began before the clear, so it describes the cleared session and must not mark the new one stale.
  test('It leaves the header unmarked when a full count that began before a clear is refused after it', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const debugLines: string[] = []
    let panes: UiPane[] = []
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('ui.log', (_$, e) => {
      debugLines.push(e.text)
      return { value: undefined }
    })
    on('ui.panes', () => ({ value: panes }))
    on('ui.open', (_$, e) => {
      panes = [{ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true }]
      return { value: { isPlaced: true as const } }
    })
    let releaseFull: () => void = () => {}
    const fullGate = new Promise<void>(resolve => {
      releaseFull = resolve
    })
    const usage = usageOf(142000)
    const counted = { value: { ...usage, context: { ...usage.context, breakdown: breakdownOf() } } }
    const refused = fullGate.then(() => ({ deny: 'count refused' }))
    // In order: the opening plain and summary, the gated full count, then the plain and summary reload after the clear.
    const answers = [counted, counted, refused, counted, counted]
    on('session.usage', () => answers.shift()!)
    await startSession($)
    await runMeter($)
    const refreshing = runMeter($, 'refresh')
    await clock.advance(0)
    await $.session.end(CLEAR)
    await clock.settle()
    releaseFull()
    await refreshing
    expect(debugLines.at(-1)).toStartWith('meter: could not take the full breakdown:')
    expect(await textsOf(await mountPane($))).not.toContain('⚠ stale')
  })
})
