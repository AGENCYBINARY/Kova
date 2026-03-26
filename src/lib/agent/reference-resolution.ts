import type { AgentProposal } from '@/lib/agent/v1'

interface GmailSummaryItem {
  messageId?: string
  threadId?: string | null
  from?: string
  fromEmail?: string | null
  subject?: string
  snippet?: string
  unread?: boolean
  labelIds?: string[]
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
  parentIds?: string[]
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

interface NotionDatabaseSummaryItem {
  databaseId?: string
  title?: string
  lastEditedTime?: string | null
  url?: string | null
}

interface SourceMetadataSummary {
  source?: string
  messages?: GmailSummaryItem[]
  events?: CalendarSummaryItem[]
  files?: DriveSummaryItem[]
  docs?: DocSummaryItem[]
  pages?: NotionSummaryItem[]
  databases?: NotionDatabaseSummaryItem[]
}

interface RankedCandidate<T> {
  item: T
  score: number
}

interface ExplicitSelection {
  source: ReferenceDisambiguation['source']
  field: string
  id: string
}

export interface ReferenceDisambiguation {
  actionType: AgentProposal['type']
  source: 'gmail' | 'calendar' | 'google_drive' | 'google_docs' | 'notion'
  field: string
  question: string
  options: Array<{
    id: string
    label: string
  }>
}

export interface ResolveActionReferencesResult {
  proposals: AgentProposal[]
  disambiguations: ReferenceDisambiguation[]
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
  'message', 'messages', 'thread', 'threads', 'calendar', 'agenda', 'calendrier', 'event', 'events', 'meeting',
  'meetings', 'doc', 'docs', 'document', 'documents', 'drive', 'file', 'files', 'fichier', 'fichiers', 'page',
  'pages', 'notion', 'database', 'databases', 'base', 'bases', 'donnees', 'update', 'delete', 'remove', 'reply',
  'reponds', 'repondre', 'supprime', 'supprimer', 'mets', 'mettre', 'jour', 'modifie', 'modifier', 'edite',
  'editer', 'change', 'changer', 'latest', 'last', 'recent', 'dernier', 'derniere', 'prochain', 'prochaine',
  'please', 'archive', 'archiver', 'label', 'labels', 'read', 'unread', 'lu', 'non', 'transfere', 'transferer',
  'forward', 'share', 'partage', 'move', 'deplace', 'rename', 'renomme', 'status', 'statut', 'property', 'properties',
])

function tokenize(value: string) {
  return normalize(value)
    .replace(/\[\[kova-ref:[^\]]+\]\]/g, ' ')
    .replace(/[^a-z0-9@._ -]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !stopWords.has(token))
}

function extractExplicitSelections(value: string) {
  const matches: ExplicitSelection[] = []
  const pattern = /\[\[kova-ref:([^:\]]+):([^:\]]+):([^\]]+)\]\]/g

  let match: RegExpExecArray | null
  while ((match = pattern.exec(value)) !== null) {
    const source = match[1]
    const field = match[2]
    const id = match[3]
    if (
      (source === 'gmail' || source === 'calendar' || source === 'google_drive' || source === 'google_docs' || source === 'notion') &&
      field &&
      id
    ) {
      matches.push({
        source,
        field,
        id,
      } satisfies ExplicitSelection)
    }
  }

  return matches
}

function findExplicitSelection(
  value: string,
  source: ReferenceDisambiguation['source'],
  field: string
) {
  return extractExplicitSelections(value).find((selection) => selection.source === source && selection.field === field) || null
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
    normalized === 'database-id' ||
    normalized === 'thread-id' ||
    normalized === 'message-id' ||
    normalized === 'notion-page-id'
  )
}

