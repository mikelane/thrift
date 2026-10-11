import type { Carried } from './handoff-note'

export type GroupDelivery = Carried | 'none'

// The summary names the group that fared worst.
const FROM_WORST_TO_BEST: readonly Carried[] = ['not_carried', 'in_box', 'submitted']

export const summarizeDelivery = (outcomes: readonly Carried[]): GroupDelivery =>
  FROM_WORST_TO_BEST.find(outcome => outcomes.includes(outcome)) ?? 'none'
