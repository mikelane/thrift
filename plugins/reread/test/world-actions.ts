import type { Engine } from 'claude-code/testing'
import type { ToolCallResult } from 'claude-code'
import type { LogRecord, World } from './world'

// `$.tool.call`'s parameter type is a union over every built-in and MCP tool, and resolving it overflows the compiler once many
// MCP servers' types are generated (TS2589). Casting the function, not the input, keeps that union from ever being instantiated.
type LooseToolCall = { tool: string; [argument: string]: unknown }

const callTool = ($: Engine, input: LooseToolCall) => ($.tool.call as unknown as (input: LooseToolCall) => Promise<ToolCallResult>)(input)

type ReadOptions = { offset?: number; limit?: number; pages?: string; allow_large?: boolean; agentId?: string }

export const read = ($: Engine, path: string, options: ReadOptions = {}) => callTool($, { tool: 'Read', file_path: path, ...options })

export const runTool = ($: Engine, tool: string, input: Record<string, unknown> = {}, agentId?: string) =>
  callTool($, { tool, ...input, ...(agentId === undefined ? {} : { agentId }) })

export const startSession = ($: Engine) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

export const endSessionWith = ($: Engine, reason: 'clear' | 'resume' | 'other', sessionId = 'session-1') =>
  $.session.end({ reason, sessionId, resume: { id: sessionId } })

type Trigger = 'manual' | 'auto' | 'plugin' | 'precompute'

export const compact = ($: Engine, trigger: Trigger, agentId?: string) =>
  $.session.compact({ trigger, messages: [{ role: 'user', text: 'work', toolUses: [] }], ...(agentId === undefined ? {} : { agentId }) })

export const lastRecord = (world: World): LogRecord => {
  const record = world.records.at(-1)
  if (record === undefined) throw new Error('no decision record was written')
  return record
}

export const triggerValues = (world: World) => lastRecord(world).trigger_values

export const isStub = (answer: ToolCallResult): boolean =>
  typeof answer.result === 'object' && answer.result !== null && Reflect.get(answer.result, 'type') === 'file_unchanged'
