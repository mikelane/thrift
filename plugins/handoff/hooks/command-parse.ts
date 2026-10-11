const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const MESSAGE_FLAG = /^(?:-[A-Za-z]*m|--message)$/
const DRY_RUN_SHORT_FLAG = /^-[A-Za-z]*n[A-Za-z]*$/
const HEREDOC_WORD_END = /[\s;|&<>()]/
const SEPARATORS = new Set([';', '|', '&'])

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

// SAFETY: this is a lexer over the command text, not a shell parser, so it has known gaps. It misses a commit or push inside
// $(...), backticks, a subshell, or a then/do/{ block, behind sudo, env, or time, and with git -c, --git-dir, or gh -R. It
// reads $((1<<2)) as a heredoc opener, and counts `git push --help` as finishing a task. The misses only downgrade a strong
// signal to weak, and the over-counts need a command that is not a real push or an arithmetic expansion to follow. Each
// gap needs a command shaped to hit it, which a person finishing a task rarely types, and the cost is one turn end judged
// as unfinished or finished, so no guard is worth the parser it would take.
export const finishesTask = (command: string): boolean => commandSegments(command).some(finishesSegment)
