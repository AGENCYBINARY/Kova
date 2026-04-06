/**
 * Map natural language day + clock (wall time in a user timezone) to UTC Date range for Calendar API.
 * Default timezone matches product defaults (Europe/Paris).
 */

const DEFAULT_TZ = 'Europe/Paris'

function normalizeSchedulingInput(input: string) {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

const weekdayToNumber: Record<string, number> = {
  dimanche: 0,
  lundi: 1,
  mardi: 2,
  mercredi: 3,
  jeudi: 4,
  vendredi: 5,
  samedi: 6,
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

function shortWeekdayNumberInTimeZone(isoInstant: Date, timeZone: string): number {
  const short = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(isoInstant)
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[short] ?? 0
}

export function calendarPartsInTimeZone(isoInstant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(isoInstant)
  const get = (type: string) => parts.find((p) => p.type === type)?.value
  return {
    year: Number.parseInt(get('year') || '0', 10),
    month: Number.parseInt(get('month') || '0', 10),
    day: Number.parseInt(get('day') || '0', 10),
  }
}

function calendarDateKey(parts: { year: number; month: number; day: number }) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function isCalendarDateAfter(
  left: { year: number; month: number; day: number },
  right: { year: number; month: number; day: number }
) {
  return calendarDateKey(left) > calendarDateKey(right)
}

/**
 * Next calendar date (in `timeZone`) strictly after (y, m, d).
 */
function nextCalendarDateParts(y: number, m: number, day: number, timeZone: string) {
  let t = utcInstantForWallClock(y, m, day, 12, 0, timeZone)
  const startKey = calendarDateKey({ year: y, month: m, day })
  for (let i = 0; i < 40; i++) {
    t = new Date(t.getTime() + 6 * 3600000)
    const p = calendarPartsInTimeZone(t, timeZone)
    if (calendarDateKey(p) > startKey) {
      return p
    }
  }
  return calendarPartsInTimeZone(new Date(t.getTime() + 86400000), timeZone)
}

/**
 * Find UTC instant that displays as (year, month, day, hour, minute) in `timeZone`.
 */
export function utcInstantForWallClock(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  let ms = Date.UTC(year, month - 1, day, hour, minute, 0)
  for (let i = 0; i < 36; i++) {
    const t = new Date(ms)
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(t)
    const g: Record<string, number> = {}
    for (const p of parts) {
      if (p.type === 'year') g.year = Number.parseInt(p.value, 10)
      if (p.type === 'month') g.month = Number.parseInt(p.value, 10)
      if (p.type === 'day') g.day = Number.parseInt(p.value, 10)
      if (p.type === 'hour') g.hour = Number.parseInt(p.value, 10)
      if (p.type === 'minute') g.minute = Number.parseInt(p.value, 10)
    }
    if (g.year === year && g.month === month && g.day === day && g.hour === hour && g.minute === minute) {
      return t
    }
    const dh = hour - (g.hour ?? 0)
    const dm = minute - (g.minute ?? 0)
    ms += (dh * 60 + dm) * 60 * 1000
  }
  return new Date(ms)
}

export function inferCalendarRangeFromUserText(
  input: string,
  durationMinutes: number,
  options: { timeZone?: string; now?: Date } = {}
): { start: Date; end: Date } | null {
  const timeZone = options.timeZone || DEFAULT_TZ
  const now = options.now ?? new Date()
  const n = normalizeSchedulingInput(input)

  const hasWeekday = Object.keys(weekdayToNumber).some((w) => new RegExp(`\\b${w}\\b`).test(n))
  const hasDemain = /\b(demain|tomorrow)\b/.test(n)
  if (!hasWeekday && !hasDemain) {
    return null
  }

  const hm = n.match(/\b(\d{1,2})\s*h(?:eures?)?\b/)
  const colon = n.match(/\b(\d{1,2}):(\d{2})\b/)
  if (!hm && !colon) {
    return null
  }

  let hour = hm ? Number.parseInt(hm[1], 10) : Number.parseInt(colon![1], 10)
  let minute = colon ? Number.parseInt(colon[2], 10) : 0
  hour = Math.min(23, Math.max(0, hour))
  minute = Math.min(59, Math.max(0, minute))

  let targetDow: number | undefined
  for (const [word, dow] of Object.entries(weekdayToNumber)) {
    if (new RegExp(`\\b${word}\\b`).test(n)) {
      targetDow = dow
      break
    }
  }

  const todayParts = calendarPartsInTimeZone(now, timeZone)
  let y = todayParts.year
  let m = todayParts.month
  let d = todayParts.day

  for (let step = 0; step < 28; step++) {
    const midday = utcInstantForWallClock(y, m, d, 12, 0, timeZone)
    const wdHere = shortWeekdayNumberInTimeZone(midday, timeZone)
    const partsHere = { year: y, month: m, day: d }

    let dayOk = true
    if (targetDow !== undefined && wdHere !== targetDow) {
      dayOk = false
    }
    if (hasDemain && !hasWeekday) {
      if (!isCalendarDateAfter(partsHere, todayParts)) {
        dayOk = false
      }
    }

    if (dayOk) {
      const start = utcInstantForWallClock(y, m, d, hour, minute, timeZone)
      if (start.getTime() > now.getTime()) {
        const end = new Date(start.getTime() + durationMinutes * 60 * 1000)
        return { start, end }
      }
    }

    const next = nextCalendarDateParts(y, m, d, timeZone)
    y = next.year
    m = next.month
    d = next.day
  }

  return null
}
