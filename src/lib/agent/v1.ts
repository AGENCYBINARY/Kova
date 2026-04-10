import { analyzeUserRequest, isLowValueAssistantResponse, isOpenAiConfigured } from '@/lib/ai/client'
import { synthesizeDeterministicAssistantNarration } from '@/lib/ai/narration'
import {
  executiveAssistantSkills,
  resolveEnabledAssistantSkills,
  type AssistantProfile,
} from '@/lib/assistant/profile'
import { prepareActionParameters } from '@/lib/agent/data-prep'
import { stripConversationalLeadIn } from '@/lib/agent/input-normalization'
import {
  agentActionTypeSchema,
  buildCapabilityResponse,
  buildConversationalResponse,
  buildDisambiguationResponse,
  buildFallbackResponseWithContactsAndProfile,
  isCapabilityQuestion,
  isConversationalInput,
  isEmailCompositionAssistanceRequest,
  isSimpleGreetingInput,
  type AgentActionType,
  type AgentProposal,
  type AgentTurnResult,
} from '@/lib/agent/v1-deterministic'
import { buildPlanBackedNarration, type AgentPlanStep } from '@/lib/agent/planning'
import { resolveActionReferencesDetailed } from '@/lib/agent/reference-resolution'
import {
  extractEmailAddresses,
  extractGmailLookupNameQuery,
  extractRecipientName,
  findContactByName,
  type KnownContact,
} from '@/lib/contacts'
import { getToolByActionType, listMcpTools } from '@/lib/mcp/registry'
import { canInferCalendarRangeFromUserText } from '@/lib/scheduling/user-schedule'
import {
  buildDemainWeekdayClarificationResponse,
  inputHasDemainWeekdayConflict,
} from '@/lib/agent/demain-weekday-conflict'

export {
  agentActionTypeSchema,
  type AgentActionType,
  type AgentProposal,
  type AgentTurnResult,
  type AgentExecutionMode,
} from '@/lib/agent/v1-deterministic'

function requestNeedsMeetLink(input: string) {
  const normalized = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  const explicitlyNoMeet =
    /\b(sans|without|no|pas de|aucun)\s+(google meet|meet|visio|visioconference|video|zoom|teams)\b/.test(normalized) ||
    /\b(google meet|meet|visio|visioconference|video|zoom|teams)\b.*\b(sans|without|no|off|disabled)\b/.test(normalized)

  if (explicitlyNoMeet) {
    return false
  }

  return /(google meet|meet|visio|visioconference|visioconférence|video|vidéo|remote|zoom|teams|réunion|reunion|rendez-vous|rendezvous|\brdv\b|\bpoint\b|atelier|workshop|kickoff|\bsync\b)/i.test(
    input
  )
}

function requestForcesMeetLinkOff(input: string) {
  return /\b(sans|without|no|pas de|aucun)\s+(google meet|meet|visio|visioconference|video|zoom|teams)\b/i.test(input)
}

