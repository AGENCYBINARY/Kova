import type { AssistantProfile } from '@/lib/assistant/profile'
import type { PendingActionRecord } from '@/lib/agent/chat-state'
import type { AgentProposal } from '@/lib/agent/v1'
import { buildMeetingEmailFollowupProposal } from '@/lib/agent/v1-deterministic'
import { deriveNameFromEmail, type KnownContact } from '@/lib/contacts'
import { isMeetingDeliveryRefinementIntent } from '@/lib/workspace-context/intents'

interface RecentActionCandidate {
  type: string
  title: string
  description: string
  parameters: Record<string, unknown>
}

function normalizeInput(input: string) {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function trimSentence(value: string) {
  return value
    .replace(/^[\s"'“”'`]+|[\s"'“”'`]+$/g, '')
    .replace(/[?.!]+$/g, '')
    .trim()
}

function extractCalendarMotif(input: string) {
  const quoted = input.match(/["“]([^"”]+)["”]/)
  if (quoted?.[1]?.trim()) {
    return trimSentence(quoted[1])
  }

  const patterns = [
    /motif\s*(?:c['’]est|est|=)?\s+(.+)$/i,
    /en disant que c['’]est\s+(.+)$/i,
    /en disant\s+(.+)$/i,
    /disant que\s+(.+)$/i,
  ]

  for (const pattern of patterns) {
    const match = input.match(pattern)
    if (match?.[1]?.trim()) {
      return trimSentence(match[1])
    }
  }

  return null
}

function formatCalendarTitle(rawTitle: string) {
  const cleaned = trimSentence(rawTitle).replace(/^(?:une|un|the|a|an)\s+/i, '')
  if (!cleaned) {
    return 'Rendez-vous'
  }

  const first = cleaned.charAt(0)
  return `${first.toUpperCase()}${cleaned.slice(1)}`
}

function requestNeedsMeetLink(input: string) {
  const normalized = normalizeInput(input)
  const explicitlyNoMeet =
    /\b(sans|without|no|pas de|aucun)\s+(google meet|meet|visio|visioconference|video|zoom|teams|call)\b/.test(normalized) ||
    /\b(google meet|meet|visio|visioconference|video|zoom|teams|call)\b.*\b(sans|without|no|off|disabled)\b/.test(normalized)

  if (explicitlyNoMeet) {
    return false
  }

  return /(google meet|meet|visio|visioconference|visioconférence|video|vidéo|remote|zoom|teams|call|réunion|reunion|rendez-vous|rendezvous|\brdv\b|\bpoint\b|atelier|workshop|kickoff|\bsync\b)/.test(
    normalized
  )
}

function looksLikeCalendarRedoRequest(input: string) {
  const normalized = normalizeInput(input)
  const hasRedoMarker =
    /\b(refais|refaire|refait|recree|recreer|recr[eé]e|fais[- ]en un autre|fait en un autre|un autre|autre evenement|autre rendez vous|autre rdv)\b/.test(
      normalized
    )
  const hasCalendarContext =
    /\b(calendar|calendrier|evenement|événement|rendez vous|rendez-vous|rdv|meeting|meet|google meet|visio|invite)\b/.test(
      normalized
    )

  return (
    hasRedoMarker ||
    (hasCalendarContext && Boolean(extractCalendarMotif(input)))
  )
}

export function buildCalendarRedoFollowUp(params: {
  input: string
  recentActions: RecentActionCandidate[]
  language?: 'fr' | 'en'
}): { response: string; proposals: AgentProposal[] } | null {
  if (!looksLikeCalendarRedoRequest(params.input)) {
    return null
  }

  const latestCalendarAction = params.recentActions.find((action) => action.type === 'create_calendar_event')
  if (!latestCalendarAction) {
    return null
  }

  const previousTitle =
    typeof latestCalendarAction.parameters.title === 'string' && latestCalendarAction.parameters.title.trim()
      ? latestCalendarAction.parameters.title.trim()
      : 'Rendez-vous'
  const motif = extractCalendarMotif(params.input)
  const title = formatCalendarTitle(motif || previousTitle)
  const attendees = Array.isArray(latestCalendarAction.parameters.attendees)
    ? latestCalendarAction.parameters.attendees.filter((value): value is string => typeof value === 'string')
    : []
  const startTime =
    typeof latestCalendarAction.parameters.startTime === 'string'
      ? latestCalendarAction.parameters.startTime
      : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const endTime =
    typeof latestCalendarAction.parameters.endTime === 'string'
      ? latestCalendarAction.parameters.endTime
      : new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString()
  const language = params.language || 'fr'

  return {
    response:
      language === 'en'
        ? `I prepared a new version: "${title}".`
        : `Je t’en ai préparé un autre : "${title}".`,
    proposals: [
      {
        type: 'create_calendar_event',
        title:
          attendees.length > 0
            ? `Create meeting invite for ${title}`
            : 'Create calendar event',
        description: 'Create a Google Calendar invite with the updated title and scheduling details.',
        parameters: {
          ...latestCalendarAction.parameters,
          title,
          startTime,
          endTime,
          attendees,
          createMeetLink: requestNeedsMeetLink(params.input)
            ? true
            : /\b(sans|without|no|pas de|aucun)\s+(google meet|meet|visio|visioconference|video|zoom|teams|call)\b/i.test(params.input)
              ? false
              : Boolean(latestCalendarAction.parameters.createMeetLink),
        },
        confidenceScore: 0.9,
      },
    ],
  }
}

const MEET_PLACEHOLDER_RE = /\{\{\s*meet_?link\s*\}\}/i

function looksLikeMetaInstructionEmailBody(body: string) {
  const n = normalizeInput(body)
  if (body.length > 1600) {
    return false
  }
  return /\b(je te demande|tu peux mettre|mettre un liens?|mets un liens?|dans le mail que je vais envoyer)\b/.test(n)
}

function looksCorruptedEmailSubject(subject: string) {
  const n = normalizeInput(subject)
  return /\b(je te demande|tu peux mettre|mettre un liens?)\b/.test(n)
}

function contactFromPendingEmail(mail: PendingActionRecord): KnownContact | null {
  const to = mail.parameters.to
  if (!Array.isArray(to) || typeof to[0] !== 'string' || !to[0].includes('@')) {
    return null
  }
  const email = to[0].trim().toLowerCase()
  const resolved =
    typeof mail.parameters.resolvedContactName === 'string' && mail.parameters.resolvedContactName.trim()
      ? mail.parameters.resolvedContactName.trim()
      : deriveNameFromEmail(email) || email.split('@')[0] || 'there'
  return { name: resolved, email, aliases: [] }
}

function findAnchorMeetingUserContent(history: Array<{ role: string; content: string }>) {
  const userLines = history
    .filter((m) => m.role === 'user')
    .map((m) => m.content.trim())
    .filter(Boolean)
  const scored = userLines.filter((c) =>
    /reunion|réunion|calendrier|rdv|meet|mardi|mercredi|objectif|agence|invite|evenement|visio|19h|18h|15h/i.test(c)
  )
  if (scored.length === 0) {
    return userLines[userLines.length - 1] || ''
  }
  return scored.sort((a, b) => b.length - a.length)[0]
}

function pickCalendarAndMailFromPending(pending: PendingActionRecord[]) {
  const cals = pending.filter((a) => a.type === 'create_calendar_event')
  const mails = pending.filter((a) => a.type === 'send_email' || a.type === 'create_gmail_draft')

  for (const cal of cals) {
    const gid = cal.parameters.requestGroupId
    if (typeof gid === 'string') {
      const mail = mails.find((m) => m.parameters.requestGroupId === gid)
      if (mail) {
        return { calendar: cal, mail }
      }
    }
  }

  const calendar = cals[0]
  const mail = mails[0]
  if (calendar && mail) {
    return { calendar, mail }
  }
  if (calendar) {
    return { calendar, mail: undefined }
  }
  if (mail) {
    return { calendar: undefined, mail }
  }
  return null
}

function stripPersistOnlyParameterKeys(params: Record<string, unknown>) {
  const next = { ...params }
  delete next.confidenceScore
  delete next.proposalIndex
  delete next.requestGroupId
  return next
}

/**
 * When the user refines "add Meet / put the link in the mail" on an existing pending bundle,
 * rebuild calendar+email coherently instead of treating the message as a new literal email body.
 */
export function buildMeetingBundleRefinementFollowUp(params: {
  input: string
  pendingActions: PendingActionRecord[]
  conversationHistory: Array<{ role: string; content: string }>
  assistantProfile?: AssistantProfile
}): { response: string; proposals: AgentProposal[]; supersedeActionIds: string[] } | null {
  if (!isMeetingDeliveryRefinementIntent(params.input)) {
    return null
  }

  const picked = pickCalendarAndMailFromPending(params.pendingActions)
  if (!picked || (!picked.calendar && !picked.mail)) {
    return null
  }

  const lang = params.assistantProfile?.defaultLanguage === 'en' ? 'en' : 'fr'
  const supersedeActionIds: string[] = []
  const anchor = findAnchorMeetingUserContent(params.conversationHistory)

  if (picked.calendar && picked.mail) {
    supersedeActionIds.push(picked.calendar.id, picked.mail.id)
    const contact = contactFromPendingEmail(picked.mail)
    const calParams = stripPersistOnlyParameterKeys(picked.calendar.parameters)
    calParams.createMeetLink = true

    const body = typeof picked.mail.parameters.body === 'string' ? picked.mail.parameters.body : ''
    const subject = typeof picked.mail.parameters.subject === 'string' ? picked.mail.parameters.subject : ''
    const rebuiltTemplate = buildMeetingEmailFollowupProposal(anchor || params.input, contact, params.assistantProfile)
    const rebuiltSubject =
      typeof rebuiltTemplate.parameters.subject === 'string' ? rebuiltTemplate.parameters.subject : undefined

    const shouldRebuildEmail =
      looksLikeMetaInstructionEmailBody(body) ||
      looksCorruptedEmailSubject(subject) ||
      (!MEET_PLACEHOLDER_RE.test(body) && /meet|visio|lien/i.test(normalizeInput(params.input)))

    const mailType = picked.mail.type as AgentProposal['type']
    let emailProposal: AgentProposal

    if (shouldRebuildEmail) {
      emailProposal = {
        ...rebuiltTemplate,
        type: mailType,
        title: picked.mail.title,
        description: picked.mail.description,
      }
    } else {
      emailProposal = {
        type: mailType,
        title: picked.mail.title,
        description: picked.mail.description,
        parameters: {
          ...stripPersistOnlyParameterKeys(picked.mail.parameters),
          body: MEET_PLACEHOLDER_RE.test(body)
            ? body
            : [body.trim(), '', lang === 'en' ? 'Google Meet link:' : 'Lien Google Meet :', '{{meet_link}}'].join('\n'),
          subject: looksCorruptedEmailSubject(subject) && rebuiltSubject ? rebuiltSubject : subject,
        },
        confidenceScore: 0.94,
      }
    }

    const calendarProposal: AgentProposal = {
      type: 'create_calendar_event',
      title: picked.calendar.title,
      description: picked.calendar.description,
      parameters: calParams,
      confidenceScore: 0.92,
    }

    return {
      response:
        lang === 'en'
          ? 'Updated the calendar invite with Google Meet on, and fixed the email so the real Meet URL is injected automatically right after the event is created ({{meet_link}} is replaced at execution). Approve in order: calendar first, then email.'
          : 'J’ai mis à jour l’invitation agenda avec Google Meet activé, et corrigé le mail : le vrai lien sera inséré automatiquement juste après la création de l’événement (le {{meet_link}} est remplacé à l’exécution). Valide dans l’ordre : agenda d’abord, puis email.',
      proposals: [calendarProposal, emailProposal],
      supersedeActionIds,
    }
  }

  if (picked.calendar) {
    supersedeActionIds.push(picked.calendar.id)
    const calParams = stripPersistOnlyParameterKeys(picked.calendar.parameters)
    calParams.createMeetLink = true
    return {
      response:
        lang === 'en'
          ? 'Turned on Google Meet for this pending invite. Approve when ready.'
          : 'J’ai activé Google Meet sur l’invitation en attente. Tu peux valider.',
      proposals: [
        {
          type: 'create_calendar_event',
          title: picked.calendar.title,
          description: picked.calendar.description,
          parameters: calParams,
          confidenceScore: 0.92,
        },
      ],
      supersedeActionIds,
    }
  }

  return null
}
