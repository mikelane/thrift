import { bash, completeTurn, growTo200k, mountBand } from './helpers'

export const ASK = { options: { handoffMode: 'ask' } } as const

export const bandAfterFinishedTask = async ($: Parameters<typeof mountBand>[0], world: Parameters<typeof growTo200k>[1]) => {
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  return mountBand($)
}

export const weakBand = async ($: Parameters<typeof mountBand>[0], world: Parameters<typeof growTo200k>[1]) => {
  await growTo200k($, world)
  await completeTurn($)
  return mountBand($)
}

export const buttonLabels = async (band: Awaited<ReturnType<typeof mountBand>>) =>
  (await band.findAll({ type: 'Button' })).map(button => button.props.label)

export const clears = (world: Parameters<typeof growTo200k>[1]) => world.effects.filter(effect => effect === 'clear')

export const BUSY_REFUSAL = 'Background work is running, and a handoff would cut it off. This session is unchanged. Type /handoff to hand off anyway.'
