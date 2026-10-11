import { describe, expect, test } from 'claude-code/testing'

import type { Carried } from '../hooks/handoff-note'
import { worstDelivery, type GroupDelivery } from '../hooks/held-delivery'

const cases: ReadonlyArray<{ name: string; outcomes: Carried[]; expected: GroupDelivery }> = [
  { name: 'no group was sent', outcomes: [], expected: 'none' },
  { name: 'the only group was submitted', outcomes: ['submitted'], expected: 'submitted' },
  { name: 'the only group was left in the box', outcomes: ['in_box'], expected: 'in_box' },
  { name: 'the only group was not carried', outcomes: ['not_carried'], expected: 'not_carried' },
  { name: 'both groups were submitted', outcomes: ['submitted', 'submitted'], expected: 'submitted' },
  { name: 'both groups were left in the box', outcomes: ['in_box', 'in_box'], expected: 'in_box' },
  { name: 'both groups were not carried', outcomes: ['not_carried', 'not_carried'], expected: 'not_carried' },
  { name: 'one group was submitted and one left in the box', outcomes: ['submitted', 'in_box'], expected: 'in_box' },
  { name: 'one group was left in the box and one submitted', outcomes: ['in_box', 'submitted'], expected: 'in_box' },
  { name: 'one group was submitted and one not carried', outcomes: ['submitted', 'not_carried'], expected: 'not_carried' },
  { name: 'one group was not carried and one left in the box', outcomes: ['not_carried', 'in_box'], expected: 'not_carried' },
]

describe('worstDelivery', () => {
  for (const { name, outcomes, expected } of cases) {
    test(`It returns ${expected} when ${name}`, () => {
      expect(worstDelivery(outcomes)).toBe(expected)
    })
  }
})
