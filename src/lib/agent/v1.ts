import { z } from 'zod'
import { analyzeUserRequest } from '@/lib/ai/client'
import {
  executiveAssistantSkills,
  resolveEnabledAssistantSkills,
  type AssistantProfile,
} from '@/lib/assistant/profile'
import { resolveActionReferencesDetailed } from '@/lib/agent/reference-resolution'
import { extractRecipientName, findContactByName, type KnownContact } from '@/lib/contacts'
import { prepareActionParameters } from '@/lib/agent/data-prep'
import { getToolByActionType, listMcpTools } from '@/lib/mcp/registry'
import { isEmailSendIntent, isReadOnlyWorkspaceQuestion } from '@/lib/workspace-context/intents'

export const agentActionTypeSchema = z.enum([
  'send_email',
  'reply_to_email',
  'forward_email',
  'archive_gmail_thread',
  'label_gmail_thread',
  'mark_gmail_thread_read',
  'mark_gmail_thread_unread',
  'create_calendar_event',
  'update_calendar_event',
  'delete_calendar_event',
  'update_notion_page',
  'update_notion_page_properties',
  'create_notion_page',
  'create_google_doc',
  'update_google_doc',
  'create_google_drive_file',
  'delete_google_drive_file',
  'move_google_drive_file',
  'rename_google_drive_file',
  'share_google_drive_file',
])

export type AgentActionType = z.infer<typeof agentActionTypeSchema>

export interface AgentProposal {
  type: AgentActionType
  title: string
  description: string
  parameters: Record<string, unknown>
  confidenceScore: number
}

export interface AgentTurnResult {
  response: string
  proposals: AgentProposal[]
}

export type AgentExecutionMode = 'ask' | 'auto'

const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,})/
const actionIntentPattern =
  /(send|email|mail|draft|reply|write|create|update|schedule|book|invite|plan|share|upload|save|store|sync|connect|disconnect|refresh|archive|label|forward|move|rename|envoie|envoyer|rédige|redige|écris|ecris|crée|cree|mets|mettre|ajoute|ajouter|planifie|programme|partage|enregistre|stocke|sauvegarde|connecte|déconnecte|deconnecte|actualise|rafraichis|archiver|transférer|transferer|deplacer|deplace|renommer|renomme|labellise|labelise)/i
const appIntentPattern =
  /(gmail|google calendar|calendar|calendrier|google meet|meet|google docs|google doc|docs|document|notion|google drive|drive|visio|réunion|reunion|dossier|folder|fichier|file|page|database|base de donnees|base de données|doc\b)/i
const greetingOnlyPattern =
  /^(bonjour|salut|hello|hey|yo|coucou|bonsoir|good morning|good evening|hi|ça va|ca va)\b[ !?.]*$/i
const conversationalPattern =
  /^(bonjour|salut|hello|hey|coucou|bonsoir|hi|parle moi|parle-moi|on peut parler|tu peux m'aider|tu peux m’aider|j'ai une question|j’ai une question|comment ca va|comment ça va|qui es tu|qui es-tu|explique moi|explique-moi|ça va|ca va)\b/i

function hasPlaceholderRecipient(parameters: Record<string, unknown>) {
  const recipients = Array.isArray(parameters.to) ? parameters.to : []
  return recipients.some(
    (value) =>
      typeof value === 'string' &&
      (value.trim().toLowerCase() === 'recipient@example.com' || value.trim().toLowerCase().endsWith('@example.com'))
  )
}

function hasPlaceholderShareRecipient(parameters: Record<string, unknown>) {
  const recipients = Array.isArray(parameters.emails) ? parameters.emails : []
  return recipients.some(
    (value) =>
      typeof value === 'string' &&
      (value.trim().toLowerCase() === 'recipient@example.com' || value.trim().toLowerCase().endsWith('@example.com'))
  )
}

function normalizeInput(input: string) {
  return input.trim().toLowerCase()
}

function requestNeedsMeetLink(input: string) {
  return /(google meet|meet|visio|visioconference|visioconférence|video|vidéo|remote|zoom|teams)/.test(
    normalizeInput(input)
  )
}

function isActionRequest(input: string) {
  const normalized = input.trim()
  if (!normalized) return false
  if (isReadOnlyWorkspaceQuestion(normalized)) return false
  return actionIntentPattern.test(normalized) || appIntentPattern.test(normalized) || emailPattern.test(normalized)
}

function isGreetingOnly(input: string) {
  return greetingOnlyPattern.test(input.trim())
}

function isConversationalInput(input: string) {
  const normalized = input.trim()
  if (!normalized) return true
  if (isGreetingOnly(normalized)) return true
  return !isActionRequest(normalized) && conversationalPattern.test(normalized)
}

