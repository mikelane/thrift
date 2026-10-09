export type Mode = 'off' | 'ask' | 'act'
export type Signal = 'none' | 'strong' | 'weak'
type StoppingPoint = 'finished-task' | 'new-work' | null
export type Button = 'handoff' | 'handoff-send' | 'send-here' | 'compact' | 'not-now'

type Response =
  | { kind: 'none' }
  | { kind: 'handoff'; holdsPrompt: boolean }
  | { kind: 'compact' }
  | { kind: 'advise'; holdsPrompt: boolean; buttons: readonly Button[] }

const MODES: readonly Mode[] = ['off', 'ask', 'act']
const isMode = (value: unknown): value is Mode => MODES.some(mode => mode === value)
const TICKET_TOKEN = /\b([A-Za-z][A-Za-z0-9]{1,9})-(\d+)\b/g
const TICKET_URL = /https?:\/\/\S*?\/(?:issue|browse)\/([A-Za-z][A-Za-z0-9]{1,9})-\d+/gi
const PR_REFERENCE = /\b(?:pr|issue|pull request)\s*#?(\d+)\b/gi
const PR_URL = /\/(?:pull|issues)\/(\d+)\b/g
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const MESSAGE_FLAG = /^(?:-[A-Za-z]*m|--message)$/
const DRY_RUN_SHORT_FLAG = /^-[A-Za-z]*n[A-Za-z]*$/
const HEREDOC_WORD_END = /[\s;|&<>()]/
const SEPARATORS = new Set([';', '|', '&'])

export const asMode = (value: unknown): Mode =>
  isMode(value) ? value : 'off'

const DEFAULT_THRESHOLD = 150_000
const MIN_THRESHOLD = 80_000
const MAX_THRESHOLD = 2_000_000

export const asThreshold = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, value))
    : DEFAULT_THRESHOLD

type StepSize = {
  input: number
  created: number
  read: number
  advisorCalls: number
  reported: number | undefined
}

export const contextFromStep = ({ input, created, read, advisorCalls, reported }: StepSize): number => {
  const perCall = (input + created + read) / (1 + advisorCalls)
  return Math.round(reported === undefined ? perCall : Math.min(reported, perCall))
}

export const formatTokens = (tokens: number): string => `${Math.round(tokens / 1000)}k`

type Heredoc = { word: string; stripsTabs: boolean }

const readHeredoc = (command: string, start: number): { heredoc: Heredoc; end: number } | null => {
  let index = start + 2
  const stripsTabs = command[index] === '-'
  if (stripsTabs) index += 1
  while (command[index] === ' ' || command[index] === '\t') index += 1
  const quote = command[index] === "'" || command[index] === '"' ? command[index] : null
  if (quote) index += 1
  let word = ''
  while (index < command.length) {
    const char = command.charAt(index)
    if (quote ? char === quote : HEREDOC_WORD_END.test(char)) break
    word += char
    index += 1
  }
  if (word === '') return null
  return { heredoc: { word, stripsTabs }, end: quote ? index + 1 : index }
}

const skipHeredocBody = (command: string, start: number, heredoc: Heredoc): number => {
  let index = start
  while (index < command.length) {
    const lineEnd = command.indexOf('\n', index)
    const end = lineEnd === -1 ? command.length : lineEnd
    const line = command.slice(index, end)
    index = end + 1
    if ((heredoc.stripsTabs ? line.replace(/^\t+/, '') : line) === heredoc.word) break
  }
  return Math.min(index, command.length)
}

export const commandSegments = (command: string): string[] => {
  const segments: string[] = []
  const pending: Heredoc[] = []
  let current = ''
  let quote: string | null = null
  let index = 0

  const endSegment = () => {
    if (current.trim() !== '') segments.push(current.trim())
    current = ''
  }
  const isWordStart = () => index === 0 || /\s/.test(command.charAt(index - 1)) || SEPARATORS.has(command.charAt(index - 1))

  while (index < command.length) {
    const char = command.charAt(index)
    const next = command[index + 1]

    if (quote === "'" || (quote === '"' && char !== '\\')) {
      current += char
      if (char === quote) quote = null
      index += 1
    } else if (char === '\\' && next === '\n') {
      index += 2
    } else if (char === '\\' && next !== undefined) {
      current += char + next
      index += 2
    } else if (quote) {
      current += char
      index += 1
    } else if (char === "'" || char === '"') {
      quote = char
      current += char
      index += 1
    } else if (char === '#' && isWordStart()) {
      while (index < command.length && command[index] !== '\n') index += 1
    } else if (char === '\n') {
      endSegment()
      index += 1
      for (const heredoc of pending.splice(0)) index = skipHeredocBody(command, index, heredoc)
    } else if (SEPARATORS.has(char)) {
      endSegment()
      index += 1
    } else if (command.startsWith('<<', index)) {
      const opened = readHeredoc(command, index)
      if (opened) {
        pending.push(opened.heredoc)
        current += command.slice(index, opened.end)
        index = opened.end
      } else {
        current += '<<'
        index += 2
      }
    } else {
      current += char
      index += 1
    }
  }
  endSegment()
  return segments
}

const words = (segment: string): string[] => {
  const parsedWords: string[] = []
  let word = ''
  let hasWord = false
  let quote: string | null = null

  for (let index = 0; index < segment.length; index += 1) {
    const char = segment.charAt(index)
    if (quote === "'") {
      if (char === "'") quote = null
      else word += char
    } else if (char === '\\' && index + 1 < segment.length) {
      index += 1
      word += segment.charAt(index)
      hasWord = true
    } else if (quote === '"') {
      if (char === '"') quote = null
      else word += char
    } else if (char === "'" || char === '"') {
      quote = char
      hasWord = true
    } else if (/\s/.test(char)) {
      if (hasWord) parsedWords.push(word)
      word = ''
      hasWord = false
    } else {
      word += char
      hasWord = true
    }
  }
  if (hasWord) parsedWords.push(word)
  return parsedWords
}

