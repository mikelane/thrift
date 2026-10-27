import type { EngineInterface, Origin, ToolCallResult } from 'claude-code'

import { coveredLines, grossBytesOf, rangeKindOf } from './coverage'
import type { DecisionReason, Evaluation, Savings } from './decision-record'
import { engineInfo, type EngineInfo } from './engine-info'
import { debug } from './engine-log'
import { pathHash, sha256Hex } from './hashing'
import { classifyReadResult } from './read-result'
import {
  contextOf,
  findTracked,
  hasPath,
  isFullResult,
  requestOf,
  trackRead,
  type Found,
  type ReadRequest,
} from './read-tracking'
import { writeRecord } from './record-writer'
import type { SessionState } from './session-state'
import { lineByteLengths, savingsOf, stubContextLine, stubIsSmaller, stubResult, utf8Bytes } from './stub'

export type ReadCall = {
  tool_use_id: string
  file_path: string
  offset?: number
  limit?: number
  pages?: string
  allow_large?: boolean
  agentId?: string
}

// `run` hands the call on to the tool. `origin` names who raised it: the engine for the model's own call.
export type Proceed = { origin: Origin; run: () => Promise<ToolCallResult<string>> }

type FileStat = { size: number; mtimeMs: number; realPath: string }

type Subject = { info: EngineInfo; isSubagent: boolean; context: string; agentId: string | undefined }

type PassVerdict = { kind: 'pass'; decision: 'pass' | 'override'; reason: DecisionReason; found: Found; savings?: Savings }

type DedupeEvaluation = Awaited<ReturnType<typeof dedupeEvaluation>>

type Verdict = { kind: 'dedupe'; found: Found; dedupe: DedupeEvaluation } | PassVerdict

const ENGINE = 'engine'

async function statFile($: EngineInterface, path: string): Promise<FileStat | undefined> {
  try {
    const stat = await $.fs.stat(path, { resolve: true })
    return stat.kind === 'file' && stat.realPath !== undefined ? { size: stat.size, mtimeMs: stat.mtimeMs, realPath: stat.realPath } : undefined
  } catch (error) {
    debug($, `could not stat a file: ${String(error)}`)
    return undefined
  }
}

async function readText($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    return await $.fs.read(path)
  } catch (error) {
    debug($, `could not read a file: ${String(error)}`)
    return undefined
  }
}

async function isInContext($: EngineInterface, agentId: string | undefined, toolUseId: string): Promise<boolean> {
  try {
    const messages = agentId === undefined ? await $.session.messages() : await $.session.messages({ agentId })
    return Array.isArray(messages) && messages.some(message => message.toolResults?.some(result => result.tool_use_id === toolUseId) === true)
  } catch (error) {
    debug($, `could not read the conversation: ${String(error)}`)
    return false
  }
}

async function note($: EngineInterface, subject: Subject, evaluation: Omit<Evaluation, 'isSubagent'>): Promise<void> {
  await writeRecord($, subject.info, { ...evaluation, isSubagent: subject.isSubagent })
}

const unchanged = (before: FileStat, tracked: { size: number; mtimeMs: number }): boolean =>
  before.size === tracked.size && before.mtimeMs === tracked.mtimeMs

// The steps after the lookup, in order. Anything short of all of them passes: absence always means pass.
async function judge($: EngineInterface, subject: Subject, call: ReadCall, request: ReadRequest, found: Found, before: FileStat): Promise<Verdict> {
  const { tracked } = found
  if (tracked.stubbedKeys.has(request.key)) return { kind: 'pass', decision: 'override', reason: 'override_after_stub', found }
  if (!unchanged(before, tracked)) return { kind: 'pass', decision: 'pass', reason: 'changed', found }
  const text = await readText($, request.realPath)
  if (text === undefined) return { kind: 'pass', decision: 'pass', reason: 'unreadable', found }
  if ((await sha256Hex(text)) !== tracked.sha256) return { kind: 'pass', decision: 'pass', reason: 'changed', found }
  if (!(await isInContext($, call.agentId, tracked.toolUseId))) return { kind: 'pass', decision: 'pass', reason: 'not_in_context', found }
  // Last, so a stub is only costed once a dedupe is possible: a stub that is not smaller than the read it replaces saves nothing.
  const dedupe = await dedupeEvaluation($, call, request, found)
  if (!stubIsSmaller(dedupe.evaluation.savings)) return { kind: 'pass', decision: 'pass', reason: 'stub_not_smaller', found, savings: dedupe.evaluation.savings }
  return { kind: 'dedupe', found, dedupe }
}

// Runs the tool, then tracks what it returned. Returns why nothing (or not everything) was tracked, if so. Never throws once the
// tool has run: a failure here must not run the tool a second time.
async function runAndTrack(
  $: EngineInterface,
  state: SessionState,
  subject: Subject,
  call: ReadCall,
  request: ReadRequest,
  before: FileStat,
  proceed: Proceed,
): Promise<{ ran: ToolCallResult<string>; untracked: DecisionReason | undefined }> {
  const ran = await proceed.run()
  try {
    return { ran, untracked: await trackResult($, state, subject, call, request, before, ran) }
  } catch (error) {
    debug($, `could not track a read: ${String(error)}`)
    return { ran, untracked: 'unreadable' }
  }
}