function buildConversationalResponse(input: string, profile?: AssistantProfile) {
  const language = profile?.defaultLanguage || 'fr'
  const normalized = normalizeInput(input)

  if (isGreetingOnly(input)) {
    return language === 'en' ? 'Hello.' : 'Bonjour.'
  }

  if (/parle moi|parle-moi/.test(normalized)) {
    return language === 'en'
      ? 'Of course. What do you want to work through?'
      : 'Bien sûr. Tu veux qu’on travaille sur quoi ?'
  }

  if (/comment ca va|comment ça va|ca va|ça va/.test(normalized)) {
    return language === 'en'
      ? 'I am here and ready. What do you want to handle?'
      : 'Oui. Je suis prêt. Tu veux traiter quoi ?'
  }

  return language === 'en'
    ? 'Tell me what you need.'
    : 'Dis-moi ce qu’il te faut.'
}

function buildExecutiveEmailBody(input: string, profile?: AssistantProfile) {
  const signature = profile?.signatureBlock?.trim()
  const body = [
    'Bonjour,',
    '',
    input.trim(),
    '',
    'Merci,',
    signature || profile?.signatureName || 'Kova',
  ].join('\n')

  return profile?.defaultLanguage === 'en'
    ? [
        'Hello,',
        '',
        input.trim(),
        '',
        'Best regards,',
        signature || profile?.signatureName || 'Kova',
      ].join('\n')
    : body
}

function buildEmailSubject(input: string, profile?: AssistantProfile) {
  const cleaned = input.trim().replace(/\s+/g, ' ')
  if (!cleaned) {
    return profile?.defaultLanguage === 'en' ? 'Follow-up' : 'Suivi'
  }

  const subject = cleaned.length > 72 ? `${cleaned.slice(0, 69)}...` : cleaned
  return profile?.defaultLanguage === 'en' ? subject : subject
}

function buildCalendarProposal(input: string, profile?: AssistantProfile, contact?: KnownContact | null): AgentProposal {
  const now = Date.now()
  const start = new Date(now + 1000 * 60 * 60 * 24)
  const durationMinutes = profile?.meetingDefaultDurationMinutes || 30
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000)
  const inferredTitle = (() => {
    const n = normalizeInput(input)
    if (/déjeuner|dejeuner|lunch/.test(n)) return contact ? `Déjeuner avec ${contact.name}` : 'Déjeuner'
    if (/café|cafe|coffee/.test(n)) return contact ? `Café avec ${contact.name}` : 'Café'
    if (/call|appel/.test(n)) return contact ? `Call avec ${contact.name}` : 'Call'
    if (/point|sync|weekly|hebdo/.test(n)) return contact ? `Point avec ${contact.name}` : 'Point hebdo'
    if (/debrief|debriefing/.test(n)) return contact ? `Debrief avec ${contact.name}` : 'Debrief'
    if (/présentation|presentation/.test(n)) return contact ? `Présentation avec ${contact.name}` : 'Présentation'
    if (contact) return profile?.defaultLanguage === 'en' ? `Meeting with ${contact.name}` : `Rendez-vous avec ${contact.name}`
    return profile?.defaultLanguage === 'en' ? 'Meeting' : 'Rendez-vous'
  })()
  const meetingTitle = inferredTitle

  return {
    type: 'create_calendar_event',
    title: contact ? `Create meeting invite for ${contact.name}` : 'Create calendar event',
    description: 'Create a Google Calendar invite with a meeting link and attendee-ready scheduling details.',
    parameters: {
      title: meetingTitle,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      attendees: contact ? [contact.email] : [],
      createMeetLink: true,
      description:
        profile?.defaultLanguage === 'en'
          ? 'Prepared by Kova from the user request.'
          : "Préparé par Kova à partir de la demande de l'utilisateur.",
      notes:
        profile?.defaultLanguage === 'en'
          ? `Default duration: ${durationMinutes} minutes. Buffer preference: ${profile?.schedulingBufferMinutes || 0} minutes.`
          : `Duree par defaut : ${durationMinutes} minutes. Buffer prefere : ${profile?.schedulingBufferMinutes || 0} minutes.`,
    },
    confidenceScore: 0.9,
  }
}

function buildMeetingEmailFollowupProposal(
  input: string,
  contact: KnownContact | null,
  profile?: AssistantProfile
): AgentProposal {
  const language = profile?.defaultLanguage || 'fr'
  const body =
    language === 'en'
      ? [
          'Hello,',
          '',
          'Here is the meeting link: {{meet_link}}',
          '',
          input.trim(),
          '',
          'Best regards,',
          profile?.signatureBlock?.trim() || profile?.signatureName || 'Kova',
        ].join('\n')
      : [
          'Bonjour,',
          '',
          'Voici le lien de reunion : {{meet_link}}',
          '',
          input.trim(),
          '',
          'Merci,',
          profile?.signatureBlock?.trim() || profile?.signatureName || 'Kova',
        ].join('\n')

  return {
    type: 'send_email',
    title: contact ? `Send meeting link to ${contact.name}` : 'Send meeting link email',
    description: 'Send the meeting link by email after the calendar event is prepared.',
    parameters: {
      to: contact ? [contact.email] : ['recipient@example.com'],
      subject:
        language === 'en'
          ? 'Meeting link'
          : 'Lien de reunion',
      body,
      ...(contact ? { resolvedContactName: contact.name } : {}),
    },
    confidenceScore: contact ? 0.94 : 0.6,
  }
}

