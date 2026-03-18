import type { GmailMessageSummary } from '@/lib/integrations/google'

function formatSender(sender: string) {
  return sender.replace(/\s+/g, ' ').trim()
}

function truncateSnippet(snippet: string, maxLength = 160) {
  const normalized = snippet.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength - 3)}...`
}

function formatMessageLine(message: GmailMessageSummary) {
  const unreadTag = message.unread ? 'non lu' : 'lu'
  const subject = message.subject || '(sans objet)'
  const sender = formatSender(message.from || 'Expediteur inconnu')
  const preview = truncateSnippet(message.snippet || '')

  return `- ${sender} | ${subject} | ${unreadTag}${preview ? ` | ${preview}` : ''}`
}

export function buildGmailTodayContext(messages: GmailMessageSummary[], connectedAccount: string | null) {
  const unreadCount = messages.filter((message) => message.unread).length

  return [
    'Live workspace context:',
    `- Source: Gmail inbox messages received today${connectedAccount ? ` for ${connectedAccount}` : ''}`,
    `- Message count today: ${messages.length}`,
    `- Unread count today: ${unreadCount}`,
    messages.length > 0 ? '- Messages:' : '- Messages: none',
    ...messages.map(formatMessageLine),
    'Instruction: answer directly from this live context. Do not propose an action unless the user explicitly asks you to send, draft, schedule, create, or update something.',
  ].join('\n')
}

export function buildGmailTodaySummaryFallback(params: {
  messages: GmailMessageSummary[]
  connectedAccount: string | null
  language?: 'fr' | 'en'
}) {
  const language = params.language || 'fr'
  const unreadMessages = params.messages.filter((message) => message.unread)
  const leadingMessages = params.messages.slice(0, 5)

  if (params.messages.length === 0) {
    return language === 'en'
      ? `No email has arrived today${params.connectedAccount ? ` on ${params.connectedAccount}` : ''}.`
      : `Aucun email n'est arrive aujourd'hui${params.connectedAccount ? ` sur ${params.connectedAccount}` : ''}.`
  }

  const intro =
    language === 'en'
      ? `${params.messages.length} email(s) arrived today${params.connectedAccount ? ` on ${params.connectedAccount}` : ''}, including ${unreadMessages.length} unread.`
      : `${params.messages.length} email(s) sont arrives aujourd'hui${params.connectedAccount ? ` sur ${params.connectedAccount}` : ''}, dont ${unreadMessages.length} non lus.`

  const highlights = leadingMessages
    .map((message) =>
      language === 'en'
        ? `${formatSender(message.from || 'Unknown sender')} about "${message.subject || 'No subject'}"`
        : `${formatSender(message.from || 'Expediteur inconnu')} au sujet de "${message.subject || 'Sans objet'}"`
    )
    .join('; ')

  return language === 'en'
    ? `${intro} Main items: ${highlights}.`
    : `${intro} Principaux sujets: ${highlights}.`
}