function normalizeInput(input: string) {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function hasExplicitCalendarDate(input: string) {
  const normalized = normalizeInput(input)
  return (
    /\b(demain|tomorrow|aujourd'hui|aujourdhui|today|ce soir|ce matin|cet apres-midi|cet apres midi|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(
      normalized
    ) ||
    /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(normalized) ||
    /\b\d{1,2}\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(
      normalized
    )
  )
}

function hasExplicitCalendarTime(input: string) {
  const normalized = normalizeInput(input)
  return (
    /\b\d{1,2}\s*(?:h|heure|heures)\b/.test(normalized) ||
    /\b\d{1,2}:\d{2}\b/.test(normalized) ||
    /\b(midi|minuit|noon|midnight)\b/.test(normalized)
  )
}

function hasConcreteCalendarSchedule(input: string) {
  return hasExplicitCalendarDate(input) && hasExplicitCalendarTime(input)
}

function needsCalendarTimingClarification(input: string, proposals: AgentProposal[]) {
  const mentionsCalendarExecution =
    proposals.some((proposal) => proposal.type === 'create_calendar_event') ||
    looksLikeCalendarEmailBundleIntent(input) ||
    looksLikeCalendarSchedulingRequest(input)

  if (!mentionsCalendarExecution) {
    return false
  }

  if (inputHasDemainWeekdayConflict(input)) {
    return true
  }

  return !hasConcreteCalendarSchedule(input) && !canInferCalendarRangeFromUserText(input, 30)
}

function buildCalendarTimingClarificationResponse(language: 'fr' | 'en', input: string) {
  if (inputHasDemainWeekdayConflict(input)) {
    return buildDemainWeekdayClarificationResponse(language)
  }

  const bundle = looksLikeCalendarEmailBundleIntent(input)
  if (language === 'en') {
    return bundle
      ? 'I have the reschedule, the email, and the Meet link in mind. I’m missing one thing before I prepare it cleanly: what time should I move it to?'
      : 'I can prepare that cleanly. I’m just missing the exact time.'
  }

  return bundle
    ? 'J’ai bien le report, le mail et le lien Meet en tête. Il me manque juste une chose pour te préparer ça proprement : tu veux le déplacer à quelle heure ?'
    : 'Je peux te préparer ça proprement. Il me manque juste l’heure exacte.'
}

export function responseClaimsActionReady(response: string) {
  return /(c'?est pret|c'est pret|pret(?:e)?|ready|done|prepared|action prete|email pret|draft ready|brouillon pret|rdv pret|invite ready|partage drive pret|archivage pret|sera archive(?:e)?|will be archived|va etre archive(?:e)?|session google photos ouverte|google photos session opened|picker google photos ouvert|google photos picker opened)/i.test(
    response
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
  )
}

function isActionOrWorkflowRequest(input: string) {
  const normalizedInput = normalizeInput(input)
  return /(send|email|mail|draft|reply|write|create|update|schedule|book|invite|plan|share|upload|save|store|sync|connect|disconnect|refresh|archive|unarchive|restore|label|forward|move|rename|star|unstar|trash|copy|duplicate|revoke|unshare|folder|open|ouvrir|ouvre|select|selectionne|selectionner|choisis|choisir|gmail|google calendar|calendar|calendrier|google meet|meet|google docs|google doc|docs|document|notion|google drive|drive|google photos|photos|photo|visio|réunion|reunion|dossier|folder|fichier|file|page|database|base de donnees|base de données|doc\\b|appdata|app data)/i.test(
    normalizedInput
  )
}

function looksLikeMeetingEmailBundleRequest(input: string) {
  const normalizedInput = normalizeInput(input)
  const mentionsMeeting =
    /(calendar|calendrier|meeting|reunion|réunion|rdv|rendez vous|rendez-vous|google meet|meet|agenda|invite|invitation|visio)/.test(
      normalizedInput
    )
  const mentionsEmail =
    /(gmail|mail|email|courriel|brouillon|draft|message)/.test(normalizedInput)
  const mentionsBundleCue =
    /(meme modele|meme objectif|meme horaires|mêmes horaires|same objective|same schedule|same as before|lien|link|trouve son adresse|find (her|his|their) address|prepare l invitation|prepare the invite|mail recap|email recap|mail reca|prepare aussi le mail|prepare aussi l email|prepare the email|prepare the mail|avec le lien|with the link)/.test(
      normalizedInput
    )
  const asksForMeetLink = /(google meet|meet|visio|lien|link)/.test(normalizedInput)
  return mentionsMeeting && mentionsEmail && (mentionsBundleCue || asksForMeetLink)
}

function looksLikeCalendarEmailBundleIntent(input: string) {
  const normalizedInput = normalizeInput(input)
  const mentionsCalendarWork =
    /(calendar|calendrier|agenda|meeting|reunion|réunion|rdv|rendez vous|rendez-vous|invite|invitation|google meet|meet|visio)/.test(
      normalizedInput
    )
  const mentionsMailWork = /(gmail|mail|email|courriel|brouillon|draft|message)/.test(normalizedInput)
  const mentionsLinkOrMeet = /(google meet|meet|lien|link|visio)/.test(normalizedInput)
  return mentionsCalendarWork && mentionsMailWork && mentionsLinkOrMeet
}

function looksLikeCalendarSchedulingRequest(input: string) {
  const normalizedInput = normalizeInput(input)
  const mentionsCalendarWork =
    /(calendar|calendrier|agenda|meeting|reunion|réunion|rdv|rendez vous|rendez-vous|invite|invitation|google meet|meet|visio)/.test(
      normalizedInput
    )
  const mentionsSchedulingVerb =
    /(cree|crée|ajoute|planifie|programme|reporte|decale|décale|deplacer|déplacer|move|reschedule|schedule|book|annuler|cancel|replace|decaler|reporter)/.test(
      normalizedInput
    )
  return mentionsCalendarWork && mentionsSchedulingVerb
}

function buildCalendarScheduleClarificationResponse(params: {
  input: string
  language: 'fr' | 'en'
  includesEmailWork: boolean
}) {
  const needsDate = !hasExplicitCalendarDate(params.input)
  const needsTime = !hasExplicitCalendarTime(params.input)

  if (params.language === 'en') {
    if (params.includesEmailWork) {
      if (needsDate && needsTime) {
        return 'I can prepare the email and the calendar invite with Google Meet, but I still need the exact date and time before I lock the sequence. Send me the slot you want, and I’ll rebuild the whole pack cleanly.'
      }
      if (needsTime) {
        return 'I can prepare the email and the calendar invite with Google Meet, but I still need the exact time before I lock the sequence. Send me the slot you want, and I’ll rebuild the whole pack cleanly.'
      }
      return 'I can prepare the email and the calendar invite with Google Meet, but I still need the exact date before I lock the sequence. Send me the slot you want, and I’ll rebuild the whole pack cleanly.'
    }

    if (needsDate && needsTime) {
      return 'I can prepare the invite cleanly, but I still need the exact date and time. Send me the slot you want and I’ll set it up.'
    }
    if (needsTime) {
      return 'I can prepare the invite cleanly, but I still need the exact time. Send me the slot you want and I’ll set it up.'
    }
    return 'I can prepare the invite cleanly, but I still need the exact date. Send me the slot you want and I’ll set it up.'
  }

  if (params.includesEmailWork) {
    if (needsDate && needsTime) {
      return 'Je peux te préparer le mail et l’invitation avec Google Meet, mais il me manque encore la date et l’heure exactes avant de verrouiller la séquence. Donne-moi le créneau voulu et je te reconstruis le pack proprement.'
    }
    if (needsTime) {
      return 'Je peux te préparer le mail et l’invitation avec Google Meet, mais il me manque encore l’heure exacte avant de verrouiller la séquence. Donne-moi le créneau voulu et je te reconstruis le pack proprement.'
    }
    return 'Je peux te préparer le mail et l’invitation avec Google Meet, mais il me manque encore la date exacte avant de verrouiller la séquence. Donne-moi le créneau voulu et je te reconstruis le pack proprement.'
  }

  if (needsDate && needsTime) {
    return 'Je peux te préparer l’invitation proprement, mais il me manque encore la date et l’heure exactes. Donne-moi le créneau voulu et je te la prépare.'
  }
  if (needsTime) {
    return 'Je peux te préparer l’invitation proprement, mais il me manque encore l’heure exacte. Donne-moi le créneau voulu et je te la prépare.'
  }
  return 'Je peux te préparer l’invitation proprement, mais il me manque encore la date exacte. Donne-moi le créneau voulu et je te la prépare.'
}

function looksLikeLiteralInstructionText(value: unknown) {
  if (typeof value !== 'string') {
    return false
  }

  const normalizedValue = normalizeInput(value)
  if (!normalizedValue) {
    return false
  }

  return /^(ecris moi|écris moi|redige|rédige|prepare|prépare|trouve|cherche|je t ai|je tai|je te demande|tu peux|peux tu|refais|fais|mets)\b/.test(
    normalizedValue
  )
}

function proposalLeaksLiteralUserInstruction(proposal: AgentProposal) {
  if (proposal.type !== 'send_email' && proposal.type !== 'create_gmail_draft' && proposal.type !== 'update_gmail_draft') {
    return false
  }

  return (
    looksLikeLiteralInstructionText(proposal.parameters.subject) ||
    looksLikeLiteralInstructionText(proposal.parameters.body)
  )
}

function extractTemporalSignals(value: string) {
  const normalized = normalizeInput(value)
  const normalizeWeekday = (weekday: string) => {
    const token = weekday.toLowerCase()
    if (token === 'lundi' || token === 'monday') return 'mon'
    if (token === 'mardi' || token === 'tuesday') return 'tue'
    if (token === 'mercredi' || token === 'wednesday') return 'wed'
    if (token === 'jeudi' || token === 'thursday') return 'thu'
    if (token === 'vendredi' || token === 'friday') return 'fri'
    if (token === 'samedi' || token === 'saturday') return 'sat'
    if (token === 'dimanche' || token === 'sunday') return 'sun'
    return token
  }
  const normalizeTime = (hours: string, minutes?: string) => {
    const hour = Number.parseInt(hours, 10)
    const minute = minutes ? Number.parseInt(minutes, 10) : 0
    if (Number.isNaN(hour) || Number.isNaN(minute)) {
      return `${hours}:${minutes ?? '00'}`
    }
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
  }

  const weekdays = new Set(
    (normalized.match(
      /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g
    ) || []).map(normalizeWeekday)
  )
  const times = new Set<string>()
  const glued = normalized.match(/\b(\d{1,2})\s*h(\d{2})\b/g) || []
  for (const match of glued) {
    const m = match.match(/(\d{1,2})\s*h(\d{2})/)
    if (m) times.add(normalizeTime(m[1], m[2]))
  }
  const hourOnly = normalized.match(/\b(\d{1,2})\s*h(?:eures?)?\b/g) || []
  for (const match of hourOnly) {
    const m = match.match(/(\d{1,2})\s*h/)
    if (m) times.add(normalizeTime(m[1]))
  }
  const colon = normalized.match(/\b(\d{1,2}):(\d{2})\b/g) || []
  for (const match of colon) {
    const m = match.match(/(\d{1,2}):(\d{2})/)
    if (m) times.add(normalizeTime(m[1], m[2]))
  }
  return { weekdays, times }
}

function extractCalendarSignalsFromProposal(proposal: AgentProposal) {
  if (proposal.type !== 'create_calendar_event' || typeof proposal.parameters.startTime !== 'string') {
    return { weekdays: new Set<string>(), times: new Set<string>() }
  }

  const start = new Date(proposal.parameters.startTime)
  if (Number.isNaN(start.getTime())) {
    return { weekdays: new Set<string>(), times: new Set<string>() }
  }

  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: 'Europe/Paris',
  })
    .format(start)
    .toLowerCase()
  const hour = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Paris',
  }).format(start)
  return {
    weekdays: new Set([
      weekday === 'monday'
        ? 'mon'
        : weekday === 'tuesday'
          ? 'tue'
          : weekday === 'wednesday'
            ? 'wed'
            : weekday === 'thursday'
              ? 'thu'
              : weekday === 'friday'
                ? 'fri'
                : weekday === 'saturday'
                  ? 'sat'
                  : 'sun',
    ]),
    times: new Set([hour]),
  }
}