function buildEmailProposal(input: string, profile?: AssistantProfile): AgentProposal {
  const matchedEmail = input.match(emailPattern)?.[1]

  return {
    type: 'send_email',
    title: 'Send email draft',
    description: 'Prepare a polished Gmail message for approval and sending.',
    parameters: {
      to: matchedEmail ? [matchedEmail] : ['recipient@example.com'],
      subject: buildEmailSubject(input, profile),
      body: buildExecutiveEmailBody(input, profile),
    },
    confidenceScore: 0.87,
  }
}

function buildEmailReplyProposal(input: string, profile?: AssistantProfile): AgentProposal {
  const language = profile?.defaultLanguage || 'fr'

  return {
    type: 'reply_to_email',
    title: language === 'en' ? 'Reply to email thread' : 'Répondre au thread email',
    description:
      language === 'en'
        ? 'Prepare a reply to the relevant Gmail thread using the connected inbox context.'
        : 'Préparer une réponse au bon thread Gmail à partir du contexte connecté.',
    parameters: {
      threadId: '',
      messageId: '',
      to: [],
      subject: '',
      body: buildExecutiveEmailBody(input, profile),
    },
    confidenceScore: 0.8,
  }
}

function buildForwardEmailProposal(input: string, profile?: AssistantProfile, contact?: KnownContact | null): AgentProposal {
  return {
    type: 'forward_email',
    title: contact ? `Forward email to ${contact.name}` : 'Forward email',
    description: 'Forward the matching Gmail message to the selected recipients.',
    parameters: {
      messageId: '',
      to: contact ? [contact.email] : ['recipient@example.com'],
      note: input.trim(),
      ...(contact ? { resolvedContactName: contact.name } : {}),
    },
    confidenceScore: contact ? 0.9 : 0.72,
  }
}

function buildArchiveEmailProposal(profile?: AssistantProfile): AgentProposal {
  return {
    type: 'archive_gmail_thread',
    title: profile?.defaultLanguage === 'en' ? 'Archive Gmail thread' : 'Archiver le thread Gmail',
    description:
      profile?.defaultLanguage === 'en'
        ? 'Archive the matching Gmail thread.'
        : 'Archiver le thread Gmail correspondant.',
    parameters: {
      threadId: '',
    },
    confidenceScore: 0.82,
  }
}

