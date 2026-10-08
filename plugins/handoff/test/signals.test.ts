import { expect, test } from 'claude-code/testing'

import {
  asMode,
  branchTicketPrefix,
  classify,
  commandSegments,
  finishesTask,
  formatTokens,
  hasTicketShapedToken,
  namesNewWork,
  respond,
  ticketUrlPrefixes,
  workRefs,
} from '../hooks/signals'

const asModeCases = [
  ['off', 'off'],
  ['ask', 'ask'],
  ['act', 'act'],
  ['ACT', 'off'],
  ['', 'off'],
  [undefined, 'off'],
  [3, 'off'],
] as const

for (const [input, expected] of asModeCases) {
  test(`It returns ${expected} from asMode for ${JSON.stringify(input)}`, () => {
    expect(asMode(input)).toBe(expected)
  })
}

const formatTokensCases = [
  [0, '0k'],
  [499, '0k'],
  [500, '1k'],
  [152_400, '152k'],
  [1_500, '2k'],
  [1_999_600, '2000k'],
] as const

for (const [tokens, expected] of formatTokensCases) {
  test(`It returns ${expected} from formatTokens for ${tokens}`, () => {
    expect(formatTokens(tokens)).toBe(expected)
  })
}

const segmentCases = [
  ['git status', ['git status']],
  ['  git status  ', ['git status']],
  ['a; b', ['a', 'b']],
  ['a | b', ['a', 'b']],
  ['a && b', ['a', 'b']],
  ['a || b', ['a', 'b']],
  ['a & b', ['a', 'b']],
  ['a\nb', ['a', 'b']],
  ['a;;b', ['a', 'b']],
  ['git commit -m "x; git push"', ['git commit -m "x; git push"']],
  ["git commit -m 'x && y'", ["git commit -m 'x && y'"]],
  ['echo "a \\" ; b" ; c', ['echo "a \\" ; b"', 'c']],
  ['echo a\\;b', ['echo a\\;b']],
  ['echo hi # git commit -m x', ['echo hi']],
  ['echo hi # note\ngit push', ['echo hi', 'git push']],
  ['echo a#b; c', ['echo a#b', 'c']],
  ['echo "# not a comment"; c', ['echo "# not a comment"', 'c']],
  ['echo one \\\ntwo', ['echo one two']],
  ['cat <<EOF\ngit commit -m x\nEOF\ngit push', ['cat <<EOF', 'git push']],
  ['cat <<-EOF\n\tgit commit\n\tEOF\ngit push', ['cat <<-EOF', 'git push']],
  ["cat <<'EOF'\ngit commit\nEOF\nls", ["cat <<'EOF'", 'ls']],
  ['cat <<"EOF"\ngit commit\nEOF\nls', ['cat <<"EOF"', 'ls']],
  ['cat <<EOF && git push\nbody\nEOF', ['cat <<EOF', 'git push']],
  ['cat <<A <<B\none\nA\ntwo\nB\nls', ['cat <<A <<B', 'ls']],
  ['cat <<EOF\nnever closed\ngit commit', ['cat <<EOF']],
  ['cat <<< "git commit"\nls', ['cat <<< "git commit"', 'ls']],
  ['echo "<<EOF"\ngit commit -m x', ['echo "<<EOF"', 'git commit -m x']],
  ["echo '<<EOF'\ngit commit -m x", ["echo '<<EOF'", 'git commit -m x']],
  ['echo ok # <<EOF\ngit commit -m x', ['echo ok', 'git commit -m x']],
  ['git commit -m "$(cat <<\'EOF\'\nmsg\nEOF\n)"', ['git commit -m "$(cat <<\'EOF\'\nmsg\nEOF\n)"']],
  ['', []],
  [' ; ', []],
  ['echo "it\'s"; git commit -m x', ['echo "it\'s"', 'git commit -m x']],
  ['cat <<EOF\n\tEOF\nEOF\ngit push', ['cat <<EOF', 'git push']],
  ['git commit -m "unterminated; git push', ['git commit -m "unterminated; git push']],
  ['echo `git commit -m x`', ['echo `git commit -m x`']],
] as const

