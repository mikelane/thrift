import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { MeterReading } from '../types'
import { EMPTY_READING } from './reading'

// Change the tag when MeterReading's fields change: it declines what an earlier version stored, which outlives a reload.
const reading = atom({ plugin: 'meter', key: 'reading' } as const, EMPTY_READING, { shape: 'reading-1' })

export function currentReading($: EngineInterface): Promise<MeterReading> {
  return read($, reading)
}

export function changeReading($: EngineInterface, change: (value: MeterReading) => MeterReading): Promise<MeterReading> {
  return update($, reading, change)
}
