const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

const roundToMinute = (time: number): number => Math.floor((time + MINUTE_MS / 2) / MINUTE_MS) * MINUTE_MS

const localDay = (time: number, utcOffsetMinutes: number): number =>
  Math.floor((time + utcOffsetMinutes * MINUTE_MS) / DAY_MS)

const hourAndMinute = (localDate: Date): string => {
  const hour = localDate.getUTCHours() % 12 || 12
  const minute = String(localDate.getUTCMinutes()).padStart(2, '0')
  return `${hour}:${minute}${localDate.getUTCHours() < 12 ? 'am' : 'pm'}`
}

export const clockLabel = (target: number, now: number, utcOffsetMinutes: number): string => {
  const rounded = roundToMinute(target)
  const localDate = new Date(rounded + utcOffsetMinutes * MINUTE_MS)
  const time = hourAndMinute(localDate)
  if (localDay(rounded, utcOffsetMinutes) === localDay(now, utcOffsetMinutes)) return time
  return `${DAY_NAMES[localDate.getUTCDay()]} ${time}`
}