async function trackResult(
  $: EngineInterface,
  state: SessionState,
  subject: Subject,
  call: ReadCall,
  request: ReadRequest,
  before: FileStat,
  ran: ToolCallResult<string>,
): Promise<DecisionReason | undefined> {
  const outcome = classifyReadResult(ran)
  if (outcome.kind === 'error') return 'error_result'
  if (outcome.kind === 'not_text') return 'not_text'
  if (outcome.kind === 'file_unchanged') return 'core_dedup'
  const after = await statFile($, request.realPath)
  if (after === undefined || !unchanged(before, after)) return 'changed'
  const text = await readText($, request.realPath)
  if (text === undefined) return 'unreadable'
  const { startLine, numLines, totalLines } = outcome.lines
  const isFull = isFullResult(outcome.lines)
  trackRead(state.reads, subject.context, request.key, {
    toolUseId: call.tool_use_id,
    realPath: request.realPath,
    turn: await $.session.turns(),
    size: after.size,
    mtimeMs: after.mtimeMs,
    sha256: await sha256Hex(text),
    startLine,
    numLines,
    totalLines,
    textBytes: utf8Bytes(outcome.modelText),
    isFull,
    lineBytes: isFull ? lineByteLengths(text) : [],
    stubbedKeys: new Set(),
  })
  return outcome.lines.truncatedByTokenCap === true ? 'token_cap_truncated' : undefined
}

async function passUntracked($: EngineInterface, subject: Subject, proceed: Proceed, reason: DecisionReason): Promise<ToolCallResult<string>> {
  const ran = await proceed.run()
  await note($, subject, { decision: 'pass', reason })
  return ran
}

// What a dedupe is recorded as, the same whether the stub was sent (act, ask) or only counted (off).
async function dedupeEvaluation($: EngineInterface, call: ReadCall, request: ReadRequest, found: Found) {
  const line = stubContextLine(call.file_path, found.tracked.turn, coveredLines(found, request))
  return {
    line,
    evaluation: {
      decision: 'dedupe' as const,
      reason: found.match === 'exact' ? ('exact_repeat' as const) : ('inside_full_read' as const),
      savings: savingsOf(grossBytesOf(found, request), stubResult(call.file_path), line),
      lines: coveredLines(found, request),
      rangeKind: rangeKindOf(found, request),
      turnsSinceRead: (await $.session.turns()) - found.tracked.turn,
    },
  }
}

async function answerWithStub($: EngineInterface, state: SessionState, subject: Subject, call: ReadCall, request: ReadRequest, found: Found, { line, evaluation }: DedupeEvaluation) {
  found.tracked.stubbedKeys.add(request.key)
  if (subject.info.effectiveMode === 'ask') {
    $.ui.log(`reread: ${call.file_path} is unchanged, so its Read was answered with a stub (${evaluation.savings.grossBytes} bytes held back, stub ${evaluation.savings.stubBytes})`)
  }
  await note($, subject, { ...evaluation, pathHash: await pathHash(state.salt, request.realPath) })
  return { result: stubResult(call.file_path), context: [line] }
}

// In off the tool runs and the evaluation is logged as the saving a stub would have made.
async function shadowDedupe($: EngineInterface, state: SessionState, subject: Subject, call: ReadCall, request: ReadRequest, { evaluation }: DedupeEvaluation, before: FileStat, proceed: Proceed) {
  const { ran, untracked } = await runAndTrack($, state, subject, call, request, before, proceed)
  const pathDetail = { pathHash: await pathHash(state.salt, request.realPath) }
  if (untracked !== undefined) {
    await note($, subject, { decision: 'pass', reason: untracked, ...pathDetail })
    return ran
  }
  await note($, subject, { ...evaluation, ...pathDetail })
  return ran
}

async function passAndTrack($: EngineInterface, state: SessionState, subject: Subject, call: ReadCall, request: ReadRequest, before: FileStat, proceed: Proceed, verdict: PassVerdict | undefined) {
  const firstOrOther = hasPath(state.reads, subject.context, request.realPath) ? 'different_range' : 'first_read'
  const { ran, untracked } = await runAndTrack($, state, subject, call, request, before, proceed)
  if (verdict?.decision === 'override') verdict.found.tracked.stubbedKeys.delete(request.key)
  await note($, subject, {
    decision: verdict?.decision ?? 'pass',
    reason: untracked ?? verdict?.reason ?? firstOrOther,
    ...(untracked === undefined && verdict?.savings !== undefined ? { savings: verdict.savings } : {}),
    pathHash: await pathHash(state.salt, request.realPath),
  })
  return ran
}

export async function readTool($: EngineInterface, state: SessionState, call: ReadCall, proceed: Proceed): Promise<ToolCallResult<string>> {
  const info = await engineInfo($, state)
  const subject: Subject = { info, isSubagent: call.agentId !== undefined, context: contextOf(call.agentId), agentId: call.agentId }
  if (proceed.origin.plugin !== ENGINE) return passUntracked($, subject, proceed, 'plugin_call')
  if (call.pages !== undefined) return passUntracked($, subject, proceed, 'pdf_pages')
  const before = await statFile($, call.file_path)
  if (before === undefined) return passUntracked($, subject, proceed, 'unreadable')
  const request = requestOf(before.realPath, call)
  const found = findTracked(state.reads, subject.context, request)
  const verdict = found === undefined ? undefined : await judge($, subject, call, request, found, before)
  if (verdict?.kind !== 'dedupe') return passAndTrack($, state, subject, call, request, before, proceed, verdict)
  if (info.effectiveMode === 'off') return shadowDedupe($, state, subject, call, request, verdict.dedupe, before, proceed)
  return answerWithStub($, state, subject, call, request, verdict.found, verdict.dedupe)
}