const withoutMessageValues = (args: readonly string[]): string[] =>
  args.filter((_, index) => !MESSAGE_FLAG.test(args[index - 1] ?? ''))

const finishesWithGit = (rest: readonly string[]): boolean => {
  let index = 0
  while (rest[index] === '-C') index += 2
  const subcommand = rest[index]
  const args = rest.slice(index + 1)
  if (subcommand === 'commit') return !withoutMessageValues(args).includes('--dry-run')
  if (subcommand === 'push') return !args.includes('--dry-run') && !args.some(arg => DRY_RUN_SHORT_FLAG.test(arg))
  return false
}

const finishesWithGh = (rest: readonly string[]): boolean =>
  rest[0] === 'pr' && (rest[1] === 'create' || rest[1] === 'merge') && !rest.includes('--dry-run')

const finishesSegment = (segment: string): boolean => {
  const segmentWords = words(segment)
  const start = segmentWords.findIndex(word => !ASSIGNMENT.test(word))
  if (start === -1) return false
  const [program, ...rest] = segmentWords.slice(start)
  if (program === 'git') return finishesWithGit(rest)
  if (program === 'gh') return finishesWithGh(rest)
  return false
}

export const finishesTask = (command: string): boolean => commandSegments(command).some(finishesSegment)

const unique = (values: Iterable<string>): string[] => [...new Set(values)]

export const ticketUrlPrefixes = (text: string): string[] =>
  unique([...text.matchAll(TICKET_URL)].map(([, prefix = '']) => prefix.toUpperCase()))

export const branchTicketPrefix = (branch: string): string[] =>
  unique([...branch.matchAll(TICKET_TOKEN)].map(([, prefix = '']) => prefix.toUpperCase()))

export const hasTicketShapedToken = (text: string): boolean => new RegExp(TICKET_TOKEN.source).test(text)

export const workRefs = (text: string, prefixes: readonly string[]): string[] => {
  const known = new Set(prefixes.map(prefix => prefix.toUpperCase()))
  const tickets = [...text.matchAll(TICKET_TOKEN)]
    .map(([, prefix = '', digits = '']) => [prefix.toUpperCase(), digits] as const)
    .filter(([prefix]) => known.has(prefix))
    .map(([prefix, digits]) => `${prefix}-${digits}`)
  const pullRequests = [...text.matchAll(PR_REFERENCE), ...text.matchAll(PR_URL)].map(([, digits = '']) => `#${digits}`)
  return unique([...tickets, ...pullRequests])
}

export const namesNewWork = (text: string, seen: ReadonlySet<string>, prefixes: readonly string[]): boolean => {
  const named = workRefs(text, prefixes)
  return seen.size > 0 && named.length > 0 && named.every(ref => !seen.has(ref))
}

type ClassifyInput = {
  contextTokens: number
  threshold: number
  isStoppingPoint: boolean
  isBackgroundBusy: boolean
}

export const classify = ({ contextTokens, threshold, isStoppingPoint, isBackgroundBusy }: ClassifyInput): Signal => {
  if (contextTokens < threshold) return 'none'
  return isStoppingPoint && !isBackgroundBusy ? 'strong' : 'weak'
}

type RespondInput = {
  mode: Mode
  signal: Signal
  stoppingPoint: StoppingPoint
  isBackgroundBusy: boolean
  isUnattended: boolean
}

const NONE: Response = { kind: 'none' }

type BandShape = { signal: Signal; heldPrompt: boolean; isBusy: boolean }

export const bandButtons = ({ signal, heldPrompt, isBusy }: BandShape): readonly Button[] => {
  if (heldPrompt) return isBusy ? ['send-here'] : ['handoff-send', 'send-here']
  if (signal === 'strong') return ['handoff', 'not-now']
  return isBusy ? ['compact', 'not-now'] : ['compact', 'handoff', 'not-now']
}

const respondToStrong = (mode: 'ask' | 'act', stoppingPoint: StoppingPoint): Response => {
  const holdsPrompt = stoppingPoint === 'new-work'
  if (mode === 'act') return { kind: 'handoff', holdsPrompt }
  const buttons = bandButtons({ signal: 'strong', heldPrompt: holdsPrompt, isBusy: false })
  return { kind: 'advise', holdsPrompt, buttons }
}

const respondToWeak = (mode: 'ask' | 'act', isBusy: boolean): Response => {
  if (mode === 'act') return { kind: 'compact' }
  return { kind: 'advise', holdsPrompt: false, buttons: bandButtons({ signal: 'weak', heldPrompt: false, isBusy }) }
}

export const respond = ({ mode, signal, stoppingPoint, isBackgroundBusy, isUnattended }: RespondInput): Response => {
  if (mode === 'off' || signal === 'none') return NONE
  if (isUnattended) return signal === 'strong' ? { kind: 'handoff', holdsPrompt: stoppingPoint === 'new-work' } : NONE
  return signal === 'strong' ? respondToStrong(mode, stoppingPoint) : respondToWeak(mode, isBackgroundBusy)
}

// The decision-time snapshot predates a busy refusal, and classify() gives a weak signal whenever work is busy.
export const busyRefusalTrigger = <T extends { isBusy: boolean; signal: Signal }>(trigger: T): T => ({
  ...trigger,
  isBusy: true,
  signal: 'weak',
})