function buildLabelEmailProposal(input: string, profile?: AssistantProfile): AgentProposal {
  const labelMatch = input.match(/(?:label|labels|etiquette|etiquettes|tag)\s+["“]?([^"”]+?)["”]?(?:$|[,.!?])/i)
  const label = labelMatch?.[1]?.trim() || (profile?.defaultLanguage === 'en' ? 'To review' : 'À revoir')
  return {
    type: 'label_gmail_thread',
    title: profile?.defaultLanguage === 'en' ? 'Label Gmail thread' : 'Labelliser le thread Gmail',
    description:
      profile?.defaultLanguage === 'en'
        ? 'Apply labels to the matching Gmail thread.'
        : 'Appliquer des labels au thread Gmail correspondant.',
    parameters: {
      threadId: '',
      labelNames: [label],
    },
    confidenceScore: 0.8,
  }
}

function buildMarkReadStateProposal(unread: boolean, profile?: AssistantProfile): AgentProposal {
  return {
    type: unread ? 'mark_gmail_thread_unread' : 'mark_gmail_thread_read',
    title:
      profile?.defaultLanguage === 'en'
        ? unread ? 'Mark Gmail thread unread' : 'Mark Gmail thread read'
        : unread ? 'Marquer le thread Gmail comme non lu' : 'Marquer le thread Gmail comme lu',
    description:
      profile?.defaultLanguage === 'en'
        ? unread ? 'Mark the matching Gmail thread as unread.' : 'Mark the matching Gmail thread as read.'
        : unread ? 'Marquer le thread Gmail correspondant comme non lu.' : 'Marquer le thread Gmail correspondant comme lu.',
    parameters: {
      threadId: '',
    },
    confidenceScore: 0.8,
  }
}

function buildResolvedEmailProposal(input: string, contact: KnownContact, profile?: AssistantProfile): AgentProposal {
  return {
    type: 'send_email',
    title: `Send email to ${contact.name}`,
    description: `Prepare and send an email to ${contact.name} through Gmail.`,
    parameters: {
      to: [contact.email],
      subject: buildEmailSubject(input, profile),
      body: buildExecutiveEmailBody(input, profile),
      resolvedContactName: contact.name,
    },
    confidenceScore: 0.93,
  }
}

function buildDeleteCalendarProposal(profile?: AssistantProfile): AgentProposal {
  const language = profile?.defaultLanguage || 'fr'

  return {
    type: 'delete_calendar_event',
    title: language === 'en' ? 'Delete calendar event' : 'Supprimer un événement agenda',
    description:
      language === 'en'
        ? 'Delete the matching Google Calendar event resolved from the connected calendar context.'
        : "Supprimer l'événement Google Calendar correspondant résolu depuis le contexte connecté.",
    parameters: {
      eventId: '',
    },
    confidenceScore: 0.78,
  }
}

function buildUpdateGoogleDocProposal(input: string, profile?: AssistantProfile): AgentProposal {
  const language = profile?.defaultLanguage || 'fr'

  return {
    type: 'update_google_doc',
    title: language === 'en' ? 'Update Google Doc' : 'Mettre à jour le Google Doc',
    description:
      language === 'en'
        ? 'Update the matching Google Doc with structured content.'
        : 'Mettre à jour le Google Doc correspondant avec un contenu structuré.',
    parameters: {
      documentId: '',
      content: input,
    },
    confidenceScore: 0.81,
  }
}

function buildDeleteGoogleDriveProposal(profile?: AssistantProfile): AgentProposal {
  const language = profile?.defaultLanguage || 'fr'

  return {
    type: 'delete_google_drive_file',
    title: language === 'en' ? 'Delete Drive file' : 'Supprimer le fichier Drive',
    description:
      language === 'en'
        ? 'Delete the matching Google Drive file resolved from the connected Drive context.'
        : 'Supprimer le fichier Google Drive correspondant résolu depuis le contexte connecté.',
    parameters: {
      fileId: '',
    },
    confidenceScore: 0.79,
  }
}

function buildMoveGoogleDriveProposal(input: string, profile?: AssistantProfile): AgentProposal {
  const folderMatch = input.match(/(?:dans|vers|to|into)\s+["“]?([^"”]+?)["”]?(?:$|[,.!?])/i)
  return {
    type: 'move_google_drive_file',
    title: profile?.defaultLanguage === 'en' ? 'Move Drive file' : 'Déplacer le fichier Drive',
    description:
      profile?.defaultLanguage === 'en'
        ? 'Move the matching Google Drive file to another folder.'
        : 'Déplacer le fichier Google Drive correspondant vers un autre dossier.',
    parameters: {
      fileId: '',
      destinationFolderName: folderMatch?.[1]?.trim() || (profile?.defaultLanguage === 'en' ? 'Archive' : 'Archive'),
    },
    confidenceScore: 0.8,
  }
}

function buildRenameGoogleDriveProposal(input: string, profile?: AssistantProfile): AgentProposal {
  const quoted = input.match(/["“]([^"”]+)["”]/)
  return {
    type: 'rename_google_drive_file',
    title: profile?.defaultLanguage === 'en' ? 'Rename Drive file' : 'Renommer le fichier Drive',
    description:
      profile?.defaultLanguage === 'en'
        ? 'Rename the matching Google Drive file.'
        : 'Renommer le fichier Google Drive correspondant.',
    parameters: {
      fileId: '',
      name: quoted?.[1]?.trim() || (profile?.defaultLanguage === 'en' ? 'Renamed file' : 'Fichier renommé'),
    },
    confidenceScore: 0.79,
  }
}

function buildShareGoogleDriveProposal(input: string, contact: KnownContact | null, profile?: AssistantProfile): AgentProposal {
  return {
    type: 'share_google_drive_file',
    title: profile?.defaultLanguage === 'en' ? 'Share Drive file' : 'Partager le fichier Drive',
    description:
      profile?.defaultLanguage === 'en'
        ? 'Share the matching Google Drive file.'
        : 'Partager le fichier Google Drive correspondant.',
    parameters: {
      fileId: '',
      emails: contact ? [contact.email] : ['recipient@example.com'],
      role: 'reader',
      ...(contact ? { resolvedContactName: contact.name } : {}),
    },
    confidenceScore: contact ? 0.86 : 0.68,
  }
}

function buildGoogleDocProposal(input: string, profile?: AssistantProfile): AgentProposal {
  return {
    type: 'create_google_doc',
    title: 'Create Google Doc',
    description: 'Generate a structured professional Google Doc from the request.',
    parameters: {
      title:
        profile?.defaultLanguage === 'en'
          ? 'Executive brief'
          : 'Note executive',
      sections:
        profile?.defaultLanguage === 'en'
          ? ['Executive summary', 'Details', 'Next steps']
          : ['Résumé exécutif', 'Détails', 'Prochaines étapes'],
      content: input,
      sourcePrompt: input,
    },
    confidenceScore: 0.88,
  }
}

function buildGoogleDriveProposal(input: string, profile?: AssistantProfile): AgentProposal {
  const normalized = normalizeInput(input)
  const wantsFolderOnly = /(folder|dossier)/.test(normalized) && !/(file|fichier|save|upload|enregistrer)/.test(normalized)

  return {
    type: 'create_google_drive_file',
    title: wantsFolderOnly ? 'Create Google Drive folder' : 'Save file to Google Drive',
    description: wantsFolderOnly
      ? 'Create a Google Drive folder for this workspace request.'
      : 'Create a file in Google Drive and store the generated content in the selected folder if needed.',
    parameters: wantsFolderOnly
      ? {
          name:
            profile?.defaultLanguage === 'en'
              ? 'New Drive folder'
              : 'Nouveau dossier Drive',
          mimeType: 'application/vnd.google-apps.folder',
        }
      : {
          name:
            profile?.defaultLanguage === 'en'
              ? 'Kova file'
              : 'Fichier Kova',
          content: input,
          mimeType: 'text/plain',
        },
    confidenceScore: 0.85,
  }
}

function buildNotionProposal(input: string, profile?: AssistantProfile): AgentProposal {
  const wantsUpdate = /(update|refresh|edit|modify)/.test(input)
  const targetsDatabase = /(database|base de donnees|base de données)/.test(normalizeInput(input))
  const createTitle =
    profile?.defaultLanguage === 'en'
      ? 'Operations note'
      : 'Note opérationnelle'

  return wantsUpdate
    ? {
        type: 'update_notion_page',
        title: 'Update Notion page',
        description: 'Update an existing Notion page with structured operational content.',
        parameters: {
          pageId: 'notion-page-id',
          content: input,
        },
        confidenceScore: 0.84,
      }
    : {
        type: 'create_notion_page',
        title: 'Create Notion page',
        description: 'Create a new structured Notion page from the request.',
        parameters: {
          title: createTitle,
          content: input,
          ...(targetsDatabase ? { parentDatabaseId: 'database-id' } : {}),
        },
        confidenceScore: 0.82,
      }
}

function buildNotionPropertyUpdateProposal(input: string, profile?: AssistantProfile): AgentProposal {
  const statusMatch = input.match(/(?:status|statut)\s+(?:a|à|to)?\s*["“]?([^"”.,!?]+)["”]?/i)
  const priorityMatch = input.match(/(?:priority|priorite|priorité)\s+(?:a|à|to)?\s*["“]?([^"”.,!?]+)["”]?/i)
  const properties: Record<string, unknown> = {}

  if (statusMatch?.[1]) {
    properties.Status = statusMatch[1].trim()
  }
  if (priorityMatch?.[1]) {
    properties.Priority = priorityMatch[1].trim()
  }

  return {
    type: 'update_notion_page_properties',
    title: profile?.defaultLanguage === 'en' ? 'Update Notion properties' : 'Mettre à jour les propriétés Notion',
    description:
      profile?.defaultLanguage === 'en'
        ? 'Update the matching Notion page properties.'
        : 'Mettre à jour les propriétés de la page Notion correspondante.',
    parameters: {
      pageId: 'notion-page-id',
      properties,
      content: Object.keys(properties).length === 0 ? input : '',
    },
    confidenceScore: 0.8,
  }
}

function buildDisambiguationResponse(
  questions: Array<{
    question: string
    options: Array<{ label: string }>
  }>,
  profile?: AssistantProfile
) {
  const language = profile?.defaultLanguage || 'fr'
  const lines = questions.flatMap((entry, index) => [
    `${index + 1}. ${entry.question}`,
    ...entry.options.map((option, optionIndex) => `   ${String.fromCharCode(97 + optionIndex)}. ${option.label}`),
  ])

  return language === 'en'
    ? `I found multiple possible matches.\n${lines.join('\n')}\nReply with the correct option or give me the exact name.`
    : `J’ai trouvé plusieurs correspondances possibles.\n${lines.join('\n')}\nRéponds avec la bonne option ou donne-moi le nom exact.`
}

function buildFallbackResponse(input: string): AgentTurnResult {
  return buildFallbackResponseWithContacts(input, [])
}

function buildFallbackResponseWithContacts(input: string, knownContacts: KnownContact[]): AgentTurnResult {
  return buildFallbackResponseWithContactsAndProfile(input, knownContacts)
}

function buildFallbackResponseWithContactsAndProfile(
  input: string,
  knownContacts: KnownContact[],
  assistantProfile?: AssistantProfile
): AgentTurnResult {
  const normalized = normalizeInput(input)
  const language = assistantProfile?.defaultLanguage || 'fr'
  const maybeRecipient = extractRecipientName(input)
  const knownContact = maybeRecipient ? findContactByName(maybeRecipient, knownContacts) : null
  const isMeetingRequest =
    /(calendar|calendrier|meeting|schedule|invite|appel|rdv|réunion|reunion|visio|visioconference|visioconférence|google meet|meet|zoom)/.test(normalized)
  const wantsMeetingConfirmation =
    /(confirmation|confirm|confirmer|lien|link|visio|meet|invite)/.test(normalized)
  const explicitlyWantsSeparateEmail =
    /(send an email|send email|email recap|mail recap|follow-up email|envoie un mail|envoyer un mail|envoie un email|envoyer un email|courriel distinct)/.test(normalized)
  const explicitEmailIntent = isEmailSendIntent(normalized)
  const explicitReplyIntent =
    /(reply|reponds|repondre|reponse|réponds|répondre|réponse|answer this email|reply to|reponds-lui|reponds lui)/.test(
      normalized
    )
  const explicitForwardIntent = /(forward|transfere|transferer|transmets|faire suivre)/.test(normalized)
  const archiveIntent = /(archive|archiver|range|ranger)/.test(normalized)
  const labelIntent = /(label|labels|etiquette|etiquettes|tag|tags)/.test(normalized)
  const markUnreadIntent = /(non lu|unread|marque.*non lu|mark.*unread)/.test(normalized)
  const markReadIntent = /(marque.*lu|mark.*read|\blu\b)/.test(normalized) && !markUnreadIntent
  const deleteIntent = /(delete|remove|supprime|supprimer|efface|annule|cancel)/.test(normalized)
  const updateIntent = /(update|edit|revise|rewrite|modifie|modifier|mets a jour|mettre a jour|complete|compl[eè]te)/.test(
    normalized
  )
  const moveIntent = /(move|deplace|deplacer|range dans|place dans)/.test(normalized)
  const renameIntent = /(rename|renomme|renommer)/.test(normalized)
  const shareIntent = /(share|partage|partager)/.test(normalized)
  const notionPropertiesIntent = /(status|statut|priority|priorite|priorité|property|properties|propriete|proprietes)/.test(normalized)

  if (
    isMeetingRequest &&
    deleteIntent &&
    !explicitEmailIntent
  ) {
    return {
      response:
        language === 'en'
          ? 'Event deletion ready for review.'
          : "Suppression d'événement prête à valider.",
      proposals: [buildDeleteCalendarProposal(assistantProfile)],
    }
  }

  if (
    isMeetingRequest &&
    /(gmail|email|e-mail|mail|send|envoie|envoyer|courriel|lien|link)/.test(normalized) &&
    explicitlyWantsSeparateEmail
  ) {
    const calProp = buildCalendarProposal(input, assistantProfile, knownContact)
    return {
      response:
        language === 'en'
          ? `Got it. Calendar invite${knownContact ? ` for ${knownContact.name}` : ''} + follow-up email with the meeting link.`
          : `C'est bon. J'ai préparé le RDV${knownContact ? ` avec ${knownContact.name}` : ''} et l'email avec le lien.`,
      proposals: [
        calProp,
        buildMeetingEmailFollowupProposal(input, knownContact, assistantProfile),
      ],
    }
  }

  if ((isMeetingRequest || (wantsMeetingConfirmation && knownContact)) && !explicitEmailIntent) {
    const calProp = buildCalendarProposal(input, assistantProfile, knownContact)
    const title = typeof calProp.parameters.title === 'string' ? calProp.parameters.title : ''
    return {
      response:
        language === 'en'
          ? `Done. "${title}" is ready with a Google Meet link.`
          : `C'est prêt. "${title}" avec lien Google Meet.`,
      proposals: [calProp],
    }
  }

  if (isEmailSendIntent(normalized)) {
    const matchedEmail = input.match(emailPattern)?.[1]
    if (!matchedEmail && maybeRecipient && knownContact) {
      return {
        response:
          language === 'en'
            ? `Ready to send to ${knownContact.name}.`
            : `Prêt à envoyer à ${knownContact.name}.`,
        proposals: [buildResolvedEmailProposal(input, knownContact, assistantProfile)],
      }
    }

    return {
      response:
        language === 'en'
          ? 'Email ready. Check the details and confirm.'
          : 'Email prêt. Vérifie les détails et confirme.',
      proposals: [buildEmailProposal(input, assistantProfile)],
    }
  }

  if (explicitReplyIntent && /(gmail|email|e-mail|mail|message|messages|thread)/.test(normalized)) {
    return {
      response:
        language === 'en'
          ? 'Reply draft ready. Review and confirm.'
          : 'Réponse prête. Vérifie et confirme.',
      proposals: [buildEmailReplyProposal(input, assistantProfile)],
    }
  }

  if (explicitForwardIntent && /(gmail|email|e-mail|mail|message|messages|thread)/.test(normalized)) {
    return {
      response:
        language === 'en'
          ? 'Forward is ready. Review and confirm.'
          : 'Transfert prêt. Vérifie et confirme.',
      proposals: [buildForwardEmailProposal(input, assistantProfile, knownContact)],
    }
  }

  if ((archiveIntent || labelIntent || markReadIntent || markUnreadIntent) && /(gmail|email|e-mail|mail|message|messages|thread|inbox)/.test(normalized)) {
    if (archiveIntent) {
      return {
        response:
          language === 'en'
            ? 'Archive action ready.'
            : 'Archivage prêt.',
        proposals: [buildArchiveEmailProposal(assistantProfile)],
      }
    }

    if (labelIntent) {
      return {
        response:
          language === 'en'
            ? 'Labelling action ready.'
            : 'Labellisation prête.',
        proposals: [buildLabelEmailProposal(input, assistantProfile)],
      }
    }

    return {
      response:
        language === 'en'
          ? 'Inbox status update ready.'
          : 'Mise à jour de statut inbox prête.',
      proposals: [buildMarkReadStateProposal(markUnreadIntent, assistantProfile)],
    }
  }

  if (/(google doc|google docs|doc\b|document|brief|report|summary|compte rendu|compte-rendu|rapport|note)/.test(normalized)) {
    if (updateIntent) {
      return {
        response:
          language === 'en'
            ? 'Document update ready. Review and confirm.'
            : 'Mise à jour du document prête. Vérifie et confirme.',
        proposals: [buildUpdateGoogleDocProposal(input, assistantProfile)],
      }
    }

    return {
      response:
        language === 'en'
          ? 'Document ready. Review and confirm.'
          : 'Document prêt. Vérifie et confirme.',
      proposals: [buildGoogleDocProposal(input, assistantProfile)],
    }
  }

  if (/(google drive|drive\b|dossier|folder|upload|save to drive|save in drive|enregistrer dans drive|mettre dans drive|stocke.*drive)/.test(normalized)) {
    if (deleteIntent) {
      return {
        response:
          language === 'en'
            ? 'Drive deletion ready for review.'
            : 'Suppression Drive prête à valider.',
        proposals: [buildDeleteGoogleDriveProposal(assistantProfile)],
      }
    }

    if (moveIntent) {
      return {
        response:
          language === 'en'
            ? 'Drive move ready.'
            : 'Déplacement Drive prêt.',
        proposals: [buildMoveGoogleDriveProposal(input, assistantProfile)],
      }
    }

    if (renameIntent) {
      return {
        response:
          language === 'en'
            ? 'Drive rename ready.'
            : 'Renommage Drive prêt.',
        proposals: [buildRenameGoogleDriveProposal(input, assistantProfile)],
      }
    }

    if (shareIntent) {
      return {
        response:
          language === 'en'
            ? 'Drive share ready.'
            : 'Partage Drive prêt.',
        proposals: [buildShareGoogleDriveProposal(input, knownContact, assistantProfile)],
      }
    }

    return {
      response:
        language === 'en'
          ? 'Drive action ready.'
          : 'Action Drive prête.',
      proposals: [buildGoogleDriveProposal(input, assistantProfile)],
    }
  }

  if (/(notion|wiki|database|base de donnees|base de données|workspace|page)/.test(normalized)) {
    if (notionPropertiesIntent && updateIntent) {
      return {
        response:
          language === 'en'
            ? 'Notion property update ready. Review and confirm.'
            : 'Mise à jour des propriétés Notion prête. Vérifie et confirme.',
        proposals: [buildNotionPropertyUpdateProposal(input, assistantProfile)],
      }
    }

    return {
      response:
        language === 'en'
          ? 'Notion page ready. Review and confirm.'
          : 'Page Notion prête. Vérifie et confirme.',
      proposals: [buildNotionProposal(input, assistantProfile)],
    }
  }

  return {
    response:
      language === 'en'
        ? 'Tell me what you need — Gmail, Calendar, Drive, Notion, or Docs.'
        : 'Dis-moi ce qu’il te faut — Gmail, Agenda, Drive, Notion ou Docs.',
    proposals: [],
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
  const enabledSkillIds = resolveEnabledAssistantSkills(assistantProfile?.enabledSkills)
  const enabledSkills = executiveAssistantSkills.filter((skill) => enabledSkillIds.includes(skill.id))
  const availableTools = listMcpTools().filter((tool) =>
    allowedActionTypes.includes(tool.actionType as AgentActionType)
  )

  if (isConversationalInput(input)) {
    if (process.env.OPENAI_API_KEY) {
      try {
        const aiResult = await analyzeUserRequest(
          input,
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
        }
      } catch {
        // Fall back to deterministic conversation if the model is unavailable.
      }
    }

    return {
      response: buildConversationalResponse(input, assistantProfile),
      proposals: [],
    }
  }

  if (availableTools.length === 0) {
    return {
      response:
        assistantProfile?.defaultLanguage === 'en'
          ? 'I can answer questions normally, but this workspace role is not allowed to execute connected app actions.'
          : 'Je peux répondre normalement, mais ce rôle workspace n’est pas autorisé à exécuter des actions sur les applications connectées.',
      proposals: [],
    }
  }

  if (process.env.OPENAI_API_KEY) {
    try {
      const aiResult = await analyzeUserRequest(
        input,
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
        userInput: input,
        connectedContextMetadata: options.connectedContextMetadata,
      })
      const resolvedReferenceProposals = resolvedReferenceResult.proposals

      const enrichedProposals = resolvedReferenceProposals.map((proposal) => {
        if (proposal.type === 'create_calendar_event') {
          const attendees = Array.isArray(proposal.parameters.attendees)
            ? proposal.parameters.attendees.filter((value): value is string => typeof value === 'string' && value.includes('@'))
            : []
          const maybeRecipient = extractRecipientName(input)
          const knownContact = maybeRecipient ? findContactByName(maybeRecipient, knownContacts) : null

          return {
            ...proposal,
            parameters: {
              ...proposal.parameters,
              createMeetLink:
                typeof proposal.parameters.createMeetLink === 'boolean'
                  ? proposal.parameters.createMeetLink || requestNeedsMeetLink(input)
                  : requestNeedsMeetLink(input),
              attendees:
                attendees.length > 0
                  ? attendees
                  : knownContact
                    ? [knownContact.email]
                    : attendees,
            },
            confidenceScore: Math.max(proposal.confidenceScore, requestNeedsMeetLink(input) ? 0.9 : 0.85),
          }
        }

        if (proposal.type !== 'send_email' && proposal.type !== 'share_google_drive_file' && proposal.type !== 'forward_email') {
          return proposal
        }

        const recipientKey = proposal.type === 'share_google_drive_file' ? 'emails' : 'to'
        const to = Array.isArray(proposal.parameters[recipientKey]) ? proposal.parameters[recipientKey] as unknown[] : []
        const hasRealEmail = to.some((value) => typeof value === 'string' && value.includes('@'))
        if (hasRealEmail) {
          return proposal
        }

        const maybeRecipient = extractRecipientName(input)
        const knownContact = maybeRecipient ? findContactByName(maybeRecipient, knownContacts) : null
        if (!knownContact) {
          return proposal
        }

        return {
          ...proposal,
          title:
            proposal.type === 'share_google_drive_file'
              ? `Share file with ${knownContact.name}`
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

      const safeProposals = enrichedProposals.map((proposal) => {
        if (
          !(
            ((proposal.type === 'send_email' || proposal.type === 'forward_email') && hasPlaceholderRecipient(proposal.parameters)) ||
            (proposal.type === 'share_google_drive_file' && hasPlaceholderShareRecipient(proposal.parameters))
          )
        ) {
          return proposal
        }

        return {
          ...proposal,
          confidenceScore: Math.min(proposal.confidenceScore, 0.45),
        }
      })

      const allowProposals = isActionRequest(input)
      const hadModelProposalButNoneValidated = allowProposals && aiResult.proposals.length > 0 && safeProposals.length === 0
      const fallbackResolutionForInvalidModel = hadModelProposalButNoneValidated
        ? resolveActionReferencesDetailed({
            proposals: buildFallbackResponseWithContactsAndProfile(input, knownContacts, assistantProfile).proposals.filter(
              (proposal) => allowedActionTypes.includes(proposal.type)
            ),
            userInput: input,
            connectedContextMetadata: options.connectedContextMetadata,
          })
        : { proposals: [], disambiguations: [] }
      const fallbackForInvalidModelProposal = fallbackResolutionForInvalidModel.proposals
      const deniedByRole =
        hadModelProposalButNoneValidated &&
        fallbackForInvalidModelProposal.length === 0 &&
        availableTools.length === 0
      const hasDisambiguation =
        resolvedReferenceResult.disambiguations.length > 0 ||
        fallbackResolutionForInvalidModel.disambiguations.length > 0

      return {
        response:
          hasDisambiguation
            ? buildDisambiguationResponse(
                [
                  ...resolvedReferenceResult.disambiguations,
                  ...fallbackResolutionForInvalidModel.disambiguations,
                ],
                assistantProfile
              )
            : deniedByRole
            ? assistantProfile?.defaultLanguage === 'en'
              ? 'I understood the request, but your workspace role is not allowed to use that tool.'
              : 'J’ai compris la demande, mais ton rôle workspace n’est pas autorisé à utiliser cet outil.'
            : fallbackForInvalidModelProposal.length > 0
            ? buildFallbackResponseWithContactsAndProfile(input, knownContacts, assistantProfile).response
            : !allowProposals && safeProposals.length > 0
            ? buildConversationalResponse(input, assistantProfile)
            : aiResult.response,
        proposals:
          hasDisambiguation
            ? []
            : allowProposals
            ? safeProposals.length > 0
              ? safeProposals
              : fallbackForInvalidModelProposal
            : [],
      }
    } catch {
      const fallback = buildFallbackResponseWithContactsAndProfile(input, knownContacts, assistantProfile)
      const fallbackResolution = resolveActionReferencesDetailed({
        proposals: fallback.proposals.filter((proposal) => allowedActionTypes.includes(proposal.type)),
        userInput: input,
        connectedContextMetadata: options.connectedContextMetadata,
      })
      const filteredProposals = fallbackResolution.proposals

      return {
        response:
          fallbackResolution.disambiguations.length > 0
            ? buildDisambiguationResponse(fallbackResolution.disambiguations, assistantProfile)
            : fallback.proposals.length > 0 && filteredProposals.length === 0
            ? assistantProfile?.defaultLanguage === 'en'
              ? 'I understood the request, but your workspace role is not allowed to use that tool.'
              : 'J’ai compris la demande, mais ton rôle workspace n’est pas autorisé à utiliser cet outil.'
            : fallback.response,
        proposals: fallbackResolution.disambiguations.length > 0 ? [] : filteredProposals,
      }
    }
  }

  const fallback = buildFallbackResponseWithContactsAndProfile(input, knownContacts, assistantProfile)
  const fallbackResolution = resolveActionReferencesDetailed({
    proposals: fallback.proposals.filter((proposal) => allowedActionTypes.includes(proposal.type)),
    userInput: input,
    connectedContextMetadata: options.connectedContextMetadata,
  })
  const filteredProposals = fallbackResolution.proposals

  return {
    response:
      fallbackResolution.disambiguations.length > 0
        ? buildDisambiguationResponse(fallbackResolution.disambiguations, assistantProfile)
        : fallback.proposals.length > 0 && filteredProposals.length === 0
        ? assistantProfile?.defaultLanguage === 'en'
          ? 'I understood the request, but your workspace role is not allowed to use that tool.'
          : 'J’ai compris la demande, mais ton rôle workspace n’est pas autorisé à utiliser cet outil.'
        : fallback.response,
    proposals: fallbackResolution.disambiguations.length > 0 ? [] : filteredProposals,
  }
}
