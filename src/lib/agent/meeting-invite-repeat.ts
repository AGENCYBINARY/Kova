/**
 * Short follow-ups like "même invitation pour Maxime" don't match deterministic intents alone.
 * We replay the prior full meeting+email request with the new recipient when history supports it.
 */

import {
  extractGmailLookupNameQuery,
  extractRecipientName,
  extractStrictGmailAddressLookupName,
  extractRecipientFromSameInviteFollowUp,
} from '@/lib/contacts-utils'

type ChatLine = { role: string; content: string }

function normalizeSchedulingInput(input: string) {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function looksLikeRepeatMeetingInviteBundle(text: string): boolean {
  const n = normalizeSchedulingInput(text)
  const repeatCue =
    /\b(pareil|pareille|meme|memes|même|mêmes|identique|exactement|refais|refaire|dupliquer|duplicate|same|again|encore une fois|une autre pour|autre invite|autre invitation)\b/.test(
      n
    )
  const meetingCue =
    /\b(invitation|invite|inviter|rdv|réunion|reunion|meeting|agenda|calendrier|evenement|événement|mail|email|courriel|meet|visio|google meet)\b/i.test(
      text
    )
  return repeatCue && meetingCue
}

function looksLikePriorBundledMeetingEmailRequest(text: string): boolean {
  const n = normalizeSchedulingInput(text)
  const mail = /\b(mail|email|courriel|gmail)\b/.test(n)
  const meet =
    /\b(réunion|reunion|meeting|rdv|invitation|calendrier|agenda|mardi|lundi|mercredi|jeudi|vendredi|samedi|dimanche|demain|\d{1,2}\s*h)\b/.test(
      n
    )
  const action =
    /\b(trouve|trouver|cherche|chercher|rédige|redige|rediger|ecris|écris|ecrire|écrire|envoyer|envoie|ecrit|écrit|aide|aider)\b/.test(
      n
    )
  return mail && meet && action
}

/** Softer match: user asked for help drafting an invite / meeting mail (wording that may omit "trouve/trouver"). */
function looksLikePriorEmailMeetingComposition(text: string): boolean {
  const n = normalizeSchedulingInput(text)
  const mailish = /\b(mail|email|courriel|gmail)\b/.test(n)
  const topic =
    /\b(invitation|invite|inviter|reunion|réunion|rdv|meeting|collegue|collaborateur|visio|agenda|calendrier)\b/.test(n)
  const compose =
    /\b(redige|rediger|ecrir|ecrire|aide|aider|prepar|propose|suggere|ecrit)\b/.test(n)
  return mailish && topic && compose
}

function findPriorEmailMeetingCompositionUserTurn(previousMessages: ChatLine[], currentContent: string): string | null {
  const trimmedCurrent = currentContent.trim()
  for (let i = previousMessages.length - 1; i >= 0; i--) {
    const line = previousMessages[i]
    if (line.role !== 'user') continue
    const t = line.content.trim()
    if (!t || t === trimmedCurrent) continue
    if (looksLikePriorEmailMeetingComposition(t)) {
      return line.content
    }
  }
  return null
}

function hasExplicitCalendarDateText(n: string): boolean {
  return (
    /\b(demain|tomorrow|aujourd'hui|aujourdhui|today|ce soir|ce matin|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(
      n
    ) || /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(n)
  )
}

function hasExplicitCalendarTimeText(n: string): boolean {
  return (
    /\b\d{1,2}\s*(?:h|heure|heures)\b/.test(n) ||
    /\b\d{1,2}:\d{2}\b/.test(n) ||
    /\b(midi|minuit|noon|midnight)\b/.test(n)
  )
}

/**
 * Short reply that only adds scheduling (e.g. "oui mardi à 19h pendant 1h") — no standalone app intent.
 */
export function looksLikeSchedulingSlotReplyOnly(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 140) return false
  const n = normalizeSchedulingInput(trimmed)
  if (!hasExplicitCalendarDateText(n) || !hasExplicitCalendarTimeText(n)) return false
  if (/\b(envoie un mail|send email|creer un evenement|create event|nouveau doc|google drive)\b/.test(n)) {
    return false
  }
  return true
}

