import type { AgentProposal } from '@/lib/agent/v1'

interface GmailSummaryItem {
  messageId?: string
  threadId?: string | null
  from?: string
  fromEmail?: string | null
  subject?: string
  snippet?: string
  unread?: boolean
}

interface CalendarSummaryItem {
  eventId?: string
  title?: string
  startTime?: string | null
  endTime?: string | null
  attendees?: string[]
  location?: string | null
  meetLink?: string | null
  status?: string | null
}

interface DriveSummaryItem {
  fileId?: string
  name?: string
  mimeType?: string
  modifiedTime?: string | null
  owners?: string[]
  webViewLink?: string | null
}

interface DocSummaryItem {
  documentId?: string
  title?: string
  modifiedTime?: string | null
  preview?: string
  webViewLink?: string | null
}

interface NotionSummaryItem {
  pageId?: string
  title?: string
  lastEditedTime?: string | null
  preview?: string
  url?: string | null
}

interface SourceMetadataSummary {
  source?: string
  messages?: GmailSummaryItem[]
  events?: CalendarSummaryItem[]
  files?: DriveSummaryItem[]
  docs?: DocSummaryItem[]
  pages?: NotionSummaryItem[]
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

const stopWords = new Set([
  'a', 'au', 'aux', 'avec', 'ce', 'cet', 'cette', 'ces', 'dans', 'de', 'des', 'du', 'en', 'et', 'for', 'from',
  'i', 'il', 'ils', 'je', 'la', 'le', 'les', 'ma', 'mes', 'mon', 'my', 'nos', 'notre', 'ou', 'par', 'pour', 'sur',
  'ta', 'tes', 'the', 'this', 'to', 'ton', 'tous', 'toutes', 'moi', 'mail', 'mails', 'email', 'emails', 'gmail',
  'message', 'messages', 'calendar', 'agenda', 'calendrier', 'event', 'events', 'meeting', 'meetings', 'doc', 'docs',
  'document', 'documents', 'drive', 'file', 'files', 'fichier', 'fichiers', 'page', 'pages', 'notion', 'update',
  'delete', 'remove', 'reply', 'reponds', 'repondre', 'supprime', 'supprimer', 'mets', 'mettre', 'jour', 'modifie',
  'modifier', 'edite', 'editer', 'change', 'changer', 'latest', 'last', 'recent', 'dernier', 'derniere', 'prochain',
  'prochaine', 'ce', 'cette', 'the', 'please',
])

function tokenize(value: string) {
  return normalize(value)
    .replace(/[^a-z0-9@._ -]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !stopWords.has(token))
}

function includesPlaceholder(value: unknown) {
  if (typeof value !== 'string') return true
  const normalized = normalize(value.trim())
  if (!normalized) return true

  return (
    normalized.includes('example') ||
    normalized.includes('placeholder') ||
    normalized === 'event-id' ||
    normalized === 'document-id' ||
    normalized === 'file-id' ||
    normalized === 'page-id' ||
    normalized === 'thread-id' ||
    normalized === 'message-id' ||
    normalized === 'notion-page-id'
  )
}

function scoreCandidate(haystacks: Array<string | null | undefined>, tokens: string[]) {
  if (tokens.length === 0) return 0
  const text = normalize(haystacks.filter(Boolean).join(' '))
  let score = 0
  for (const token of tokens) {
    if (text.includes(token)) {
      score += token.length > 5 ? 2 : 1
    }
  }
  return score
}

function pickBestMatch<T>(items: T[], tokens: string[], fields: (item: T) => Array<string | null | undefined>) {
  if (items.length === 0) return null
  let bestItem = items[0]
  let bestScore = scoreCandidate(fields(items[0]), tokens)

  for (const item of items.slice(1)) {
    const score = scoreCandidate(fields(item), tokens)
    if (score > bestScore) {
      bestItem = item
      bestScore = score
    }
  }

  return { item: bestItem, score: bestScore }
}

function getConnectedSummaries(metadata: Record<string, unknown> | undefined) {
  return Array.isArray(metadata?.connectedContextSummary)
    ? (metadata?.connectedContextSummary as SourceMetadataSummary[])
    : []
}

function getSourceSummary(
  metadata: Record<string, unknown> | undefined,
  source: 'gmail' | 'calendar' | 'google_drive' | 'google_docs' | 'notion'
) {
  return getConnectedSummaries(metadata).find((summary) => summary.source === source) || null
}

function resolveReplyProposal(
  proposal: AgentProposal,
  userInput: string,
  metadata: Record<string, unknown> | undefined
) {
  const gmailSummary = getSourceSummary(metadata, 'gmail')
  const messages = Array.isArray(gmailSummary?.messages) ? gmailSummary.messages : []
  if (messages.length === 0) {
    return proposal
  }

  const hasThreadId = !includesPlaceholder(proposal.parameters.threadId)
  const hasMessageId = !includesPlaceholder(proposal.parameters.messageId)
  const currentRecipients = Array.isArray(proposal.parameters.to)
    ? proposal.parameters.to.filter((value): value is string => typeof value === 'string' && value.includes('@'))
    : []
  const hasSubject = typeof proposal.parameters.subject === 'string' && proposal.parameters.subject.trim().length > 0

  if (hasThreadId && hasMessageId && currentRecipients.length > 0 && hasSubject) {
    return proposal
  }

  const tokens = tokenize(userInput)
  const match = pickBestMatch(messages, tokens, (message) => [
    message.from,
    message.fromEmail,
    message.subject,
    message.snippet,
  ])

  const chosen = match?.item || messages[0]
  if (!chosen) {
    return proposal
  }

  const subject = chosen.subject?.trim()
  const normalizedSubject = subject ? normalize(subject) : ''
  const replySubject = !subject
    ? proposal.parameters.subject
    : normalizedSubject.startsWith('re:')
      ? subject
      : `Re: ${subject}`

  return {
    ...proposal,
    parameters: {
      ...proposal.parameters,
      threadId: hasThreadId ? proposal.parameters.threadId : chosen.threadId || chosen.messageId,
      messageId: hasMessageId ? proposal.parameters.messageId : chosen.messageId,
      to: currentRecipients.length > 0
        ? currentRecipients
        : chosen.fromEmail
          ? [chosen.fromEmail]
          : proposal.parameters.to,
      subject: hasSubject ? proposal.parameters.subject : replySubject,
    },
    confidenceScore: Math.max(proposal.confidenceScore, match && match.score > 0 ? 0.92 : 0.84),
  }
}

function resolveCalendarProposal(
  proposal: AgentProposal,
  userInput: string,
  metadata: Record<string, unknown> | undefined
) {
  const calendarSummary = getSourceSummary(metadata, 'calendar')
  const events = Array.isArray(calendarSummary?.events) ? calendarSummary.events : []
  if (events.length === 0 || !includesPlaceholder(proposal.parameters.eventId)) {
    return proposal
  }

  const tokens = tokenize(userInput)
  const match = pickBestMatch(events, tokens, (event) => [
    event.title,
    event.location,
    ...(Array.isArray(event.attendees) ? event.attendees : []),
  ])
  const chosen = match?.item || events[0]
  if (!chosen?.eventId) {
    return proposal
  }

  return {
    ...proposal,
    parameters: {
      ...proposal.parameters,
      eventId: chosen.eventId,
    },
    confidenceScore: Math.max(proposal.confidenceScore, match && match.score > 0 ? 0.92 : 0.83),
  }
}

function resolveDocProposal(
  proposal: AgentProposal,
  userInput: string,
  metadata: Record<string, unknown> | undefined
) {
  const docSummary = getSourceSummary(metadata, 'google_docs')
  const docs = Array.isArray(docSummary?.docs) ? docSummary.docs : []
  if (docs.length === 0 || !includesPlaceholder(proposal.parameters.documentId)) {
    return proposal
  }

  const tokens = tokenize(userInput)
  const match = pickBestMatch(docs, tokens, (doc) => [doc.title, doc.preview])
  const chosen = match?.item || docs[0]
  if (!chosen?.documentId) {
    return proposal
  }

  return {
    ...proposal,
    parameters: {
      ...proposal.parameters,
      documentId: chosen.documentId,
    },
    confidenceScore: Math.max(proposal.confidenceScore, match && match.score > 0 ? 0.9 : 0.82),
  }
}

function resolveDriveProposal(
  proposal: AgentProposal,
  userInput: string,
  metadata: Record<string, unknown> | undefined
) {
  const driveSummary = getSourceSummary(metadata, 'google_drive')
  const files = Array.isArray(driveSummary?.files) ? driveSummary.files : []
  if (files.length === 0 || !includesPlaceholder(proposal.parameters.fileId)) {
    return proposal
  }

  const tokens = tokenize(userInput)
  const match = pickBestMatch(files, tokens, (file) => [file.name, file.mimeType, file.webViewLink])
  const chosen = match?.item || files[0]
  if (!chosen?.fileId) {
    return proposal
  }

  return {
    ...proposal,
    parameters: {
      ...proposal.parameters,
      fileId: chosen.fileId,
    },
    confidenceScore: Math.max(proposal.confidenceScore, match && match.score > 0 ? 0.9 : 0.82),
  }
}

function resolveNotionProposal(
  proposal: AgentProposal,
  userInput: string,
  metadata: Record<string, unknown> | undefined
) {
  const notionSummary = getSourceSummary(metadata, 'notion')
  const pages = Array.isArray(notionSummary?.pages) ? notionSummary.pages : []
  if (pages.length === 0 || !includesPlaceholder(proposal.parameters.pageId)) {
    return proposal
  }

  const tokens = tokenize(userInput)
  const match = pickBestMatch(pages, tokens, (page) => [page.title, page.preview, page.url])
  const chosen = match?.item || pages[0]
  if (!chosen?.pageId) {
    return proposal
  }

  return {
    ...proposal,
    parameters: {
      ...proposal.parameters,
      pageId: chosen.pageId,
    },
    confidenceScore: Math.max(proposal.confidenceScore, match && match.score > 0 ? 0.9 : 0.82),
  }
}

export function resolveActionReferences(params: {
  proposals: AgentProposal[]
  userInput: string
  connectedContextMetadata?: Record<string, unknown>
}) {
  return params.proposals.map((proposal) => {
    if (proposal.type === 'reply_to_email') {
      return resolveReplyProposal(proposal, params.userInput, params.connectedContextMetadata)
    }

    if (proposal.type === 'update_calendar_event' || proposal.type === 'delete_calendar_event') {
      return resolveCalendarProposal(proposal, params.userInput, params.connectedContextMetadata)
    }

    if (proposal.type === 'update_google_doc') {
      return resolveDocProposal(proposal, params.userInput, params.connectedContextMetadata)
    }

    if (proposal.type === 'delete_google_drive_file') {
      return resolveDriveProposal(proposal, params.userInput, params.connectedContextMetadata)
    }

    if (proposal.type === 'update_notion_page') {
      return resolveNotionProposal(proposal, params.userInput, params.connectedContextMetadata)
    }

    return proposal
  })
}
