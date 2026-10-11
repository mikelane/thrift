import type { Carried } from './handoff-note'

export type GroupDelivery = Carried | 'none'

// Worst first, so the first entry that any group had is the worst outcome among the groups.
const FROM_WORST_TO_BEST = ['not_carried', 'in_box', 'submitted'] as const satisfies readonly Carried[]

type MustBeTrue<Condition extends true> = Condition

// Fails to compile when Carried gains an outcome the order above leaves out.
export type RanksEveryOutcome = MustBeTrue<[Exclude<Carried, (typeof FROM_WORST_TO_BEST)[number]>] extends [never] ? true : false>

export const worstDelivery = (outcomes: readonly Carried[]): GroupDelivery =>
  FROM_WORST_TO_BEST.find(outcome => outcomes.includes(outcome)) ?? 'none'
