import type { ContextBreakdownDetail, EngineInterface, SessionMeasureInput } from 'claude-code'

import { snapshotBreakdown } from './breakdown'
import { debug, logFailure } from './engine-log'
import { PANE_ID, PANE_TITLE } from './pane-id'
import {
  EMPTY_READING,
  headlineFrom,
  isBreakdownDue,
  markStale,
  withBreakdown,
  withHeadline,
} from './reading'
import { changeReading, currentReading } from './reading-store'

// Breakdown counts under way. A count that is already running makes a second one redundant.
let breakdownsInFlight = 0

async function trackingBreakdown(count: () => Promise<void>): Promise<void> {
  breakdownsInFlight += 1
  try {
    await count()
  } finally {
    breakdownsInFlight -= 1
  }
}

export async function isMeterOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE_ID)
}

async function recordFailure($: EngineInterface, what: string, error: unknown): Promise<void> {
  debug($, `could not ${what}: ${String(error)}`)
  await changeReading($, markStale)
}

export async function loadHeadline($: EngineInterface): Promise<void> {
  try {
    const usage = await $.session.usage()
    await changeReading($, reading => withHeadline(reading, headlineFrom(usage)))
  } catch (error) {
    await recordFailure($, 'read usage', error)
  }
}

export function loadBreakdown($: EngineInterface, detail: ContextBreakdownDetail): Promise<void> {
  return trackingBreakdown(() => takeBreakdown($, detail))
}

async function takeBreakdown($: EngineInterface, detail: ContextBreakdownDetail): Promise<void> {
  try {
    const { context } = await $.session.usage({ breakdown: detail })
    if (context.breakdown === undefined) throw new Error('the reply held no breakdown')
    const snapshot = snapshotBreakdown(context.breakdown, await $.clock.now())
    await changeReading($, reading => withBreakdown(reading, snapshot))
  } catch (error) {
    await recordFailure($, `take the ${detail} breakdown`, error)
  }
}

export function openMeter($: EngineInterface, detail: ContextBreakdownDetail): Promise<void> {
  return trackingBreakdown(async () => {
    await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
    await loadHeadline($)
    await loadBreakdown($, detail)
  })
}

export async function restartMeterReading($: EngineInterface): Promise<void> {
  await changeReading($, () => EMPTY_READING)
}

export async function reloadOpenMeter($: EngineInterface): Promise<void> {
  if (!(await isMeterOpen($))) return
  await trackingBreakdown(async () => {
    await loadHeadline($)
    await loadBreakdown($, 'summary')
  })
}

export async function closeMeter($: EngineInterface): Promise<void> {
  await $.ui.close({ id: PANE_ID })
}

export function refreshMeter($: EngineInterface): Promise<void> {
  return loadBreakdown($, 'full')
}

async function redrawFromMeasure($: EngineInterface, e: SessionMeasureInput): Promise<void> {
  if (!(await isMeterOpen($))) return
  await changeReading($, reading => withHeadline(reading, headlineFrom(e)))
  const isDue = isBreakdownDue(await currentReading($), await $.clock.now())
  if (e.changed.includes('context') && isDue && breakdownsInFlight === 0) await loadBreakdown($, 'summary')
}

export function recordMeasure($: EngineInterface, e: SessionMeasureInput): Promise<unknown> {
  return logFailure($, redrawFromMeasure($, e))
}

const USAGE = 'Usage: /meter to open or close the pane, /meter refresh to take a full count.'

export async function runMeterCommand($: EngineInterface, args: string): Promise<{ text: string }> {
  const argument = args.trim()
  if (argument !== '' && argument !== 'refresh') return { text: USAGE }
  const isOpen = await isMeterOpen($)
  if (!isOpen) {
    await openMeter($, argument === 'refresh' ? 'full' : 'summary')
    return { text: 'Meter opened.' }
  }
  if (argument === 'refresh') {
    await refreshMeter($)
    return { text: 'Meter refreshed.' }
  }
  await closeMeter($)
  return { text: 'Meter closed.' }
}
