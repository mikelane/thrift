import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type {
  ContextCategory,
  ContextMcpTool,
  On,
  SessionContextBreakdown,
  SessionRateLimit,
  SessionUsage,
  UiPane,
} from 'claude-code'

export const START = Date.UTC(2026, 9, 20, 9, 0)
export const MINUTE = 60_000

export type UsageCall = 'plain' | 'summary' | 'full'

export type World = {
  clock: MockClock
  usage: SessionUsage
  breakdown: SessionContextBreakdown
  usageCalls: UsageCall[]
  isPlainFailing: boolean
  isBreakdownFailing: boolean
  isRegisterFailing: boolean
  isOpenFailing: boolean
  omitsBreakdown: boolean
  registered: string[]
  opens: { id: string; focus?: true }[]
  closes: string[]
  panes: UiPane[]
  isPlacedOnOpen: boolean
  debugLines: string[]
}

export const category = (name: string, tokens: number, kind: ContextCategory['kind'] = 'used'): ContextCategory => ({
  name,
  tokens,
  color: 'text',
  isDeferred: kind === 'deferred',
  kind,
})

export const tool = (serverName: string, tokens: number, isLoaded = true): ContextMcpTool => ({
  name: `mcp__${serverName}__tool`,
  serverName,
  tokens,
  isLoaded,
})

export const breakdownOf = (overrides: Partial<SessionContextBreakdown> = {}): SessionContextBreakdown => ({
  categories: [category('Messages', 88000), category('MCP tools', 21000), category('Free space', 40000, 'free')],
  totalTokens: 109000,
  maxTokens: 200000,
  rawMaxTokens: 200000,
  autocompactSource: 'model-default',
  percentage: 55,
  gridRows: [],
  model: 'm',
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  isAutoCompactEnabled: true,
  autoCompactThreshold: 167000,
  apiUsage: { input_tokens: 1000, output_tokens: 1, cache_read_input_tokens: 96000, cache_creation_input_tokens: 3000 },
  ...overrides,
})

export const usageOf = (
  tokens: number | undefined,
  rateLimits: SessionRateLimit[] = [],
  cost: number | undefined = undefined,
): SessionUsage => ({
  startedAt: START,
  context: { window: 200000, ...(tokens === undefined ? {} : { tokens }) },
  rateLimits,
  ...(cost === undefined ? {} : { cost: { usd: cost } }),
})

export const resetsIn = (minutes: number): string => new Date(START + minutes * MINUTE).toISOString()

export const install = ($: Engine, on: On): World => {
  const world: World = {
    clock: mock.clock(on, { now: START }),
    usage: usageOf(142000),
    breakdown: breakdownOf(),
    usageCalls: [],
    isPlainFailing: false,
    isBreakdownFailing: false,
    isRegisterFailing: false,
    isOpenFailing: false,
    omitsBreakdown: false,
    registered: [],
    opens: [],
    closes: [],
    panes: [],
    isPlacedOnOpen: true,
    debugLines: [],
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.usage', (_$, e) => {
    world.usageCalls.push(e.breakdown ?? 'plain')
    if (e.breakdown === undefined && world.isPlainFailing) return { deny: 'plain reading refused' }
    if (e.breakdown === undefined) return { value: world.usage }
    if (world.isBreakdownFailing) return { deny: 'count refused' }
    if (world.omitsBreakdown) return { value: world.usage }
    return { value: { ...world.usage, context: { ...world.usage.context, breakdown: world.breakdown } } }
  })
  on('command.register', (_$, e) => {
    if (world.isRegisterFailing) return { deny: 'register refused' }
    world.registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', (_$, e) => {
    if (world.isOpenFailing) return { deny: 'open refused' }
    world.opens.push({ id: e.id, ...(e.focus ? { focus: e.focus } : {}) })
    world.panes = [
      { id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: world.isPlacedOnOpen },
    ]
    return { value: world.isPlacedOnOpen ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'narrow' } }
  })
  on('ui.close', (_$, e) => {
    world.closes.push(e.id)
    world.panes = world.panes.filter(pane => pane.id !== e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: world.panes }))
  on('ui.log', (_$, e) => {
    if (e.to === 'debug') world.debugLines.push(e.text)
    return { value: undefined }
  })
  return world
}

export const startSession = ($: Engine, isInteractive = true) =>
  $.session.start({ cwd: '/work', surface: isInteractive ? 'terminal' : null, isInteractive })

export const runMeter = ($: Engine, args = '') =>
  $.command.run({
    command: 'meter',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })

export const measure = (
  $: Engine,
  usage: SessionUsage,
  changed: ('context' | 'rateLimits' | 'cost')[],
) => $.session.measure({ context: usage.context, rateLimits: usage.rateLimits, cost: usage.cost, changed })

const PANE_PROPS = {
  title: 'meter',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

export const mountPane = ($: Engine) =>
  $.ui.mount({ plugin: 'meter', surface: 'terminal', component: 'Pane', requestId: 'meter', props: PANE_PROPS })

export type MountedPane = Awaited<ReturnType<typeof mountPane>>

export const textsOf = async (pane: MountedPane): Promise<string[]> =>
  (await pane.findAll({ type: 'Text' })).map(found => found.text)