function assistantLastTurnAskedForWhenOrSchedule(previousMessages: ChatLine[]): boolean {
  if (previousMessages.length === 0) return false
  const last = previousMessages[previousMessages.length - 1]
  if (last.role !== 'assistant') return false
  const c = last.content
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  const fr =
    (/\b(il me manque|il manque|j'ai besoin|besoin de|precise|précise|donne moi|donne-moi)\b/.test(c) &&
      /\b(date|heure|horaire|moment|quand|jour)\b/.test(c)) ||
    /\b(quelle|quel)\s+(date|heure|jour|moment|horaire)\b/.test(c) ||
    /\b(date et l'heure|date et heure|heure exacte|horaire exact|moment exact)\b/.test(c) ||
    /\b(precise|précise)\b.*\b(jour|heure|date)\b/.test(c)
  const en =
    (/\b(missing|still need|need)\b/.test(c) && /\b(date|time|when|schedule)\b/.test(c)) ||
    /\bwhat (day|time|date)\b/.test(c) ||
    /\bwhen (should|would|are you|do you want)\b/.test(c)
  return Boolean(fr || en)
}

function findPriorMeetingRelatedUserTurn(previousMessages: ChatLine[], currentContent: string): string | null {
  return (
    findPriorBundledMeetingEmailUserTurn(previousMessages, currentContent) ||
    findPriorEmailMeetingCompositionUserTurn(previousMessages, currentContent)
  )
}

/**
 * When the user only answers with day/time after the assistant asked for it, merge with the prior
 * meeting+mail request so routing does not fall through to the generic "pick an app" template.
 */
export function augmentContentForMeetingScheduleFollowUp(params: {
  content: string
  previousMessages: ChatLine[]
}): string {
  const trimmed = params.content.trim()
  if (!trimmed) {
    return params.content
  }
  if (!looksLikeSchedulingSlotReplyOnly(trimmed)) {
    return params.content
  }
  if (!assistantLastTurnAskedForWhenOrSchedule(params.previousMessages)) {
    return params.content
  }
  const prior = findPriorMeetingRelatedUserTurn(params.previousMessages, trimmed)
  if (!prior) {
    return params.content
  }
  return `${prior} ${trimmed}`.trim()
}

function findPriorBundledMeetingEmailUserTurn(previousMessages: ChatLine[], currentContent: string): string | null {
  const trimmedCurrent = currentContent.trim()
  for (let i = previousMessages.length - 1; i >= 0; i--) {
    const line = previousMessages[i]
    if (line.role !== 'user') continue
    const t = line.content.trim()
    if (!t || t === trimmedCurrent) continue
    if (looksLikePriorBundledMeetingEmailRequest(t)) {
      return line.content
    }
  }
  return null
}

function extractRoughSchedulePhrase(prior: string): string | null {
  const compact = prior.replace(/\s+/g, ' ')
  const weekdayBlock = compact.match(
    /\b(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain)\b[^.!?\n]{0,100}?\d{1,2}\s*h(?:eures?)?(?:\d{2})?\b/i
  )
  if (weekdayBlock) {
    return weekdayBlock[0].trim()
  }
  const hm = compact.match(/\b\d{1,2}\s*h(?:eures?)?(?:\d{2})?\b/i)
  return hm ? hm[0].trim() : null
}

function topicTailForRepeat(prior: string, lang: 'fr' | 'en'): string {
  if (/objectif.*agence|agence.*objectif/i.test(prior)) {
    return lang === 'en' ? 'for our agency objectives' : "pour les objectifs de l'agence"
  }
  if (/\bpoint\b|sync|hebdo/i.test(prior)) {
    return lang === 'en' ? 'for the same sync as before' : 'pour le même type de point qu’avant'
  }
  return lang === 'en' ? 'with the same intent as the previous request' : 'sur le même objectif que la demande précédente'
}

export function composeBundledMeetingRequestFromPrior(
  priorUserMessage: string,
  recipient: string,
  lang: 'fr' | 'en'
): string {
  const sched = extractRoughSchedulePhrase(priorUserMessage)
  const topic = topicTailForRepeat(priorUserMessage, lang)
  if (lang === 'en') {
    const schedBit = sched ? `scheduled ${sched}` : 'at the same time as before'
    return `Prepare a Google Calendar invite for ${recipient}, find their address in Gmail, keep the same schedule and objective as the previous request — ${schedBit}, ${topic} — add Google Meet, and prepare the follow-up email with the same link.`
  }
  const schedBit = sched ? `prévue ${sched}` : 'aux mêmes horaires que tout à l’heure'
  return `Prépare une invitation Google Calendar pour ${recipient}, retrouve son adresse dans Gmail, garde le même créneau et le même objectif que la demande précédente — réunion ${schedBit}, ${topic} — ajoute Google Meet et prépare aussi l’email de confirmation avec le lien.`
}

function resolveRepeatRecipient(trimmed: string): string | null {
  return (
    extractRecipientFromSameInviteFollowUp(trimmed) ||
    extractRecipientName(trimmed) ||
    extractStrictGmailAddressLookupName(trimmed) ||
    extractGmailLookupNameQuery(trimmed)
  )
}

/**
 * If this is a "same invite for X" follow-up, expand into a full executable request using the last similar user turn.
 * The original user message is still stored in chat; only agent routing uses the expanded text.
 */
export function augmentContentForMeetingInviteRepeat(params: {
  content: string
  previousMessages: ChatLine[]
  defaultLanguage?: 'fr' | 'en'
}): string {
  const trimmed = params.content.trim()
  if (!trimmed) {
    return params.content
  }
  if (!looksLikeRepeatMeetingInviteBundle(trimmed)) {
    return params.content
  }
  const recipient = resolveRepeatRecipient(trimmed)
  if (!recipient) {
    return params.content
  }
  const prior = findPriorBundledMeetingEmailUserTurn(params.previousMessages, trimmed)
  if (!prior) {
    return params.content
  }
  return composeBundledMeetingRequestFromPrior(prior, recipient, params.defaultLanguage || 'fr')
}
