/**
 * Detects contradictory calendar phrasing like "demain vendredi" when tomorrow
 * (calendar day in Europe/Paris) is not that weekday.
 */

function normalizeAgentInput(input: string) {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function normalizeWeekdayToken(token: string) {
  const t = token.toLowerCase()
  if (t === 'lundi' || t === 'monday') return 'mon'
  if (t === 'mardi' || t === 'tuesday') return 'tue'
  if (t === 'mercredi' || t === 'wednesday') return 'wed'
  if (t === 'jeudi' || t === 'thursday') return 'thu'
  if (t === 'vendredi' || t === 'friday') return 'fri'
  if (t === 'samedi' || t === 'saturday') return 'sat'
  if (t === 'dimanche' || t === 'sunday') return 'sun'
  return t
}

function extractWeekdayKeysFromNormalizedText(normalized: string) {
  return new Set(
    (normalized.match(
      /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g
    ) || []).map(normalizeWeekdayToken)
  )
}

function weekdayKeyFromParisDate(d: Date): 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' {
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Europe/Paris' })
    .format(d)
    .toLowerCase()
  if (weekday === 'monday') return 'mon'
  if (weekday === 'tuesday') return 'tue'
  if (weekday === 'wednesday') return 'wed'
  if (weekday === 'thursday') return 'thu'
  if (weekday === 'friday') return 'fri'
  if (weekday === 'saturday') return 'sat'
  return 'sun'
}

/** Next calendar day after "today" in Europe/Paris, as a Date at UTC noon of that civil Y-M-D. */
function parisTomorrowReferenceDate(now: Date) {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const [y, mo, da] = ymd.split('-').map((v) => Number.parseInt(v, 10))
  return new Date(Date.UTC(y, mo - 1, da + 1, 12, 0, 0))
}

/** @param referenceNow optional clock injection for tests (defaults to real now). */
export function inputHasDemainWeekdayConflict(input: string, referenceNow: Date = new Date()): boolean {
  const n = normalizeAgentInput(input)
  if (!/\b(demain|tomorrow)\b/.test(n)) {
    return false
  }
  const weekdays = extractWeekdayKeysFromNormalizedText(n)
  if (weekdays.size === 0) {
    return false
  }
  const tomorrowKey = weekdayKeyFromParisDate(parisTomorrowReferenceDate(referenceNow))
  if (weekdays.size === 1 && weekdays.has(tomorrowKey)) {
    return false
  }
  for (const w of Array.from(weekdays)) {
    if (w !== tomorrowKey) {
      return true
    }
  }
  return false
}

export function buildDemainWeekdayClarificationResponse(language: 'fr' | 'en') {
  return language === 'en'
    ? 'You mentioned both “tomorrow” and a weekday — that’s two different days. Which one should I use for the invite?'
    : 'Tu as indiqué à la fois « demain » et un jour de la semaine — ce n’est pas le même jour. Tu veux que je retienne lequel pour l’invitation ?'
}
