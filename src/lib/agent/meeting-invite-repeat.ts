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
    /\b(invitation|invite|inviter|rdv|réunion|reunion|agenda|calendrier|evenement|événement|mail|email|courriel|meet|visio|google meet)\b/i.test(
      text
    )
  return repeatCue && meetingCue
}

function looksLikePriorBundledMeetingEmailRequest(text: string): boolean {
  const n = normalizeSchedulingInput(text)
  const mail = /\b(mail|email|courriel|gmail)\b/.test(n)
  const meet =
    /\b(réunion|reunion|rdv|invitation|calendrier|agenda|mardi|lundi|mercredi|jeudi|vendredi|samedi|dimanche|demain|\d{1,2}\s*h)\b/.test(
      n
    )
  const action =
    /\b(trouve|trouver|cherche|chercher|rédige|redige|rediger|ecris|écris|ecrire|écrire|envoyer|envoie|ecrit|écrit)\b/.test(n)
  return mail && meet && action
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
    return `Write me an email to ${recipient}, find their address in Gmail, and draft a message in the same vein as before — ${schedBit}, ${topic}. Prepare the calendar invite with Google Meet and the follow-up email with the link.`
  }
  const schedBit = sched ? `prévue ${sched}` : 'aux mêmes horaires que tout à l’heure'
  return `Écris-moi un mail à ${recipient}, trouve son adresse dans Gmail, et rédige un message sur le même modèle qu’avant — réunion ${schedBit}, ${topic}. Prépare l’invitation agenda avec Google Meet et l’email avec le lien.`
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
