import type { ContextBreakdownDetail, EngineInterface, SessionMeasureInput, UiOpenResult } from 'claude-code'

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

// Counts the clears. A reading that began before a clear describes the session that was cleared, so it is dropped.
let readingGeneration = 0

async function trackingBreakdown(count: () => Promise<void>): Promise<void> {
  breakdownsInFlight += 1
  try {
    await count()
  } finally {
    breakdownsInFlight -= 1
  }
}

async function isMeterOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE_ID)
}

async function recordFailure($: EngineInterface, failedAction: string, error: unknown, generation: number): Promise<void> {
  debug($, `could not ${failedAction}: ${String(error)}`)
  if (generation === readingGeneration) await changeReading($, markStale)
}

async function loadHeadline($: EngineInterface): Promise<void> {
  const generation = readingGeneration
  try {
    const usage = await $.session.usage()
    if (generation !== readingGeneration) return
    await changeReading($, reading => withHeadline(reading, headlineFrom(usage)))
  } catch (error) {
    await recordFailure($, 'read usage', error, generation)
  }
}

function loadBreakdown($: EngineInterface, detail: ContextBreakdownDetail): Promise<void> {
  return trackingBreakdown(() => takeBreakdown($, detail))
}

async function takeBreakdown($: EngineInterface, detail: ContextBreakdownDetail): Promise<void> {
  const generation = readingGeneration
  try {
    const { context } = await $.session.usage({ breakdown: detail })
    if (context.breakdown === undefined) throw new Error('the reply held no breakdown')
    const snapshot = snapshotBreakdown(context.breakdown, await $.clock.now())
    if (generation !== readingGeneration) return
    await changeReading($, reading => withBreakdown(reading, snapshot))
  } catch (error) {
    await recordFailure($, `take the ${detail} breakdown`, error, generation)
  }
}

function loadReading($: EngineInterface, detail: ContextBreakdownDetail): Promise<void> {
  return trackingBreakdown(async () => {
    await loadHeadline($)
    await loadBreakdown($, detail)
  })
}

function openPane($: EngineInterface): Promise<UiOpenResult> {
  return $.ui.open({ id: PANE_ID, title: PANE_TITLE })
}

export async function openMeter($: EngineInterface, detail: ContextBreakdownDetail): Promise<void> {
  await openPane($)
  await loadReading($, detail)
}

export async function restartMeterReading($: EngineInterface): Promise<void> {
  readingGeneration += 1
  await changeReading($, () => EMPTY_READING)
}

export async function reloadOpenMeter($: EngineInterface): Promise<void> {
  if (!(await isMeterOpen($))) return
  await loadReading($, 'summary')
}

async function closeMeter($: EngineInterface): Promise<void> {
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
  const listedPane = (await $.ui.panes()).find(pane => pane.id === PANE_ID)
  if (listedPane?.isPlaced) return argument === 'refresh' ? refreshAndReply($) : closeAndReply($)
  const opened = await openPane($)
  // An asked open that still places nothing (no surface) would otherwise leave /meter unable to close the pane.
  if (!opened.isPlaced && listedPane !== undefined) return closeAndReply($)
  await loadReading($, argument === 'refresh' ? 'full' : 'summary')
  if (opened.isPlaced) return { text: 'Meter opened.' }
  return { text: `Meter opened, but nothing here can show it yet (${opened.reason}).` }
}

async function refreshAndReply($: EngineInterface): Promise<{ text: string }> {
  await refreshMeter($)
  return { text: 'Meter refreshed.' }
}

async function closeAndReply($: EngineInterface): Promise<{ text: string }> {
  await closeMeter($)
  return { text: 'Meter closed.' }
}
