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
  events?: Array<{
    title?: string
    startTime?: string | null
    endTime?: string | null
    attendees?: string[]
    location?: string | null
    meetLink?: string | null
    status?: string | null
  }>
  availability?: Array<{
    startTime?: string
    endTime?: string
  }>
  fileCount?: number
  files?: Array<{
    name?: string
    mimeType?: string
    modifiedTime?: string | null
    owners?: string[]
    webViewLink?: string | null
  }>
  pageCount?: number
  pages?: Array<{
    title?: string
    lastEditedTime?: string | null
    preview?: string
    url?: string | null
  }>
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

function formatCalendarEventLine(
  event: NonNullable<SourceMetadataSummary['events']>[number],
  index: number,
  language: 'fr' | 'en'
) {
  const title = event.title || (language === 'en' ? 'Untitled event' : 'Evenement sans titre')
  const start = event.startTime || (language === 'en' ? 'unknown start' : 'debut inconnu')
  const end = event.endTime || (language === 'en' ? 'unknown end' : 'fin inconnue')
  const attendees = Array.isArray(event.attendees) ? event.attendees.filter(Boolean) : []
  const location = event.location?.trim() || ''
  const meetLink = event.meetLink?.trim() || ''

  return `${index + 1}. ${title} | ${start} -> ${end}${attendees.length > 0 ? ` | ${attendees.join(', ')}` : ''}${location ? ` | ${location}` : ''}${meetLink ? ` | ${meetLink}` : ''}`
}

function formatAvailabilityWindowLine(
  window: NonNullable<SourceMetadataSummary['availability']>[number],
  index: number
) {
  return `${index + 1}. ${window.startTime || '-'} -> ${window.endTime || '-'}`
}

function formatDriveFileLine(
  file: NonNullable<SourceMetadataSummary['files']>[number],
  index: number,
  language: 'fr' | 'en'
) {
  const name = file.name || (language === 'en' ? 'Untitled file' : 'Fichier sans nom')
  const mimeType = file.mimeType || 'application/octet-stream'
  const owners = Array.isArray(file.owners) ? file.owners.filter(Boolean) : []
  const modified = file.modifiedTime || (language === 'en' ? 'unknown date' : 'date inconnue')
  const link = file.webViewLink?.trim() || ''

  return `${index + 1}. ${name} | ${mimeType} | ${modified}${owners.length > 0 ? ` | ${owners.join(', ')}` : ''}${link ? ` | ${link}` : ''}`
}