for (const [command, expected] of segmentCases) {
  test(`It returns ${JSON.stringify(expected)} from commandSegments for ${JSON.stringify(command)}`, () => {
    expect(commandSegments(command)).toEqual(expected)
  })
}

const finishesTaskCases = [
  ['git commit -m "x"', true],
  ['git push', true],
  ['git push origin main', true],
  ['gh pr create --title t', true],
  ['gh pr merge 12 --squash', true],
  ['git -C ../other commit -m x', true],
  ['git -C /a/b push', true],
  ['FOO=bar git commit -m x', true],
  ['A=1 B="two words" git push', true],
  ['cd repo && git commit -m x', true],
  ['npm test; git push', true],
  ['git add . | git commit -m x', true],
  ['git commit -am "x"', true],
  ['git commit -n -m x', true],
  ['git commit --no-verify -m x', true],
  ['git commit --amend --no-edit', true],
  ['git commit -m "fix --dry-run docs"', true],
  ['git commit -m --dry-run', true],
  ['git commit -am --dry-run', true],
  ['git commit --message=x', true],
  ['git commit --dry-run', false],
  ['git push --dry-run', false],
  ['git push -n', false],
  ['git push -n origin main', false],
  ['git push origin main -n', false],
  ['git push -un origin main', false],
  ['git push -u origin main', true],
  ['git push --no-verify', true],
  ['gh pr create --dry-run', false],
  ['git -C ../other push --dry-run', false],
  ['git status', false],
  ['git log --oneline', false],
  ['git pull', false],
  ['gh pr view 12', false],
  ['gh issue create', false],
  ['gh pr', false],
  ['ls', false],
  ['', false],
  ['echo "git commit -m x"', false],
  ["echo 'git push'", false],
  ['echo hi # git commit -m x', false],
  ['cat <<EOF\ngit commit -m x\nEOF', false],
  ['git commit -m "$(cat <<\'EOF\'\nmsg\nEOF\n)"', true],
  ['echo "<<EOF"\ngit push', true],
  ['echo ok # <<EOF\ngit push', true],
  ['git', false],
  ['git -C', false],
  ['FOO=bar', false],
  ['sudo git commit', false],
  ['git commit -m a && git push --dry-run', true],
  ['git push --dry-run && git commit -m a', true],
  ['gh pr merge 5 --admin --squash', true],
  ['git push origin HEAD:refs/heads/x -n', false],
  ['echo `git commit -m x`', false],
  ['git commit -m "unterminated', true],
  ['git push 2>&1 | tail -3', true],
] as const

for (const [command, expected] of finishesTaskCases) {
  test(`It returns ${expected} from finishesTask for ${JSON.stringify(command)}`, () => {
    expect(finishesTask(command)).toBe(expected)
  })
}

const urlPrefixCases = [
  ['see https://linear.app/acme/issue/ENG-12/fix-the-thing', ['ENG']],
  ['see https://acme.atlassian.net/browse/OPS-7', ['OPS']],
  ['https://linear.app/a/issue/eng-1 and https://x.atlassian.net/browse/OPS-2', ['ENG', 'OPS']],
  ['https://linear.app/a/issue/ENG-1 https://linear.app/a/issue/ENG-2', ['ENG']],
  ['ENG-12 with no url', []],
  ['https://example.com/issue/ENG', []],
  ['/browse/OPS-7 without a scheme', []],
] as const

for (const [text, expected] of urlPrefixCases) {
  test(`It returns ${JSON.stringify(expected)} from ticketUrlPrefixes for ${JSON.stringify(text)}`, () => {
    expect(ticketUrlPrefixes(text)).toEqual(expected)
  })
}

