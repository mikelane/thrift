import type { DecisionRecord, Evaluation, RecordStateFields } from './decision-record'

// Takes the builder as an argument so this module has no runtime imports: the check that runs it under
// --experimental-strip-types follows only explicit `.ts` imports, which `tsc -p` over hooks/ does not allow.
type RecordBuilder = (state: RecordStateFields, evaluation: Evaluation, now: number, sessionId: string) => unknown

const SAMPLE_LINE = /^\{"ts":/

// The fields the README line supplies, derived from the builder's own record so a new field cannot drift from it.
type SampleRecord = Pick<DecisionRecord, 'ts' | 'session_id' | 'action' | 'engine_version' | 'trigger_values'>

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isOptional = (value: unknown, type: 'string' | 'number' | 'boolean'): boolean =>
  value === undefined || typeof value === type

// Proves the shape the rebuild reads. Literal-union members (signal, action, reason, ...) are not checked here: that
// needs the domain's value lists at runtime, which this module cannot import.
const isSampleRecord = (value: unknown): value is SampleRecord => {
  if (!isObject(value) || !isObject(value.trigger_values)) return false
  const values = value.trigger_values
  return (
    typeof value.ts === 'string' &&
    typeof value.session_id === 'string' &&
    typeof value.action === 'string' &&
    typeof value.engine_version === 'string' &&
    typeof values.point === 'string' &&
    typeof values.signal === 'string' &&
    typeof values.is_background_busy === 'boolean' &&
    typeof values.context_tokens === 'number' &&
    typeof values.cache_read_tokens === 'number' &&
    typeof values.threshold === 'number' &&
    typeof values.setting === 'string' &&
    typeof values.effective_mode === 'string' &&
    isOptional(values.reason, 'string') &&
    isOptional(values.note, 'string') &&
    isOptional(values.cleared_by, 'string') &&
    (values.compacted_before_clear === undefined || values.compacted_before_clear === true) &&
    isOptional(values.held_groups, 'number') &&
    isOptional(values.held_unattended, 'boolean') &&
    isOptional(values.handoff_unattended, 'boolean') &&
    isOptional(values.held_other_delivery, 'string') &&
    isOptional(values.held_restore, 'string')
  )
}

export const extractReadmeSampleLine = (readme: string): string => {
  const lines = readme.split('\n').filter(line => SAMPLE_LINE.test(line))
  const [line, ...extraLines] = lines
  if (line === undefined) throw new Error('The README has no sample record line (a line that starts with {"ts":).')
  if (extraLines.length > 0) throw new Error(`The README has ${lines.length} sample record lines. Keep one.`)
  return line
}

// The inverse of the builder: the README line supplies every field, so a key the builder places differently,
// renames, or does not write shows up as a difference from the line itself.
export const rebuildSampleLine = (line: string, build: RecordBuilder): string => {
  const sample: unknown = JSON.parse(line)
  if (!isSampleRecord(sample)) throw new Error(`The README sample record does not have the fields a record holds: ${line}`)
  const values = sample.trigger_values
  const hasHeldFields = values.held_groups !== undefined
  const evaluation: Evaluation = {
    point: values.point,
    signal: values.signal,
    isBusy: values.is_background_busy,
    contextTokens: values.context_tokens,
    cacheReadTokens: values.cache_read_tokens,
    effectiveMode: values.effective_mode,
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
  const state: RecordStateFields = {
    setting: values.setting,
    threshold: values.threshold,
    engineVersion: sample.engine_version,
  }
  return JSON.stringify(build(state, evaluation, Date.parse(sample.ts), sample.session_id))
}

export const findSampleDrift = (readme: string, build: RecordBuilder): string[] => {
  const line = extractReadmeSampleLine(readme)
  const rebuilt = rebuildSampleLine(line, build)
  return rebuilt === line
    ? []
    : [`The README sample record differs from what recordFromEvaluation writes for its fields.\nREADME: ${line}\nbuilt:  ${rebuilt}`]
}
