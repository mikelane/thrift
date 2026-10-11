import { expect, test } from 'claude-code/testing'

import { branchTicketPrefixes, hasTicketShapedToken, namesNewWork, ticketUrlPrefixes, workRefs } from '../hooks/work-refs'

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
  test(`It returns ${JSON.stringify(expected)} from branchTicketPrefixes for ${JSON.stringify(branch)}`, () => {
    expect(branchTicketPrefixes(branch)).toEqual(expected)
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