const branchCases = [
  ['alice/eng-42-fix', ['ENG']],
  ['feature/PROJ-7', ['PROJ']],
  ['eng-42', ['ENG']],
  ['eng-1-and-ops-2', ['ENG', 'OPS']],
  ['main', []],
  ['', []],
  ['fix/utf8-support', []],
] as const

for (const [branch, expected] of branchCases) {
  test(`It returns ${JSON.stringify(expected)} from branchTicketPrefix for ${JSON.stringify(branch)}`, () => {
    expect(branchTicketPrefix(branch)).toEqual(expected)
  })
}

const ticketShapeCases = [
  ['look at ENG-12', true],
  ['UTF-8 handling', true],
  ['eng-12', true],
  ['no refs here', false],
  ['ENG-', false],
  ['-12', false],
  ['ENG12', false],
] as const

for (const [text, expected] of ticketShapeCases) {
  test(`It returns ${expected} from hasTicketShapedToken for ${JSON.stringify(text)}`, () => {
    expect(hasTicketShapedToken(text)).toBe(expected)
  })
}

const workRefCases = [
  ['fix ENG-12 today', ['ENG'], ['ENG-12']],
  ['fix eng-12 today', ['ENG'], ['ENG-12']],
  ['ENG-12 and ENG-12 again', ['ENG'], ['ENG-12']],
  ['ENG-12 then OPS-3', ['ENG', 'OPS'], ['ENG-12', 'OPS-3']],
  ['UTF-8 then UTF-16', [], []],
  ['SHA-256 of the file', ['ENG'], []],
  ['ENG-12 and UTF-8', ['ENG'], ['ENG-12']],
  ['see PR #12', [], ['#12']],
  ['see pr 12', [], ['#12']],
  ['see issue #7', [], ['#7']],
  ['see Issue 7', [], ['#7']],
  ['see pull request 31', [], ['#31']],
  ['see https://github.com/o/r/pull/45', [], ['#45']],
  ['see https://github.com/o/r/issues/46', [], ['#46']],
  ['bare #12 only', [], []],
  ['PR #12 and issue #12', [], ['#12']],
  ['prefix of 12', [], []],
  ['#12 in PR #13', [], ['#13']],
  ['PR#12', [], ['#12']],
  ['ABCDEFGHIJKL-5 is too long', ['ABCDEFGHIJKL'], []],
  ['no refs here', ['ENG'], []],
] as const

for (const [text, prefixes, expected] of workRefCases) {
  test(`It returns ${JSON.stringify(expected)} from workRefs for ${JSON.stringify(text)} under ${JSON.stringify(prefixes)}`, () => {
    expect(workRefs(text, prefixes)).toEqual(expected)
  })
}

const newWorkCases = [
  ['ENG-2 please', ['ENG-1'], ['ENG'], true],
  ['ENG-1 again', ['ENG-1'], ['ENG'], false],
  ['ENG-1 and ENG-2', ['ENG-1'], ['ENG'], false],
  ['ENG-2 and ENG-3', ['ENG-1'], ['ENG'], true],
  ['ENG-2 please', [], ['ENG'], false],
  ['no refs here', ['ENG-1'], ['ENG'], false],
  ['UTF-16 next', ['UTF-8'], [], false],
  ['PR #13 next', ['#12'], [], true],
  ['PR #12 again', ['#12'], [], false],
  ['PR #13 next', ['ENG-1'], ['ENG'], true],
  ['bare #13 next', ['#12'], [], false],
] as const

for (const [text, seen, prefixes, expected] of newWorkCases) {
  test(`It returns ${expected} from namesNewWork for ${JSON.stringify(text)} after ${JSON.stringify(seen)}`, () => {
    expect(namesNewWork(text, new Set(seen), prefixes)).toBe(expected)
  })
}

