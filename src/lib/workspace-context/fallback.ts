import type { ConnectedContextSource, ConnectedContextRequest } from '@/lib/workspace-context/intents'

interface SourceMetadataSummary {
  source: ConnectedContextSource
  connected?: boolean
  messageCount?: number
  unreadCount?: number
  messages?: Array<{
    from?: string
    subject?: string
    snippet?: string
    unread?: boolean
  }>
  eventCount?: number
  availabilityCount?: number
  fileCount?: number
  pageCount?: number
  error?: string
}

export interface ConnectedWorkspaceFallbackInput {
  request: ConnectedContextRequest
  workspaceContext: string
  metadata: Record<string, unknown>
}

function normalizeInput(input: string) {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function buildConnectedContextFallbackResponse(
  result: ConnectedWorkspaceFallbackInput,
  language: 'fr' | 'en' = 'fr'
) {
  const summaries = Array.isArray(result.metadata.connectedContextSummary)
    ? result.metadata.connectedContextSummary as SourceMetadataSummary[]
    : []

  const lines = summaries.flatMap((summary) => {
    if (summary.error) {
      return language === 'en'
        ? [`${summary.source}: read failed`]
        : [`${summary.source}: lecture indisponible`]
    }

    if (summary.connected === false) {
      return language === 'en'
        ? [`${summary.source}: not connected`]
        : [`${summary.source}: non connecte`]
    }

    if (summary.source === 'gmail') {
      return language === 'en'
        ? [`gmail: ${summary.messageCount || 0} messages, ${summary.unreadCount || 0} unread`]
        : [`gmail: ${summary.messageCount || 0} messages, ${summary.unreadCount || 0} non lus`]
    }

    if (summary.source === 'calendar') {
      return language === 'en'
        ? [`calendar: ${summary.eventCount || 0} events, ${summary.availabilityCount || 0} free windows`]
        : [`calendar: ${summary.eventCount || 0} evenements, ${summary.availabilityCount || 0} creneaux libres`]
    }

    if (summary.source === 'google_drive') {
      return language === 'en'
        ? [`drive: ${summary.fileCount || 0} matching files`]
        : [`drive: ${summary.fileCount || 0} fichiers correspondants`]
    }

    return language === 'en'
      ? [`notion: ${summary.pageCount || 0} matching pages`]
      : [`notion: ${summary.pageCount || 0} pages correspondantes`]
  })

  if (lines.length === 0) {
    return language === 'en'
      ? 'I collected live app context, but I could not summarize it cleanly.'
      : "J'ai recupere du contexte live, mais je n'ai pas pu le resumer proprement."
  }

  return language === 'en'
    ? `Live connected summary: ${lines.join('; ')}.`
    : `Resume connecte en direct: ${lines.join('; ')}.`
}

function truncateSnippet(snippet: string) {
  const normalized = snippet.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 140) {
    return normalized
  }

  return `${normalized.slice(0, 137)}...`
}

function formatGmailMessageLine(
  message: NonNullable<SourceMetadataSummary['messages']>[number],
  index: number,
  language: 'fr' | 'en'
) {
  const sender = (message.from || (language === 'en' ? 'Unknown sender' : 'Expediteur inconnu')).trim()
  const subject = (message.subject || (language === 'en' ? 'No subject' : 'Sans objet')).trim()
  const preview = truncateSnippet(message.snippet || '')
  const status = message.unread
    ? language === 'en'
      ? 'unread'
      : 'non lu'
    : language === 'en'
      ? 'read'
      : 'lu'

  return `${index + 1}. ${sender} | ${subject} | ${status}${preview ? ` | ${preview}` : ''}`
}

export function buildDeterministicConnectedResponse(
  userInput: string,
  result: ConnectedWorkspaceFallbackInput,
  language: 'fr' | 'en' = 'fr'
) {
  const normalized = normalizeInput(userInput)
  const summaries = Array.isArray(result.metadata.connectedContextSummary)
    ? result.metadata.connectedContextSummary as SourceMetadataSummary[]
    : []
  const gmailSummary = summaries.find((summary) => summary.source === 'gmail')

  if (!gmailSummary) {
    return null
  }

  const messages = Array.isArray(gmailSummary.messages) ? gmailSummary.messages : []
  const unreadMessages = messages.filter((message) => message.unread)
  const asksCount = /\b(combien|how many)\b/.test(normalized)
  const asksUnread = /\b(non lu|unread)\b/.test(normalized)
  const asksDetails =
    /\b(detaille|detailles|detailler|decris|decrire|parle de quoi|de quoi|a quoi correspond|correspond|corresponds|quel message|quel est|c est quoi|cest quoi)\b/.test(normalized)

  if (asksUnread) {
    if (unreadMessages.length === 0) {
      return language === 'en'
        ? 'There is no unread email in today’s inbox.'
        : "Il n'y a pas d'email non lu dans la boite de reception d'aujourd'hui."
    }

    if (unreadMessages.length === 1) {
      return language === 'en'
        ? `The unread email is:\n${formatGmailMessageLine(unreadMessages[0], 0, language)}`
        : `Le message non lu est:\n${formatGmailMessageLine(unreadMessages[0], 0, language)}`
    }

    return language === 'en'
      ? `The unread emails are:\n${unreadMessages.map((message, index) => formatGmailMessageLine(message, index, language)).join('\n')}`
      : `Les messages non lus sont:\n${unreadMessages.map((message, index) => formatGmailMessageLine(message, index, language)).join('\n')}`
  }

  if (asksDetails) {
    if (messages.length === 0) {
      return language === 'en'
        ? 'I do not have any matching email to detail right now.'
        : "Je n'ai pas d'email correspondant a detailler pour le moment."
    }

    return language === 'en'
      ? `Here are today’s emails:\n${messages.map((message, index) => formatGmailMessageLine(message, index, language)).join('\n')}`
      : `Voici les emails d'aujourd'hui:\n${messages.map((message, index) => formatGmailMessageLine(message, index, language)).join('\n')}`
  }

  if (asksCount) {
    return language === 'en'
      ? `${gmailSummary.messageCount || 0} email(s) arrived today, including ${gmailSummary.unreadCount || 0} unread.`
      : `${gmailSummary.messageCount || 0} email(s) sont arrives aujourd'hui, dont ${gmailSummary.unreadCount || 0} non lus.`
  }

  return null
}