function setsOverlap(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) {
    return true
  }
  for (const value of Array.from(left)) {
    if (right.has(value)) return true
  }
  return false
}

function proposalHasTemporalMismatchWithRequest(input: string, proposals: AgentProposal[]) {
  const requestSignals = extractTemporalSignals(input)
  if (requestSignals.weekdays.size === 0 && requestSignals.times.size === 0) {
    return false
  }

  const calendarProposal = proposals.find((proposal) => proposal.type === 'create_calendar_event')
  const calendarSignals = calendarProposal ? extractCalendarSignalsFromProposal(calendarProposal) : null

  return proposals.some((proposal) => {
    if (
      proposal.type !== 'send_email' &&
      proposal.type !== 'create_gmail_draft' &&
      proposal.type !== 'update_gmail_draft'
    ) {
      return false
    }
    const emailSignals = extractTemporalSignals(
      `${typeof proposal.parameters.subject === 'string' ? proposal.parameters.subject : ''}\n${typeof proposal.parameters.body === 'string' ? proposal.parameters.body : ''}`
    )
    if (emailSignals.weekdays.size === 0 && emailSignals.times.size === 0) {
      return false
    }

    const conflictsWithRequest =
      !setsOverlap(requestSignals.weekdays, emailSignals.weekdays) ||
      !setsOverlap(requestSignals.times, emailSignals.times)
    if (conflictsWithRequest) {
      return true
    }

    if (!calendarSignals) {
      return false
    }

    return (
      !setsOverlap(calendarSignals.weekdays, emailSignals.weekdays) ||
      !setsOverlap(calendarSignals.times, emailSignals.times)
    )
  })
}

function buildRoleDeniedResponse(language: 'fr' | 'en') {
  return language === 'en'
    ? 'I understood the request, but your workspace role is not allowed to use that tool.'
    : 'J’ai compris la demande, mais ton rôle workspace n’est pas autorisé à utiliser cet outil.'
}

function buildResolvedDeterministicTurn(params: {
  input: string
  knownContacts: KnownContact[]
  assistantProfile?: AssistantProfile
  allowedActionTypes: AgentActionType[]
  connectedContextMetadata?: Record<string, unknown>
  responseOverride?: string
  plan?: AgentPlanStep[]
}): AgentTurnResult {
  const fallback = buildFallbackResponseWithContactsAndProfile(
    params.input,
    params.knownContacts,
    params.assistantProfile
  )
  const fallbackResolution = resolveActionReferencesDetailed({
    proposals: fallback.proposals.filter((proposal) => params.allowedActionTypes.includes(proposal.type)),
    userInput: params.input,
    connectedContextMetadata: params.connectedContextMetadata,
  })
  const filteredProposals = fallbackResolution.proposals
  const language = params.assistantProfile?.defaultLanguage ?? 'fr'

  return {
    response:
      fallbackResolution.disambiguations.length > 0
        ? buildDisambiguationResponse(fallbackResolution.disambiguations, params.assistantProfile)
        : fallback.proposals.length > 0 && filteredProposals.length === 0
          ? buildRoleDeniedResponse(language)
          : params.responseOverride ?? fallback.response,
    proposals: fallbackResolution.disambiguations.length > 0 ? [] : filteredProposals,
    disambiguations: fallbackResolution.disambiguations,
    plan: params.plan ?? [],
  }
}