function formatNotionPageLine(
  page: NonNullable<SourceMetadataSummary['pages']>[number],
  index: number,
  language: 'fr' | 'en'
) {
  const title = page.title || (language === 'en' ? 'Untitled page' : 'Page sans titre')
  const edited = page.lastEditedTime || (language === 'en' ? 'unknown date' : 'date inconnue')
  const preview = truncateSnippet(page.preview || '')
  const url = page.url?.trim() || ''

  return `${index + 1}. ${title} | ${edited}${preview ? ` | ${preview}` : ''}${url ? ` | ${url}` : ''}`
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
  const calendarSummary = summaries.find((summary) => summary.source === 'calendar')
  const driveSummary = summaries.find((summary) => summary.source === 'google_drive')
  const notionSummary = summaries.find((summary) => summary.source === 'notion')

  const asksCount = /\b(combien|how many)\b/.test(normalized)
  const asksUnread = /\b(non lu|unread)\b/.test(normalized)
  const asksDetails =
    /\b(detaille|detailles|detailler|decris|decrire|parle de quoi|de quoi|a quoi correspond|correspond|corresponds|quel message|quel est|c est quoi|cest quoi)\b/.test(normalized)
  const asksAvailability = /\b(dispo|disponibilite|disponibilites|availability|free time|free slots|creneaux|slots|libre)\b/.test(normalized)
  const asksNext = /\b(prochain|prochaine|next)\b/.test(normalized)
  const asksFiles = /\b(fichier|fichiers|file|files|drive|document|documents|doc|docs)\b/.test(normalized)
  const asksPages = /\b(page|pages|notion|wiki)\b/.test(normalized)
  const requestHasSingleSource = result.request.sources.length === 1
  const shouldUseGmailContext =
    Boolean(gmailSummary) &&
    (result.request.sources.includes('gmail') && (requestHasSingleSource || /gmail|mail|mails|email|emails|message|messages/.test(normalized)))
  const shouldUseCalendarContext =
    Boolean(calendarSummary) &&
    (result.request.sources.includes('calendar') && (requestHasSingleSource || /calendar|agenda|calendrier|meeting|meetings|reunion|rdv|event|events/.test(normalized)))
  const shouldUseDriveContext =
    Boolean(driveSummary) &&
    (result.request.sources.includes('google_drive') && (requestHasSingleSource || asksFiles))
  const shouldUseNotionContext =
    Boolean(notionSummary) &&
    (result.request.sources.includes('notion') && (requestHasSingleSource || asksPages))

  if (shouldUseGmailContext && gmailSummary) {
    const messages = Array.isArray(gmailSummary.messages) ? gmailSummary.messages : []
    const unreadMessages = messages.filter((message) => message.unread)

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
  }

  if (shouldUseCalendarContext && calendarSummary) {
    const events = Array.isArray(calendarSummary.events) ? calendarSummary.events : []
    const availability = Array.isArray(calendarSummary.availability) ? calendarSummary.availability : []

    if (asksAvailability) {
      if (availability.length === 0) {
        return language === 'en'
          ? 'I do not see any free slot in the loaded calendar window.'
          : "Je ne vois pas de creneau libre dans la fenetre d'agenda chargee."
      }

      return language === 'en'
        ? `Available time windows:\n${availability.map((window, index) => formatAvailabilityWindowLine(window, index)).join('\n')}`
        : `Creneaux disponibles:\n${availability.map((window, index) => formatAvailabilityWindowLine(window, index)).join('\n')}`
    }

    if (asksNext) {
      if (events.length === 0) {
        return language === 'en'
          ? 'There is no upcoming event in the loaded calendar window.'
          : "Il n'y a pas d'evenement a venir dans la fenetre d'agenda chargee."
      }

      return language === 'en'
        ? `Your next event is:\n${formatCalendarEventLine(events[0], 0, language)}`
        : `Ton prochain evenement est:\n${formatCalendarEventLine(events[0], 0, language)}`
    }

    if (asksDetails) {
      if (events.length === 0) {
        return language === 'en'
          ? 'I do not have any matching calendar event to detail right now.'
          : "Je n'ai pas d'evenement d'agenda correspondant a detailler pour le moment."
      }

      return language === 'en'
        ? `Here are the loaded calendar events:\n${events.map((event, index) => formatCalendarEventLine(event, index, language)).join('\n')}`
        : `Voici les evenements d'agenda charges:\n${events.map((event, index) => formatCalendarEventLine(event, index, language)).join('\n')}`
    }

    if (asksCount) {
      return language === 'en'
        ? `${calendarSummary.eventCount || 0} calendar event(s) are loaded.`
        : `${calendarSummary.eventCount || 0} evenement(s) d'agenda sont charges.`
    }
  }

  if (shouldUseDriveContext && driveSummary) {
    const files = Array.isArray(driveSummary.files) ? driveSummary.files : []

    if (asksDetails && asksFiles) {
      if (files.length === 0) {
        return language === 'en'
          ? 'I do not have any matching Drive file to detail right now.'
          : "Je n'ai pas de fichier Drive correspondant a detailler pour le moment."
      }

      return language === 'en'
        ? `Here are the matching Drive files:\n${files.map((file, index) => formatDriveFileLine(file, index, language)).join('\n')}`
        : `Voici les fichiers Drive correspondants:\n${files.map((file, index) => formatDriveFileLine(file, index, language)).join('\n')}`
    }

    if (asksCount && asksFiles) {
      return language === 'en'
        ? `${driveSummary.fileCount || 0} Drive file(s) match this context.`
        : `${driveSummary.fileCount || 0} fichier(s) Drive correspondent a ce contexte.`
    }
  }

  if (shouldUseNotionContext && notionSummary) {
    const pages = Array.isArray(notionSummary.pages) ? notionSummary.pages : []

    if (asksDetails && asksPages) {
      if (pages.length === 0) {
        return language === 'en'
          ? 'I do not have any matching Notion page to detail right now.'
          : "Je n'ai pas de page Notion correspondante a detailler pour le moment."
      }

      return language === 'en'
        ? `Here are the matching Notion pages:\n${pages.map((page, index) => formatNotionPageLine(page, index, language)).join('\n')}`
        : `Voici les pages Notion correspondantes:\n${pages.map((page, index) => formatNotionPageLine(page, index, language)).join('\n')}`
    }

    if (asksCount && asksPages) {
      return language === 'en'
        ? `${notionSummary.pageCount || 0} Notion page(s) match this context.`
        : `${notionSummary.pageCount || 0} page(s) Notion correspondent a ce contexte.`
    }
  }

  return null
}