const classifyCases = [
  [{ contextTokens: 149_999, isStoppingPoint: true, isBackgroundBusy: false }, 'none'],
  [{ contextTokens: 150_000, isStoppingPoint: true, isBackgroundBusy: false }, 'strong'],
  [{ contextTokens: 200_000, isStoppingPoint: true, isBackgroundBusy: false }, 'strong'],
  [{ contextTokens: 200_000, isStoppingPoint: false, isBackgroundBusy: false }, 'weak'],
  [{ contextTokens: 200_000, isStoppingPoint: true, isBackgroundBusy: true }, 'weak'],
  [{ contextTokens: 200_000, isStoppingPoint: false, isBackgroundBusy: true }, 'weak'],
  [{ contextTokens: 100, isStoppingPoint: true, isBackgroundBusy: true }, 'none'],
] as const

for (const [input, expected] of classifyCases) {
  test(`It returns ${expected} from classify for ${JSON.stringify(input)}`, () => {
    expect(classify({ ...input, threshold: 150_000 })).toBe(expected)
  })
}

const respondCases = [
  [{ mode: 'off', signal: 'strong', stoppingPoint: 'finished-task' }, { kind: 'none' }],
  [{ mode: 'off', signal: 'weak', stoppingPoint: null }, { kind: 'none' }],
  [{ mode: 'ask', signal: 'none', stoppingPoint: null }, { kind: 'none' }],
  [{ mode: 'act', signal: 'none', stoppingPoint: 'finished-task' }, { kind: 'none' }],
  [
    { mode: 'ask', signal: 'strong', stoppingPoint: 'finished-task' },
    { kind: 'advise', holdsPrompt: false, buttons: ['handoff', 'not-now'] },
  ],
  [{ mode: 'act', signal: 'strong', stoppingPoint: 'finished-task' }, { kind: 'handoff', holdsPrompt: false }],
  [
    { mode: 'ask', signal: 'strong', stoppingPoint: 'new-work' },
    { kind: 'advise', holdsPrompt: true, buttons: ['handoff-send', 'send-here'] },
  ],
  [{ mode: 'act', signal: 'strong', stoppingPoint: 'new-work' }, { kind: 'handoff', holdsPrompt: true }],
  [
    { mode: 'ask', signal: 'weak', stoppingPoint: null, isBackgroundBusy: true },
    { kind: 'advise', holdsPrompt: false, buttons: ['compact', 'not-now'] },
  ],
  [{ mode: 'act', signal: 'weak', stoppingPoint: null, isBackgroundBusy: true }, { kind: 'compact' }],
  [
    { mode: 'ask', signal: 'weak', stoppingPoint: 'finished-task', isBackgroundBusy: true },
    { kind: 'advise', holdsPrompt: false, buttons: ['compact', 'not-now'] },
  ],
  [
    { mode: 'ask', signal: 'weak', stoppingPoint: null },
    { kind: 'advise', holdsPrompt: false, buttons: ['handoff', 'compact', 'not-now'] },
  ],
  [{ mode: 'act', signal: 'weak', stoppingPoint: null }, { kind: 'compact' }],
  [{ mode: 'ask', signal: 'strong', stoppingPoint: 'finished-task', isUnattended: true }, { kind: 'handoff', holdsPrompt: false }],
  [{ mode: 'act', signal: 'strong', stoppingPoint: 'new-work', isUnattended: true }, { kind: 'handoff', holdsPrompt: true }],
  [{ mode: 'off', signal: 'strong', stoppingPoint: 'new-work', isUnattended: true }, { kind: 'none' }],
  [{ mode: 'ask', signal: 'weak', stoppingPoint: null, isUnattended: true }, { kind: 'none' }],
  [{ mode: 'act', signal: 'weak', stoppingPoint: null, isUnattended: true }, { kind: 'none' }],
] as const

for (const [input, expected] of respondCases) {
  test(`It returns ${JSON.stringify(expected)} from respond for ${JSON.stringify(input)}`, () => {
    expect(respond({ isBackgroundBusy: false, isUnattended: false, ...input })).toEqual(expected)
  })
}