function shouldFallbackForModelFailure(params: {
  allowProposals: boolean
  aiProposalCount: number
  safeProposalCount: number
  modelClaimsActionReadyWithoutProposal: boolean
  lowValueActionResponse: boolean
  brokenMeetingBundleDetected: boolean
  onlyWeakCalendarProposalsRemain: boolean
}) {
  if (!params.allowProposals) {
    return false
  }

  if (params.brokenMeetingBundleDetected || params.modelClaimsActionReadyWithoutProposal) {
    return true
  }

  if (params.lowValueActionResponse && params.safeProposalCount === 0) {
    return true
  }

  if (params.aiProposalCount > 0 && params.safeProposalCount === 0) {
    return true
  }

  if (params.onlyWeakCalendarProposalsRemain) {
    return true
  }

  return false
}

function shouldUsePlanNarration(params: {
  modelResponse: string
  plan: AgentPlanStep[]
  finalExecutableProposalCount: number
  usingFallbackExecutableProposals: boolean
}) {
  if (params.finalExecutableProposalCount === 0) {
    return false
  }

  if (params.usingFallbackExecutableProposals) {
    return params.plan.length > 0
  }

  if (isLowValueAssistantResponse(params.modelResponse)) {
    return params.plan.length > 0 || params.finalExecutableProposalCount > 1
  }

  return params.plan.length > 0 && params.modelResponse.trim().length < 60
}

function isCalendarEmailMeetBundleProposal(proposals: AgentProposal[]) {
  const hasCalendar = proposals.some((proposal) => proposal.type === 'create_calendar_event')
  const hasEmailWithMeetLink = proposals.some(
    (proposal) =>
      (proposal.type === 'send_email' || proposal.type === 'create_gmail_draft') &&
      typeof proposal.parameters.body === 'string' &&
      /\{\{\s*meet_?link\s*\}\}/i.test(proposal.parameters.body)
  )

  return hasCalendar && hasEmailWithMeetLink
}

