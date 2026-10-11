import type { Evaluation, RecordState } from './decision-record'

// Takes the builder as an argument so this module has no runtime imports: the check that runs it under
// --experimental-strip-types follows only explicit `.ts` imports, which `tsc -p` over hooks/ does not allow.
type RecordBuilder = (state: RecordState, evaluation: Evaluation, now: number, sessionId: string) => unknown

const SAMPLE_LINE = /^\{"ts":/

type SampleTriggerValues = {
  point: Evaluation['point']
  signal: Evaluation['signal']
  is_background_busy: boolean
  context_tokens: number
  cache_read_tokens: number
  threshold: number
  setting: RecordState['setting']
  effective_mode: RecordState['mode']
  reason?: Evaluation['reason']
  note?: Evaluation['note']
  cleared_by?: Evaluation['clearedBy']
  compacted_before_clear?: boolean
  held_groups?: number
  held_unattended?: boolean
  handoff_unattended?: boolean
  held_other_delivery?: NonNullable<Evaluation['heldFields']>['held_other_delivery']
  held_restore?: NonNullable<Evaluation['heldFields']>['held_restore']
}

type SampleRecord = {
  ts: string
  session_id: string
  action: Evaluation['action']
  engine_version: string
  trigger_values: SampleTriggerValues
}

export const parseReadmeSampleLine = (readme: string): string => {
  const lines = readme.split('\n').filter(line => SAMPLE_LINE.test(line))
  const [line, ...extraLines] = lines
  if (line === undefined) throw new Error('The README has no sample record line (a line that starts with {"ts":).')
  if (extraLines.length > 0) throw new Error(`The README has ${lines.length} sample record lines. Keep one.`)
  return line
}

// The inverse of the builder: the README line supplies every field, so a key the builder places differently,
// renames, or does not write shows up as a difference from the line itself.
export const rebuildSampleLine = (line: string, build: RecordBuilder): string => {
  const sample: SampleRecord = JSON.parse(line)
  const values = sample.trigger_values
  const hasHeldFields = values.held_groups !== undefined
  const evaluation: Evaluation = {
    point: values.point,
    signal: values.signal,
    isBusy: values.is_background_busy,
    contextTokens: values.context_tokens,
    cacheReadTokens: values.cache_read_tokens,
    action: sample.action,
    reason: values.reason,
    note: values.note,
    clearedBy: values.cleared_by,
    compactedBeforeClear: values.compacted_before_clear,
    heldFields: hasHeldFields
      ? {
          held_groups: values.held_groups ?? 0,
          held_unattended: values.held_unattended ?? false,
          handoff_unattended: values.handoff_unattended,
          held_other_delivery: values.held_other_delivery,
          held_restore: values.held_restore,
        }
      : undefined,
  }
  const state: RecordState = {
    mode: values.effective_mode,
    setting: values.setting,
    threshold: values.threshold,
    engineVersion: sample.engine_version,
    contextTokens: values.context_tokens,
    cacheReadTokens: values.cache_read_tokens,
  }
  return JSON.stringify(build(state, evaluation, Date.parse(sample.ts), sample.session_id))
}

export const findSampleDrift = (readme: string, build: RecordBuilder): string[] => {
  const line = parseReadmeSampleLine(readme)
  const rebuilt = rebuildSampleLine(line, build)
  return rebuilt === line
    ? []
    : [`The README sample record differs from what recordFromEvaluation writes for its fields.\nREADME: ${line}\nbuilt:  ${rebuilt}`]
}
