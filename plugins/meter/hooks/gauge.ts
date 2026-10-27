export const GAUGE_WIDTH = 25

const HALVES_PER_CELL = 2
const FULL_CELL = '█'
const HALF_CELL = '▌'
const TRACK_CELL = '░'
const MARKER_CELL = '│'

export type GaugeOptions = {
  // Where the pace marker sits, as a share of the window that has elapsed.
  markerShare?: number
  // Least half-cells to fill; the context gauge asks for 1 so any usage shows.
  minimumHalfCells?: number
}

const clampShare = (share: number): number => Math.min(1, Math.max(0, share))

export const fillHalfCells = (share: number, minimumHalfCells = 0): number =>
  Math.max(minimumHalfCells, Math.round(GAUGE_WIDTH * HALVES_PER_CELL * clampShare(share)))

export const markerIndex = (elapsedShare: number): number => Math.min(GAUGE_WIDTH - 1, Math.round(GAUGE_WIDTH * clampShare(elapsedShare)))

export const gaugeFor = (share: number, { markerShare, minimumHalfCells }: GaugeOptions = {}): string => {
  const halves = fillHalfCells(share, minimumHalfCells)
  const fill = FULL_CELL.repeat(Math.floor(halves / HALVES_PER_CELL)) + (halves % HALVES_PER_CELL === 1 ? HALF_CELL : '')
  const cells = [...fill.padEnd(GAUGE_WIDTH, TRACK_CELL)]
  if (markerShare !== undefined) cells[markerIndex(markerShare)] = MARKER_CELL
  return cells.join('')
}