function formatBundleCalendarLabel(iso: unknown, language: 'fr' | 'en') {
  if (typeof iso !== 'string' || !iso.trim()) {
    return null
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  const formatted = new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(date)
  return language === 'fr' ? formatted.replace(':', 'h') : formatted
}

function alignCalendarEmailBundleProposals(params: {
  input: string
  language: 'fr' | 'en'
  proposals: AgentProposal[]
  knownContacts: KnownContact[]
  assistantProfile?: AssistantProfile
}) {
  const calendarProposal = params.proposals.find((proposal) => proposal.type === 'create_calendar_event')
  if (!calendarProposal) {
    return params.proposals
  }

  const normalizedInput = normalizeInput(params.input)
  const scheduleLabel = formatBundleCalendarLabel(calendarProposal.parameters.startTime, params.language)
  const recipientName =
    extractRecipientName(params.input) ||
    extractGmailLookupNameQuery(params.input) ||
    (typeof calendarProposal.parameters.resolvedContactName === 'string'
      ? calendarProposal.parameters.resolvedContactName
      : null)
  const knownContact = recipientName ? findContactByName(recipientName, params.knownContacts) : null
  const firstName = knownContact?.name?.split(/\s+/).filter(Boolean)[0] || ''
  const signature =
    params.assistantProfile?.signatureBlock?.trim() ||
    params.assistantProfile?.signatureName ||
    'Kova'
  const isReschedule =
    /\b(reporter|reporte|report|reschedule|decaler|décaler|annuler|cancel|move|postpone)\b/.test(normalizedInput)
  const forceMeetOff = requestForcesMeetLinkOff(params.input)
  const inputWantsMeet = requestNeedsMeetLink(params.input)
  const preBundleEmailHasMeetToken = params.proposals.some(
    (p) =>
      (p.type === 'send_email' || p.type === 'create_gmail_draft') &&
      typeof p.parameters.body === 'string' &&
      /\{\{\s*meet_?link\s*\}\}/i.test(p.parameters.body)
  )
  const mentionsMeetForCopy =
    !forceMeetOff &&
    (Boolean(calendarProposal.parameters.createMeetLink) || inputWantsMeet || preBundleEmailHasMeetToken)

  const aligned = params.proposals.map((proposal) => {
    if (proposal.type !== 'send_email' && proposal.type !== 'create_gmail_draft') {
      return proposal
    }

    const existingBody = typeof proposal.parameters.body === 'string' ? proposal.parameters.body : ''
    const existingSubject = typeof proposal.parameters.subject === 'string' ? proposal.parameters.subject : ''
    const bodyHasMeetPlaceholder =
      /\{\{\s*meet_?link\s*\}\}/i.test(existingBody)
    const shouldPatchMeetPlaceholder = mentionsMeetForCopy && !bodyHasMeetPlaceholder
    const subjectNeedsRepair = !existingSubject.trim() || looksLikeLiteralInstructionText(existingSubject)
    const bodyNeedsFullRewrite =
      !existingBody.trim() ||
      looksLikeLiteralInstructionText(existingBody) ||
      proposalHasTemporalMismatchWithRequest(params.input, [proposal])

    if (!subjectNeedsRepair && !bodyNeedsFullRewrite && !shouldPatchMeetPlaceholder && !knownContact) {
      return proposal
    }

    const greeting =
      params.language === 'en'
        ? firstName ? `Hello ${firstName},` : 'Hello,'
        : firstName ? `Bonjour ${firstName},` : 'Bonjour,'

    const bodyLines =
      params.language === 'en'
        ? isReschedule
          ? [
              greeting,
              '',
              'I need to move our meeting.',
              scheduleLabel ? `I’m proposing ${scheduleLabel} instead.` : 'I’m proposing an updated slot instead.',
              mentionsMeetForCopy ? 'Here is the Google Meet link for the call:' : 'I’m sharing the updated invite here.',
              ...(mentionsMeetForCopy ? ['{{meet_link}}'] : []),
              '',
              'Let me know if this works for you.',
              '',
              'Best regards,',
              signature,
            ]
          : [
              greeting,
              '',
              scheduleLabel ? `Here is the proposed slot: ${scheduleLabel}.` : 'Here is the proposed slot.',
              mentionsMeetForCopy ? 'Here is the Google Meet link for the call:' : 'I’m sharing the invite here.',
              ...(mentionsMeetForCopy ? ['{{meet_link}}'] : []),
              '',
              'Let me know if this works for you.',
              '',
              'Best regards,',
              signature,
            ]
        : isReschedule
          ? [
              greeting,
              '',
              'Je dois décaler notre réunion.',
              scheduleLabel ? `Je te propose ${scheduleLabel} à la place.` : 'Je te propose un créneau mis à jour.',
              mentionsMeetForCopy ? 'Voici le lien Google Meet pour la visio :' : 'Je te partage l’invitation mise à jour ici.',
              ...(mentionsMeetForCopy ? ['{{meet_link}}'] : []),
              '',
              'Dis-moi si ça te convient.',
              '',
              'Bien à toi,',
              signature,
            ]
          : [
              greeting,
              '',
              scheduleLabel ? `Je te propose ce créneau : ${scheduleLabel}.` : 'Je te propose ce créneau.',
              mentionsMeetForCopy ? 'Voici le lien Google Meet pour la visio :' : 'Je te partage l’invitation ici.',
              ...(mentionsMeetForCopy ? ['{{meet_link}}'] : []),
              '',
              'Dis-moi si ça te convient.',
              '',
              'Bien à toi,',
              signature,
            ]

    const rebuiltBody = bodyLines.join('\n')
    const patchedBody =
      bodyNeedsFullRewrite
        ? rebuiltBody
        : shouldPatchMeetPlaceholder
          ? `${existingBody.trim()}\n\n${params.language === 'en' ? 'Here is the Google Meet link for the call:' : 'Voici le lien Google Meet pour la visio :'}\n{{meet_link}}`
          : existingBody
    const patchedSubject =
      subjectNeedsRepair
        ? params.language === 'en'
          ? isReschedule
            ? 'Reschedule our meeting'
            : typeof calendarProposal.parameters.title === 'string' && calendarProposal.parameters.title.trim()
              ? calendarProposal.parameters.title
              : 'Meeting details'
          : isReschedule
            ? 'Report de notre réunion'
            : typeof calendarProposal.parameters.title === 'string' && calendarProposal.parameters.title.trim()
              ? calendarProposal.parameters.title
              : 'Détails de notre réunion'
        : existingSubject

    return {
      ...proposal,
      title:
        knownContact
          ? proposal.type === 'create_gmail_draft'
            ? `Create draft for ${knownContact.name}`
            : `Send email to ${knownContact.name}`
          : proposal.title,
      description:
        params.language === 'en'
          ? 'Prepare the email that matches the calendar invite.'
          : "Préparer l'email cohérent avec l'invitation agenda.",
      parameters: {
        ...proposal.parameters,
        ...(knownContact
          ? {
              to: [knownContact.email],
              resolvedContactName: knownContact.name,
            }
          : {}),
        subject: patchedSubject,
        body: patchedBody,
      },
      confidenceScore: Math.max(proposal.confidenceScore, knownContact ? 0.94 : 0.86),
    }
  })

  const postBundleEmailHasMeetToken = aligned.some(
    (p) =>
      (p.type === 'send_email' || p.type === 'create_gmail_draft') &&
      typeof p.parameters.body === 'string' &&
      /\{\{\s*meet_?link\s*\}\}/i.test(p.parameters.body)
  )
  const calendarMustEnableMeet =
    !forceMeetOff &&
    (Boolean(calendarProposal.parameters.createMeetLink) || inputWantsMeet || postBundleEmailHasMeetToken)

  return aligned.map((proposal) => {
    if (proposal.type !== 'create_calendar_event') {
      return proposal
    }
    return {
      ...proposal,
      parameters: {
        ...proposal.parameters,
        createMeetLink: calendarMustEnableMeet,
      },
    }
  })
}

function buildProposalBackedNarration(params: {
  language: 'fr' | 'en'
  proposals: AgentProposal[]
}) {
  if (isCalendarEmailMeetBundleProposal(params.proposals)) {
    return params.language === 'en'
      ? 'I prepared the sequence cleanly: first the calendar invite with Google Meet so the live link exists, then the email that reuses that link. Both actions are ready for your review.'
      : 'Je t’ai préparé la séquence proprement : d’abord l’invitation agenda avec Google Meet pour générer le vrai lien, puis le mail qui réutilise ce lien. Les deux actions sont prêtes à valider.'
  }

  return null
}

async function maybeEnrichGuardrailNarration(params: {
  language: 'fr' | 'en'
  input: string
  draftResponse: string
  proposals: AgentProposal[]
  workspaceContext?: string
  shouldEnrich: boolean
}) {
  if (!params.shouldEnrich || params.proposals.length === 0 || !isOpenAiConfigured()) {
    return params.draftResponse
  }

  try {
    return await synthesizeDeterministicAssistantNarration({
      defaultLanguage: params.language,
      userMessage: params.input,
      draftResponse: params.draftResponse,
      proposals: params.proposals.map((proposal) => ({
        type: proposal.type,
        title: proposal.title,
        description: proposal.description,
      })),
      workspaceContext: params.workspaceContext,
    })
  } catch {
    return params.draftResponse
  }
}

export async function runAgentTurn(
  input: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  knownContacts: KnownContact[] = [],
  assistantProfile?: AssistantProfile,
  allowedActionTypes: AgentActionType[] = agentActionTypeSchema.options,
  options: {
    workspaceContext?: string
    connectedContextMetadata?: Record<string, unknown>
  } = {}
): Promise<AgentTurnResult> {
  const effectiveInput = stripConversationalLeadIn(input)
  const enabledSkillIds = resolveEnabledAssistantSkills(assistantProfile?.enabledSkills)
  const enabledSkills = executiveAssistantSkills.filter((skill) => enabledSkillIds.includes(skill.id))
  const availableTools = listMcpTools().filter((tool) =>
    allowedActionTypes.includes(tool.actionType as AgentActionType)
  )
  const language = assistantProfile?.defaultLanguage ?? 'fr'

  if (isConversationalInput(effectiveInput)) {
    if (isOpenAiConfigured()) {
      try {
        const aiResult = await analyzeUserRequest(
          effectiveInput,
          conversationHistory,
          {
            assistantProfile,
            skills: enabledSkills,
            workspaceContext: options.workspaceContext,
            behaviorMode: 'conversation',
          }
        )

        return {
          response: aiResult.response,
          proposals: [],
          disambiguations: [],
          plan: aiResult.plan,
        }
      } catch {
        // Fall back to deterministic conversation if the model is unavailable.
      }
    }

    return {
      response: buildConversationalResponse(effectiveInput, assistantProfile),
      proposals: [],
      disambiguations: [],
      plan: [],
    }
  }

  if (availableTools.length === 0) {
    return {
      response:
        language === 'en'
          ? 'I can answer questions normally, but this workspace role is not allowed to execute connected app actions.'
          : 'Je peux répondre normalement, mais ce rôle workspace n’est pas autorisé à exécuter des actions sur les applications connectées.',
      proposals: [],
      disambiguations: [],
      plan: [],
    }
  }

  const deterministicFallback = buildFallbackResponseWithContactsAndProfile(effectiveInput, knownContacts, assistantProfile)

  if (isCapabilityQuestion(effectiveInput, deterministicFallback.proposals)) {
    if (isOpenAiConfigured()) {
      try {
        const aiResult = await analyzeUserRequest(effectiveInput, conversationHistory, {
          assistantProfile,
          skills: enabledSkills,
          workspaceContext: options.workspaceContext,
          behaviorMode: 'conversation',
        })

        return {
          response: aiResult.response,
          proposals: [],
          disambiguations: [],
          plan: aiResult.plan,
        }
      } catch {
        // fall through to deterministic capability reply
      }
    }

    return {
      response: buildCapabilityResponse(effectiveInput, deterministicFallback.proposals, assistantProfile),
      proposals: [],
      disambiguations: [],
      plan: [],
    }
  }

  if (isOpenAiConfigured()) {
    try {
      const aiResult = await analyzeUserRequest(
        effectiveInput,
        conversationHistory,
        {
          knownContacts: knownContacts.map((contact) => ({ name: contact.name, email: contact.email })),
          assistantProfile,
          skills: enabledSkills,
          tools: availableTools,
          workspaceContext: options.workspaceContext,
        }
      )

      const proposals = aiResult.proposals
        .map((proposal) => {
          const parsed = agentActionTypeSchema.safeParse(proposal.type)
          if (!parsed.success) return null
          if (!allowedActionTypes.includes(parsed.data)) return null

          const tool = getToolByActionType(parsed.data)
          if (!tool) return null

          const preparedParameters = prepareActionParameters(parsed.data, proposal.parameters)
          const validatedParameters = tool.inputSchema.safeParse(preparedParameters)
          if (!validatedParameters.success) return null

          return {
            type: parsed.data,
            title: proposal.title,
            description: proposal.description,
            parameters: validatedParameters.data,
            confidenceScore:
              typeof proposal.confidenceScore === 'number'
                ? proposal.confidenceScore
                : typeof proposal.parameters.confidenceScore === 'number'
                  ? proposal.parameters.confidenceScore
                  : 0.85,
          } satisfies AgentProposal
        })
        .filter((proposal): proposal is AgentProposal => proposal !== null)

      const resolvedReferenceResult = resolveActionReferencesDetailed({
        proposals,
        userInput: effectiveInput,
        connectedContextMetadata: options.connectedContextMetadata,
      })
      const resolvedReferenceProposals = resolvedReferenceResult.proposals

      const enrichedProposals = resolvedReferenceProposals.map((proposal) => {
        if (proposal.type === 'create_calendar_event') {
          const attendees = Array.isArray(proposal.parameters.attendees)
            ? proposal.parameters.attendees.filter((value): value is string => typeof value === 'string' && value.includes('@'))
            : []
          const explicitInputEmails = extractEmailAddresses(effectiveInput)
          const maybeRecipient = extractRecipientName(effectiveInput) || extractGmailLookupNameQuery(effectiveInput)
          const knownContact = maybeRecipient ? findContactByName(maybeRecipient, knownContacts) : null

          const forceMeetOff = requestForcesMeetLinkOff(effectiveInput)
          const wantsMeet = requestNeedsMeetLink(effectiveInput)

          return {
            ...proposal,
            parameters: {
              ...proposal.parameters,
              createMeetLink: forceMeetOff
                ? false
                : typeof proposal.parameters.createMeetLink === 'boolean'
                  ? proposal.parameters.createMeetLink || wantsMeet
                  : wantsMeet,
              attendees:
                attendees.length > 0
                  ? attendees
                  : explicitInputEmails.length > 0
                    ? explicitInputEmails
                    : knownContact
                      ? [knownContact.email]
                      : attendees,
            },
            confidenceScore: Math.max(proposal.confidenceScore, wantsMeet ? 0.9 : 0.85),
          }
        }

        if (
          proposal.type !== 'send_email' &&
          proposal.type !== 'create_gmail_draft' &&
          proposal.type !== 'share_google_drive_file' &&
          proposal.type !== 'unshare_google_drive_file' &&
          proposal.type !== 'forward_email'
        ) {
          return proposal
        }

        const recipientKey =
          proposal.type === 'share_google_drive_file' || proposal.type === 'unshare_google_drive_file'
            ? 'emails'
            : 'to'
        const to = Array.isArray(proposal.parameters[recipientKey]) ? proposal.parameters[recipientKey] as unknown[] : []
        const hasRealEmail = to.some((value) => typeof value === 'string' && value.includes('@'))
        if (hasRealEmail) {
          return proposal
        }

        const maybeRecipient = extractRecipientName(effectiveInput) || extractGmailLookupNameQuery(effectiveInput)
        const knownContact = maybeRecipient ? findContactByName(maybeRecipient, knownContacts) : null
        if (!knownContact) {
          return proposal
        }

        return {
          ...proposal,
          title:
            proposal.type === 'share_google_drive_file'
              ? `Share file with ${knownContact.name}`
              : proposal.type === 'unshare_google_drive_file'
                ? `Remove file access for ${knownContact.name}`
                : proposal.type === 'create_gmail_draft'
                  ? `Create draft for ${knownContact.name}`
                  : proposal.type === 'forward_email'
                    ? `Forward email to ${knownContact.name}`
                    : `Send email to ${knownContact.name}`,
          parameters: {
            ...proposal.parameters,
            [recipientKey]: [knownContact.email],
            resolvedContactName: knownContact.name,
          },
          confidenceScore: Math.max(proposal.confidenceScore, 0.93),
        }
      })

      const hasMeetPlaceholderEmail = enrichedProposals.some(
        (p) =>
          (p.type === 'send_email' || p.type === 'create_gmail_draft') &&
          typeof p.parameters.body === 'string' &&
          /\{\{\s*meet_?link\s*\}\}/i.test(p.parameters.body)
      )

      const enrichedWithMeet = hasMeetPlaceholderEmail
        ? enrichedProposals.map((p) =>
            p.type === 'create_calendar_event'
              ? {
                  ...p,
                  parameters: {
                    ...p.parameters,
                    createMeetLink: true,
                  },
                }
              : p
          )
        : enrichedProposals

      const defaultMeetingDuration = assistantProfile?.meetingDefaultDurationMinutes || 30
      const safeProposals = enrichedWithMeet.map((proposal) => {
        if (
          proposal.type === 'create_calendar_event' &&
          !hasConcreteCalendarSchedule(effectiveInput) &&
          !canInferCalendarRangeFromUserText(effectiveInput, defaultMeetingDuration)
        ) {
          return {
            ...proposal,
            confidenceScore: Math.min(proposal.confidenceScore, 0.35),
          }
        }

        const recipients = proposal.parameters.to
        const shareRecipients = proposal.parameters.emails
        const hasPlaceholderRecipient =
          (proposal.type === 'send_email' || proposal.type === 'create_gmail_draft' || proposal.type === 'forward_email') &&
          Array.isArray(recipients) &&
          recipients.some(
            (value) =>
              typeof value === 'string' &&
              (value.trim().toLowerCase() === 'recipient@example.com' || value.trim().toLowerCase().endsWith('@example.com'))
          )
        const hasPlaceholderShareRecipient =
          (proposal.type === 'share_google_drive_file' || proposal.type === 'unshare_google_drive_file') &&
          Array.isArray(shareRecipients) &&
          shareRecipients.some(
            (value) =>
              typeof value === 'string' &&
              (value.trim().toLowerCase() === 'recipient@example.com' || value.trim().toLowerCase().endsWith('@example.com'))
          )

        if (!(hasPlaceholderRecipient || hasPlaceholderShareRecipient)) {
          return proposal
        }

        return {
          ...proposal,
          confidenceScore: Math.min(proposal.confidenceScore, 0.45),
        }
      })
      const presentationAlignedProposals = alignCalendarEmailBundleProposals({
        input: effectiveInput,
        language,
        proposals: safeProposals,
        knownContacts,
        assistantProfile,
      })

      const allowProposals = isActionOrWorkflowRequest(effectiveInput)
      const modelClaimsActionReadyWithoutProposal =
        allowProposals &&
        aiResult.proposals.length === 0 &&
        presentationAlignedProposals.length === 0 &&
        responseClaimsActionReady(aiResult.response)
      const lowValueActionResponse =
        allowProposals &&
        presentationAlignedProposals.length === 0 &&
        isLowValueAssistantResponse(aiResult.response)
      const onlyWeakCalendarProposalsRemain =
        presentationAlignedProposals.length > 0 &&
        presentationAlignedProposals.every(
          (proposal) => proposal.type === 'create_calendar_event' && proposal.confidenceScore <= 0.35
        )
      const literalInstructionLeakDetected = presentationAlignedProposals.some(proposalLeaksLiteralUserInstruction)
      const temporalBundleMismatchDetected = proposalHasTemporalMismatchWithRequest(effectiveInput, presentationAlignedProposals)
      const modelMissedCalendarEmailBundle =
        looksLikeCalendarEmailBundleIntent(effectiveInput) &&
        (!presentationAlignedProposals.some((proposal) => proposal.type === 'create_calendar_event') ||
          !presentationAlignedProposals.some(
            (proposal) => proposal.type === 'send_email' || proposal.type === 'create_gmail_draft'
          ))
      const brokenMeetingBundleDetected =
        looksLikeMeetingEmailBundleRequest(effectiveInput) &&
        (
          !presentationAlignedProposals.some((proposal) => proposal.type === 'create_calendar_event') ||
          !presentationAlignedProposals.some(
            (proposal) => proposal.type === 'send_email' || proposal.type === 'create_gmail_draft'
          ) ||
          literalInstructionLeakDetected ||
          temporalBundleMismatchDetected
        )
      const shouldRunFallbackResolution = shouldFallbackForModelFailure({
        allowProposals,
        aiProposalCount: aiResult.proposals.length,
        safeProposalCount: presentationAlignedProposals.length,
        modelClaimsActionReadyWithoutProposal,
        lowValueActionResponse,
        brokenMeetingBundleDetected: brokenMeetingBundleDetected || modelMissedCalendarEmailBundle,
        onlyWeakCalendarProposalsRemain,
      })
      const fallbackResolutionForMissingOrInvalidModel =
        shouldRunFallbackResolution
        ? resolveActionReferencesDetailed({
            proposals: (() => {
              const raw = deterministicFallback.proposals.filter(
                (proposal) => allowedActionTypes.includes(proposal.type)
              )
              if (isEmailCompositionAssistanceRequest(effectiveInput)) {
                const hasCalendarProposal = raw.some((proposal) => proposal.type === 'create_calendar_event')
                if (!hasCalendarProposal) {
                  return raw.filter(
                    (proposal) =>
                      proposal.type !== 'send_email' &&
                      proposal.type !== 'create_gmail_draft' &&
                      proposal.type !== 'update_gmail_draft'
                  )
                }
              }
              return raw
            })(),
            userInput: effectiveInput,
            connectedContextMetadata: options.connectedContextMetadata,
          })
        : { proposals: [], disambiguations: [] }
      const fallbackForMissingOrInvalidModelProposal = fallbackResolutionForMissingOrInvalidModel.proposals
      const hasDisambiguation =
        resolvedReferenceResult.disambiguations.length > 0 ||
        fallbackResolutionForMissingOrInvalidModel.disambiguations.length > 0
      const disambiguations = hasDisambiguation
        ? [
            ...resolvedReferenceResult.disambiguations,
            ...fallbackResolutionForMissingOrInvalidModel.disambiguations,
          ]
        : []
      const shouldUseFallbackResponse =
        allowProposals &&
        !hasDisambiguation &&
        ((presentationAlignedProposals.length === 0 && (fallbackForMissingOrInvalidModelProposal.length > 0 ||
          modelClaimsActionReadyWithoutProposal ||
          lowValueActionResponse ||
          onlyWeakCalendarProposalsRemain)) ||
          ((brokenMeetingBundleDetected || modelMissedCalendarEmailBundle) && fallbackForMissingOrInvalidModelProposal.length > 0))
      const usingFallbackExecutableProposals =
        allowProposals &&
        !hasDisambiguation &&
        fallbackForMissingOrInvalidModelProposal.length > 0 &&
        (brokenMeetingBundleDetected || modelMissedCalendarEmailBundle || presentationAlignedProposals.length === 0)

      const finalExecutableProposals =
        allowProposals && !hasDisambiguation
          ? (brokenMeetingBundleDetected || modelMissedCalendarEmailBundle) && fallbackForMissingOrInvalidModelProposal.length > 0
            ? fallbackForMissingOrInvalidModelProposal
            : presentationAlignedProposals.length > 0
              ? presentationAlignedProposals.filter(
                  (proposal) => !(proposal.type === 'create_calendar_event' && proposal.confidenceScore <= 0.35)
                )
              : fallbackForMissingOrInvalidModelProposal
          : []
      const shouldAskCalendarTimingClarification =
        allowProposals &&
        !hasDisambiguation &&
        finalExecutableProposals.length > 0 &&
        needsCalendarTimingClarification(effectiveInput, finalExecutableProposals)

      /** Prefer the model’s wording whenever it said something substantive — deterministic text is only a safety net. */
      const keepModelVoice =
        typeof aiResult.response === 'string' &&
        aiResult.response.trim().length > 0 &&
        !isLowValueAssistantResponse(aiResult.response) &&
        !brokenMeetingBundleDetected
        && !modelMissedCalendarEmailBundle
      const shouldUsePlanBasedNarration = shouldUsePlanNarration({
        modelResponse: aiResult.response,
        plan: aiResult.plan,
        finalExecutableProposalCount: finalExecutableProposals.length,
        usingFallbackExecutableProposals,
      })
      const proposalBackedNarration = buildProposalBackedNarration({
        language,
        proposals: finalExecutableProposals,
      })

      const pickVisibleResponse = () => {
        if (proposalBackedNarration) {
          return proposalBackedNarration
        }
        if (finalExecutableProposals.length > 0 && shouldUsePlanBasedNarration) {
          return buildPlanBackedNarration({
            language,
            plan: aiResult.plan,
            proposalCount: finalExecutableProposals.length,
          })
        }
        if (usingFallbackExecutableProposals) {
          return deterministicFallback.response
        }
        if (brokenMeetingBundleDetected && fallbackForMissingOrInvalidModelProposal.length > 0) {
          return deterministicFallback.response
        }
        if (finalExecutableProposals.length > 0 && !keepModelVoice) {
          return deterministicFallback.response
        }
        if (finalExecutableProposals.length > 0) {
          return keepModelVoice && !usingFallbackExecutableProposals ? aiResult.response : deterministicFallback.response
        }
        if (shouldUseFallbackResponse && keepModelVoice) {
          return aiResult.response
        }
        if (shouldUseFallbackResponse) {
          return deterministicFallback.response
        }
        if (!allowProposals && presentationAlignedProposals.length > 0) {
          return buildConversationalResponse(effectiveInput, assistantProfile)
        }
        return aiResult.response
      }

      const baseVisibleResponse = hasDisambiguation
        ? buildDisambiguationResponse(disambiguations, assistantProfile)
        : shouldAskCalendarTimingClarification
          ? buildCalendarTimingClarificationResponse(language, effectiveInput)
          : pickVisibleResponse()

      const shouldEnrichGuardrailResponse =
        !hasDisambiguation &&
        !shouldAskCalendarTimingClarification &&
        finalExecutableProposals.length > 0 &&
        (
          usingFallbackExecutableProposals ||
          Boolean(proposalBackedNarration) ||
          shouldUsePlanBasedNarration ||
          !keepModelVoice
        )

      const visibleResponse = await maybeEnrichGuardrailNarration({
        language,
        input: effectiveInput,
        draftResponse: baseVisibleResponse,
        proposals: finalExecutableProposals,
        workspaceContext: options.workspaceContext,
        shouldEnrich: shouldEnrichGuardrailResponse,
      })

      return {
        response: visibleResponse,
        proposals: shouldAskCalendarTimingClarification ? [] : finalExecutableProposals,
        disambiguations,
        plan: shouldAskCalendarTimingClarification ? [] : aiResult.plan,
      }
    } catch {
      return buildResolvedDeterministicTurn({
        input: effectiveInput,
        knownContacts,
        assistantProfile,
        allowedActionTypes,
        connectedContextMetadata: options.connectedContextMetadata,
      })
    }
  }

  return buildResolvedDeterministicTurn({
    input: effectiveInput,
    knownContacts,
    assistantProfile,
    allowedActionTypes,
    connectedContextMetadata: options.connectedContextMetadata,
  })
}