function needsReferenceResolution(value: unknown, explicitReference: ExplicitSelection | null) {
  if (explicitReference) return true
  if (typeof value !== 'string') return true
  return includesPlaceholder(value) || value.trim().length === 0
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

function rankMatches<T>(items: T[], tokens: string[], fields: (item: T) => Array<string | null | undefined>) {
  return items
    .map((item) => ({
      item,
      score: scoreCandidate(fields(item), tokens),
    }))
    .sort((left, right) => right.score - left.score)
}

function getConnectedSummaries(metadata: Record<string, unknown> | undefined) {
  return Array.isArray(metadata?.connectedContextSummary)
    ? (metadata.connectedContextSummary as SourceMetadataSummary[])
    : []
}

function getSourceSummary(
  metadata: Record<string, unknown> | undefined,
  source: 'gmail' | 'calendar' | 'google_drive' | 'google_docs' | 'notion'
) {
  return getConnectedSummaries(metadata).find((summary) => summary.source === source) || null
}

function shouldDisambiguate<T>(ranked: RankedCandidate<T>[], tokens: string[]) {
  if (ranked.length <= 1) return false
  if (tokens.length === 0) return true
  const [first, second] = ranked
  if (!first || !second) return false
  return first.score > 0 && second.score > 0 && first.score - second.score <= 1
}

function buildDisambiguation<T>(params: {
  actionType: AgentProposal['type']
  source: ReferenceDisambiguation['source']
  field: string
  question: string
  ranked: RankedCandidate<T>[]
  getId: (item: T) => string | null | undefined
  format: (item: T) => string
}) {
  const options = params.ranked
    .slice(0, 3)
    .map((entry) => {
      const id = params.getId(entry.item)
      if (!id) return null
      return {
        id,
        label: params.format(entry.item),
      }
    })
    .filter((entry): entry is { id: string; label: string } => entry !== null)

  if (options.length === 0) {
    return null
  }

  return {
    actionType: params.actionType,
    source: params.source,
    field: params.field,
    question: params.question,
    options,
  } satisfies ReferenceDisambiguation
}

function resolveReplyProposal(
  proposal: AgentProposal,
  userInput: string,
  metadata: Record<string, unknown> | undefined
) {
  const gmailSummary = getSourceSummary(metadata, 'gmail')
  const messages = Array.isArray(gmailSummary?.messages) ? gmailSummary.messages : []
  if (messages.length === 0) {
    return { proposal, disambiguation: null as ReferenceDisambiguation | null }
  }

  const hasThreadId = !includesPlaceholder(proposal.parameters.threadId)
  const hasMessageId = !includesPlaceholder(proposal.parameters.messageId)
  const currentRecipients = Array.isArray(proposal.parameters.to)
    ? proposal.parameters.to.filter((value): value is string => typeof value === 'string' && value.includes('@'))
    : []
  const hasSubject = typeof proposal.parameters.subject === 'string' && proposal.parameters.subject.trim().length > 0

  if (hasThreadId && hasMessageId && currentRecipients.length > 0 && hasSubject) {
    return { proposal, disambiguation: null as ReferenceDisambiguation | null }
  }

  const explicitThreadSelection = findExplicitSelection(userInput, 'gmail', 'threadId')
  const explicitMessageSelection = findExplicitSelection(userInput, 'gmail', 'messageId')
  const explicitlyChosen =
    messages.find((message) =>
      (explicitThreadSelection && (message.threadId || message.messageId) === explicitThreadSelection.id) ||
      (explicitMessageSelection && message.messageId === explicitMessageSelection.id)
    ) || null

  if (explicitlyChosen) {
    const chosenSubject = explicitlyChosen.subject?.trim()
    const normalizedChosenSubject = chosenSubject ? normalize(chosenSubject) : ''
    const explicitReplySubject =
      !chosenSubject
        ? proposal.parameters.subject
        : normalizedChosenSubject.startsWith('re:')
          ? chosenSubject
          : `Re: ${chosenSubject}`

    return {
      proposal: {
        ...proposal,
        parameters: {
          ...proposal.parameters,
          threadId: explicitlyChosen.threadId || explicitlyChosen.messageId,
          messageId: explicitlyChosen.messageId,
          to: currentRecipients.length > 0
            ? currentRecipients
            : explicitlyChosen.fromEmail
              ? [explicitlyChosen.fromEmail]
              : proposal.parameters.to,
          subject: hasSubject ? proposal.parameters.subject : explicitReplySubject,
        },
        confidenceScore: Math.max(proposal.confidenceScore, 0.95),
      },
      disambiguation: null as ReferenceDisambiguation | null,
    }
  }

  const tokens = tokenize(userInput)
  const ranked = rankMatches(messages, tokens, (message) => [message.from, message.fromEmail, message.subject, message.snippet])
  if (shouldDisambiguate(ranked, tokens)) {
    return {
      proposal,
      disambiguation: buildDisambiguation({
        actionType: proposal.type,
        source: 'gmail',
        field: 'threadId',
        question: 'Plusieurs threads Gmail correspondent. Lequel veux-tu utiliser ?',
        ranked,
        getId: (item) => item.threadId || item.messageId,
        format: (item) => `${item.from || 'Expéditeur inconnu'} | ${item.subject || 'Sans objet'}${item.unread ? ' | non lu' : ''}`,
      }),
    }
  }

  const chosen = ranked[0]?.item || messages[0]
  if (!chosen) {
    return { proposal, disambiguation: null as ReferenceDisambiguation | null }
  }

  const subject = chosen.subject?.trim()
  const normalizedSubject = subject ? normalize(subject) : ''
  const replySubject = !subject ? proposal.parameters.subject : normalizedSubject.startsWith('re:') ? subject : `Re: ${subject}`

  return {
    proposal: {
      ...proposal,
      parameters: {
        ...proposal.parameters,
        threadId: hasThreadId ? proposal.parameters.threadId : chosen.threadId || chosen.messageId,
        messageId: hasMessageId ? proposal.parameters.messageId : chosen.messageId,
        to: currentRecipients.length > 0 ? currentRecipients : chosen.fromEmail ? [chosen.fromEmail] : proposal.parameters.to,
        subject: hasSubject ? proposal.parameters.subject : replySubject,
      },
      confidenceScore: Math.max(proposal.confidenceScore, ranked[0] && ranked[0].score > 0 ? 0.92 : 0.84),
    },
    disambiguation: null as ReferenceDisambiguation | null,
  }
}

function resolveGmailMessageProposal(
  proposal: AgentProposal,
  userInput: string,
  metadata: Record<string, unknown> | undefined,
  options: {
    field: 'threadId' | 'messageId'
    question: string
  }
) {
  const gmailSummary = getSourceSummary(metadata, 'gmail')
  const messages = Array.isArray(gmailSummary?.messages) ? gmailSummary.messages : []
  const explicitReference = findExplicitSelection(userInput, 'gmail', options.field)
  if (messages.length === 0 || !needsReferenceResolution(proposal.parameters[options.field], explicitReference)) {
    return { proposal, disambiguation: null as ReferenceDisambiguation | null }
  }

  if (explicitReference) {
    const chosen = messages.find((message) =>
      (options.field === 'threadId' ? (message.threadId || message.messageId) : message.messageId) === explicitReference.id
    )

    if (chosen) {
      return {
        proposal: {
          ...proposal,
          parameters: {
            ...proposal.parameters,
            [options.field]: options.field === 'threadId' ? chosen.threadId || chosen.messageId : chosen.messageId,
            ...(proposal.type === 'forward_email' && chosen.threadId ? { threadId: chosen.threadId } : {}),
          },
          confidenceScore: Math.max(proposal.confidenceScore, 0.97),
        },
        disambiguation: null as ReferenceDisambiguation | null,
      }
    }
  }

  const tokens = tokenize(userInput)
  const ranked = rankMatches(messages, tokens, (message) => [message.from, message.fromEmail, message.subject, message.snippet])
  if (shouldDisambiguate(ranked, tokens)) {
    return {
      proposal,
      disambiguation: buildDisambiguation({
        actionType: proposal.type,
        source: 'gmail',
        field: options.field,
        question: options.question,
        ranked,
        getId: (item) => options.field === 'threadId' ? item.threadId || item.messageId : item.messageId,
        format: (item) => `${item.from || 'Expéditeur inconnu'} | ${item.subject || 'Sans objet'}${item.unread ? ' | non lu' : ''}`,
      }),
    }
  }

  const chosen = ranked[0]?.item || messages[0]
  if (!chosen) {
    return { proposal, disambiguation: null as ReferenceDisambiguation | null }
  }

  return {
    proposal: {
      ...proposal,
      parameters: {
        ...proposal.parameters,
        [options.field]: options.field === 'threadId' ? chosen.threadId || chosen.messageId : chosen.messageId,
        ...(proposal.type === 'forward_email' && chosen.threadId ? { threadId: chosen.threadId } : {}),
      },
      confidenceScore: Math.max(proposal.confidenceScore, ranked[0] && ranked[0].score > 0 ? 0.9 : 0.82),
    },
    disambiguation: null as ReferenceDisambiguation | null,
  }
}

function resolveCalendarProposal(
  proposal: AgentProposal,
  userInput: string,
  metadata: Record<string, unknown> | undefined
) {
  const calendarSummary = getSourceSummary(metadata, 'calendar')
  const events = Array.isArray(calendarSummary?.events) ? calendarSummary.events : []
  const explicitReference = findExplicitSelection(userInput, 'calendar', 'eventId')
  if (events.length === 0 || !needsReferenceResolution(proposal.parameters.eventId, explicitReference)) {
    return { proposal, disambiguation: null as ReferenceDisambiguation | null }
  }

  if (explicitReference) {
    const chosen = events.find((event) => event.eventId === explicitReference.id)
    if (chosen?.eventId) {
      return {
        proposal: {
          ...proposal,
          parameters: {
            ...proposal.parameters,
            eventId: chosen.eventId,
          },
          confidenceScore: Math.max(proposal.confidenceScore, 0.97),
        },
        disambiguation: null as ReferenceDisambiguation | null,
      }
    }
  }

  const tokens = tokenize(userInput)
  const ranked = rankMatches(events, tokens, (event) => [event.title, event.location, ...(Array.isArray(event.attendees) ? event.attendees : [])])
  if (shouldDisambiguate(ranked, tokens)) {
    return {
      proposal,
      disambiguation: buildDisambiguation({
        actionType: proposal.type,
        source: 'calendar',
        field: 'eventId',
        question: 'Plusieurs événements correspondent. Lequel veux-tu modifier ?',
        ranked,
        getId: (item) => item.eventId,
        format: (item) => `${item.title || 'Événement'} | ${item.startTime || 'heure inconnue'}`,
      }),
    }
  }

  const chosen = ranked[0]?.item || events[0]
  if (!chosen?.eventId) {
    return { proposal, disambiguation: null as ReferenceDisambiguation | null }
  }

  return {
    proposal: {
      ...proposal,
      parameters: {
        ...proposal.parameters,
        eventId: chosen.eventId,
      },
      confidenceScore: Math.max(proposal.confidenceScore, ranked[0] && ranked[0].score > 0 ? 0.92 : 0.83),
    },
    disambiguation: null as ReferenceDisambiguation | null,
  }
}

function resolveDocProposal(
  proposal: AgentProposal,
  userInput: string,
  metadata: Record<string, unknown> | undefined
) {
  const docSummary = getSourceSummary(metadata, 'google_docs')
  const docs = Array.isArray(docSummary?.docs) ? docSummary.docs : []
  const explicitReference = findExplicitSelection(userInput, 'google_docs', 'documentId')
  if (docs.length === 0 || !needsReferenceResolution(proposal.parameters.documentId, explicitReference)) {
    return { proposal, disambiguation: null as ReferenceDisambiguation | null }
  }

  if (explicitReference) {
    const chosen = docs.find((doc) => doc.documentId === explicitReference.id)
    if (chosen?.documentId) {
      return {
        proposal: {
          ...proposal,
          parameters: {
            ...proposal.parameters,
            documentId: chosen.documentId,
          },
          confidenceScore: Math.max(proposal.confidenceScore, 0.97),
        },
        disambiguation: null as ReferenceDisambiguation | null,
      }
    }
  }

  const tokens = tokenize(userInput)
  const ranked = rankMatches(docs, tokens, (doc) => [doc.title, doc.preview, doc.webViewLink])
  if (shouldDisambiguate(ranked, tokens)) {
    return {
      proposal,
      disambiguation: buildDisambiguation({
        actionType: proposal.type,
        source: 'google_docs',
        field: 'documentId',
        question: 'Plusieurs Google Docs correspondent. Lequel veux-tu mettre à jour ?',
        ranked,
        getId: (item) => item.documentId,
        format: (item) => `${item.title || 'Document'}${item.modifiedTime ? ` | ${item.modifiedTime}` : ''}`,
      }),
    }
  }

  const chosen = ranked[0]?.item || docs[0]
  if (!chosen?.documentId) {
    return { proposal, disambiguation: null as ReferenceDisambiguation | null }
  }

  return {
    proposal: {
      ...proposal,
      parameters: {
        ...proposal.parameters,
        documentId: chosen.documentId,
      },
      confidenceScore: Math.max(proposal.confidenceScore, ranked[0] && ranked[0].score > 0 ? 0.9 : 0.82),
    },
    disambiguation: null as ReferenceDisambiguation | null,
  }
}

function resolveDriveProposal(
  proposal: AgentProposal,
  userInput: string,
  metadata: Record<string, unknown> | undefined
) {
  const driveSummary = getSourceSummary(metadata, 'google_drive')
  const files = Array.isArray(driveSummary?.files) ? driveSummary.files : []
  const explicitReference = findExplicitSelection(userInput, 'google_drive', 'fileId')
  if (files.length === 0 || !needsReferenceResolution(proposal.parameters.fileId, explicitReference)) {
    return { proposal, disambiguation: null as ReferenceDisambiguation | null }
  }

  if (explicitReference) {
    const chosen = files.find((file) => file.fileId === explicitReference.id)
    if (chosen?.fileId) {
      return {
        proposal: {
          ...proposal,
          parameters: {
            ...proposal.parameters,
            fileId: chosen.fileId,
          },
          confidenceScore: Math.max(proposal.confidenceScore, 0.97),
        },
        disambiguation: null as ReferenceDisambiguation | null,
      }
    }
  }

  const tokens = tokenize(userInput)
  const ranked = rankMatches(files, tokens, (file) => [file.name, file.mimeType, file.webViewLink, ...(file.owners || [])])
  if (shouldDisambiguate(ranked, tokens)) {
    return {
      proposal,
      disambiguation: buildDisambiguation({
        actionType: proposal.type,
        source: 'google_drive',
        field: 'fileId',
        question: 'Plusieurs fichiers Drive correspondent. Lequel veux-tu utiliser ?',
        ranked,
        getId: (item) => item.fileId,
        format: (item) => `${item.name || 'Fichier'} | ${item.mimeType || 'type inconnu'}`,
      }),
    }
  }

  const chosen = ranked[0]?.item || files[0]
  if (!chosen?.fileId) {
    return { proposal, disambiguation: null as ReferenceDisambiguation | null }
  }

  return {
    proposal: {
      ...proposal,
      parameters: {
        ...proposal.parameters,
        fileId: chosen.fileId,
      },
      confidenceScore: Math.max(proposal.confidenceScore, ranked[0] && ranked[0].score > 0 ? 0.9 : 0.82),
    },
    disambiguation: null as ReferenceDisambiguation | null,
  }
}

function resolveNotionPageProposal(
  proposal: AgentProposal,
  userInput: string,
  metadata: Record<string, unknown> | undefined
) {
  const notionSummary = getSourceSummary(metadata, 'notion')
  const pages = Array.isArray(notionSummary?.pages) ? notionSummary.pages : []
  const explicitReference = findExplicitSelection(userInput, 'notion', 'pageId')
  if (pages.length === 0 || !needsReferenceResolution(proposal.parameters.pageId, explicitReference)) {
    return { proposal, disambiguation: null as ReferenceDisambiguation | null }
  }

  if (explicitReference) {
    const chosen = pages.find((page) => page.pageId === explicitReference.id)
    if (chosen?.pageId) {
      return {
        proposal: {
          ...proposal,
          parameters: {
            ...proposal.parameters,
            pageId: chosen.pageId,
          },
          confidenceScore: Math.max(proposal.confidenceScore, 0.97),
        },
        disambiguation: null as ReferenceDisambiguation | null,
      }
    }
  }

  const tokens = tokenize(userInput)
  const ranked = rankMatches(pages, tokens, (page) => [page.title, page.preview, page.url])
  if (shouldDisambiguate(ranked, tokens)) {
    return {
      proposal,
      disambiguation: buildDisambiguation({
        actionType: proposal.type,
        source: 'notion',
        field: 'pageId',
        question: 'Plusieurs pages Notion correspondent. Laquelle veux-tu utiliser ?',
        ranked,
        getId: (item) => item.pageId,
        format: (item) => `${item.title || 'Page'}${item.preview ? ` | ${item.preview}` : ''}`,
      }),
    }
  }

  const chosen = ranked[0]?.item || pages[0]
  if (!chosen?.pageId) {
    return { proposal, disambiguation: null as ReferenceDisambiguation | null }
  }

  return {
    proposal: {
      ...proposal,
      parameters: {
        ...proposal.parameters,
        pageId: chosen.pageId,
      },
      confidenceScore: Math.max(proposal.confidenceScore, ranked[0] && ranked[0].score > 0 ? 0.9 : 0.82),
    },
    disambiguation: null as ReferenceDisambiguation | null,
  }
}

function resolveNotionDatabaseParentProposal(
  proposal: AgentProposal,
  userInput: string,
  metadata: Record<string, unknown> | undefined
) {
  const notionSummary = getSourceSummary(metadata, 'notion')
  const databases = Array.isArray(notionSummary?.databases) ? notionSummary.databases : []
  const explicitReference = findExplicitSelection(userInput, 'notion', 'parentDatabaseId')
  if (databases.length === 0 || !needsReferenceResolution(proposal.parameters.parentDatabaseId, explicitReference)) {
    return { proposal, disambiguation: null as ReferenceDisambiguation | null }
  }

  if (explicitReference) {
    const chosen = databases.find((database) => database.databaseId === explicitReference.id)
    if (chosen?.databaseId) {
      return {
        proposal: {
          ...proposal,
          parameters: {
            ...proposal.parameters,
            parentDatabaseId: chosen.databaseId,
          },
          confidenceScore: Math.max(proposal.confidenceScore, 0.97),
        },
        disambiguation: null as ReferenceDisambiguation | null,
      }
    }
  }

  const tokens = tokenize(userInput)
  const ranked = rankMatches(databases, tokens, (database) => [database.title, database.url])
  if (shouldDisambiguate(ranked, tokens)) {
    return {
      proposal,
      disambiguation: buildDisambiguation({
        actionType: proposal.type,
        source: 'notion',
        field: 'parentDatabaseId',
        question: 'Plusieurs bases Notion correspondent. Dans laquelle veux-tu créer la page ?',
        ranked,
        getId: (item) => item.databaseId,
        format: (item) => `${item.title || 'Base Notion'}${item.lastEditedTime ? ` | ${item.lastEditedTime}` : ''}`,
      }),
    }
  }

  const chosen = ranked[0]?.item || databases[0]
  if (!chosen?.databaseId) {
    return { proposal, disambiguation: null as ReferenceDisambiguation | null }
  }

  return {
    proposal: {
      ...proposal,
      parameters: {
        ...proposal.parameters,
        parentDatabaseId: chosen.databaseId,
      },
      confidenceScore: Math.max(proposal.confidenceScore, ranked[0] && ranked[0].score > 0 ? 0.9 : 0.82),
    },
    disambiguation: null as ReferenceDisambiguation | null,
  }
}

export function resolveActionReferencesDetailed(params: {
  proposals: AgentProposal[]
  userInput: string
  connectedContextMetadata?: Record<string, unknown>
}): ResolveActionReferencesResult {
  const disambiguations: ReferenceDisambiguation[] = []

  const proposals = params.proposals.map((proposal) => {
    if (proposal.type === 'reply_to_email') {
      const result = resolveReplyProposal(proposal, params.userInput, params.connectedContextMetadata)
      if (result.disambiguation) disambiguations.push(result.disambiguation)
      return result.proposal
    }

    if (
      proposal.type === 'archive_gmail_thread' ||
      proposal.type === 'label_gmail_thread' ||
      proposal.type === 'mark_gmail_thread_read' ||
      proposal.type === 'mark_gmail_thread_unread' ||
      proposal.type === 'star_gmail_thread' ||
      proposal.type === 'unstar_gmail_thread' ||
      proposal.type === 'trash_gmail_thread'
    ) {
      const result = resolveGmailMessageProposal(proposal, params.userInput, params.connectedContextMetadata, {
        field: 'threadId',
        question: 'Plusieurs threads Gmail correspondent. Lequel veux-tu utiliser ?',
      })
      if (result.disambiguation) disambiguations.push(result.disambiguation)
      return result.proposal
    }

    if (proposal.type === 'forward_email') {
      const result = resolveGmailMessageProposal(proposal, params.userInput, params.connectedContextMetadata, {
        field: 'messageId',
        question: 'Plusieurs emails Gmail correspondent. Lequel veux-tu transférer ?',
      })
      if (result.disambiguation) disambiguations.push(result.disambiguation)
      return result.proposal
    }

    if (proposal.type === 'update_calendar_event' || proposal.type === 'delete_calendar_event') {
      const result = resolveCalendarProposal(proposal, params.userInput, params.connectedContextMetadata)
      if (result.disambiguation) disambiguations.push(result.disambiguation)
      return result.proposal
    }

    if (proposal.type === 'update_google_doc') {
      const result = resolveDocProposal(proposal, params.userInput, params.connectedContextMetadata)
      if (result.disambiguation) disambiguations.push(result.disambiguation)
      return result.proposal
    }

    if (
      proposal.type === 'delete_google_drive_file' ||
      proposal.type === 'move_google_drive_file' ||
      proposal.type === 'rename_google_drive_file' ||
      proposal.type === 'share_google_drive_file' ||
      proposal.type === 'copy_google_drive_file' ||
      proposal.type === 'unshare_google_drive_file'
    ) {
      const result = resolveDriveProposal(proposal, params.userInput, params.connectedContextMetadata)
      if (result.disambiguation) disambiguations.push(result.disambiguation)
      return result.proposal
    }

    if (proposal.type === 'update_notion_page' || proposal.type === 'update_notion_page_properties') {
      const result = resolveNotionPageProposal(proposal, params.userInput, params.connectedContextMetadata)
      if (result.disambiguation) disambiguations.push(result.disambiguation)
      return result.proposal
    }

    if (proposal.type === 'create_notion_page' && includesPlaceholder(proposal.parameters.parentDatabaseId)) {
      const result = resolveNotionDatabaseParentProposal(proposal, params.userInput, params.connectedContextMetadata)
      if (result.disambiguation) disambiguations.push(result.disambiguation)
      return result.proposal
    }

    return proposal
  })

  return {
    proposals,
    disambiguations,
  }
}

export function resolveActionReferences(params: {
  proposals: AgentProposal[]
  userInput: string
  connectedContextMetadata?: Record<string, unknown>
}) {
  return resolveActionReferencesDetailed(params).proposals
}
