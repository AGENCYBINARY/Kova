import type { AgentProposal } from '@/lib/agent/v1'

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
  return /(google meet|meet|visio|visioconference|visioconférence|video|vidéo|remote|zoom|teams|call)/.test(
    normalizeInput(input)
  )
}

function looksLikeCalendarRedoRequest(input: string) {
  const normalized = normalizeInput(input)
  return (
    /\b(refais|refaire|refait|recree|recreer|recr[eé]e|fais[- ]en un autre|fait en un autre|un autre|autre evenement|autre rendez vous|autre rdv)\b/.test(
      normalized
    ) || Boolean(extractCalendarMotif(input))
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
          createMeetLink:
            typeof latestCalendarAction.parameters.createMeetLink === 'boolean'
              ? requestNeedsMeetLink(params.input) || latestCalendarAction.parameters.createMeetLink
              : requestNeedsMeetLink(params.input),
        },
        confidenceScore: 0.9,
      },
    ],
  }
}
