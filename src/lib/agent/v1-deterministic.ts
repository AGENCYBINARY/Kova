import { z } from 'zod'
import type { AgentPlanStep } from '@/lib/agent/planning'
import type { AssistantProfile } from '@/lib/assistant/profile'
import type { ReferenceDisambiguation } from '@/lib/agent/reference-resolution'
import {
  deriveNameFromEmail,
  extractEmailAddresses,
  extractRecipientName,
  extractStrictGmailAddressLookupName,
  findContactCandidatesByName,
  type KnownContact,
} from '@/lib/contacts'
import { canInferCalendarRangeFromUserText, inferCalendarRangeFromUserText } from '@/lib/scheduling/user-schedule'
import { isEmailSendIntent, isReadOnlyWorkspaceQuestion } from '@/lib/workspace-context/intents'

export const agentActionTypeSchema = z.enum([
  'send_email',
  'reply_to_email',
  'create_gmail_draft',
  'update_gmail_draft',
  'send_gmail_draft',
  'forward_email',
  'archive_gmail_thread',
  'unarchive_gmail_thread',
  'label_gmail_thread',
  'remove_gmail_thread_labels',
  'mark_gmail_thread_read',
  'mark_gmail_thread_unread',
  'star_gmail_thread',
  'unstar_gmail_thread',
  'trash_gmail_thread',
  'delete_gmail_thread_permanently',
  'create_calendar_event',
  'update_calendar_event',
  'delete_calendar_event',
  'update_notion_page',
  'update_notion_page_properties',
  'archive_notion_page',
  'create_notion_page',
  'create_google_doc',
  'update_google_doc',
  'create_google_drive_file',
  'create_google_drive_folder',
  'delete_google_drive_file',
  'move_google_drive_file',
  'rename_google_drive_file',
  'share_google_drive_file',
  'copy_google_drive_file',
  'unshare_google_drive_file',
  'create_google_drive_appdata_file',
  'update_google_drive_appdata_file',
  'delete_google_drive_appdata_file',
  'create_google_photos_picker_session',
  'list_google_photos_media',
  'search_google_photos_media',
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
  disambiguations?: ReferenceDisambiguation[]
  plan?: AgentPlanStep[]
}

export type AgentExecutionMode = 'ask' | 'auto'

const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,})/
const actionIntentPattern =
  /(send|email|mail|draft|reply|write|create|update|schedule|book|invite|plan|share|upload|save|store|sync|connect|disconnect|refresh|archive|unarchive|restore|label|forward|move|rename|star|unstar|trash|copy|duplicate|revoke|unshare|folder|open|ouvrir|ouvre|select|selectionne|selectionner|choisir|choisis|envoie|envoyer|rédige|redige|rediger|formuler|écris|ecris|ecrire|crée|cree|mets|mettre|ajoute|ajouter|planifie|programme|partage|enregistre|stocke|sauvegarde|connecte|déconnecte|deconnecte|actualise|rafraichis|archiver|restaure|restaurer|transférer|transferer|deplacer|deplace|renommer|renomme|labellise|labelise|duplique|dupliquer|corbeille|brouillon|brouillons|retire l acces|retirer l acces|dossier)/i
const appIntentPattern =
  /(gmail|google calendar|calendar|calendrier|google meet|meet|google docs|google doc|docs|document|notion|google drive|drive|google photos|photos|photo|visio|réunion|reunion|dossier|folder|fichier|file|page|database|base de donnees|base de données|doc\b|appdata|app data)/i
const greetingOnlyPattern =
  /^(bonjour|salut|hello|hey|yo|coucou|bonsoir|good morning|good evening|hi|ça va|ca va)\b[ !?.]*$/i
const conversationalPattern =
  /^(bonjour|salut|hello|hey|coucou|bonsoir|hi|parle moi|parle-moi|on peut parler|tu peux m'aider|tu peux m’aider|j'ai une question|j’ai une question|comment ca va|comment ça va|qui es tu|qui es-tu|explique moi|explique-moi|ça va|ca va)\b/i
const capabilityQuestionPattern =
  /^(est ce que tu peux|est-ce que tu peux|est ce que vous pouvez|est-ce que vous pouvez|tu peux|peux tu|peux-tu|vous pouvez|est ce que tu sais|est-ce que tu sais|tu sais|est ce que vous savez|est-ce que vous savez|vous savez|est ce possible|est-ce possible|possible de|possible d'|can you|could you|would you)\b/i

function isPlaceholderRecipientEmail(value: string) {
  const normalized = value.trim().toLowerCase()
  return normalized === 'recipient@example.com' || normalized.endsWith('@example.com')
}

function firstRealRecipientEmailFromInput(input: string): string | null {
  const fromPattern = input.match(emailPattern)?.[1]?.trim()
  if (fromPattern && !isPlaceholderRecipientEmail(fromPattern)) {
    return fromPattern.toLowerCase()
  }
  for (const email of extractEmailAddresses(input)) {
    if (!isPlaceholderRecipientEmail(email)) return email
  }
  return null
}

function pickContactFromCandidates(candidates: Array<{ contact: KnownContact; score: number }>): KnownContact | null {
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0].contact
  const [a, b] = candidates
  if (b && b.score >= 40 && a.score - b.score <= 20) return null
  return a.contact
}

function contactMatchIsAmbiguous(candidates: Array<{ contact: KnownContact; score: number }>) {
  return (
    candidates.length >= 2 &&
    candidates[1].score >= 40 &&
    candidates[0].score - candidates[1].score <= 20
  )
}

function buildContactRecipientDisambiguation(
  candidates: Array<{ contact: KnownContact; score: number }>,
  actionType: 'send_email' | 'create_gmail_draft',
  language: string
): ReferenceDisambiguation {
  return {
    actionType,
    source: 'contacts',
    field: 'email',
    question:
      language === 'en'
        ? 'Which contact should receive this email?'
        : 'À quelle adresse doit partir ce mail ?',
    options: candidates.slice(0, 5).map((entry) => ({
      id: entry.contact.email,
      label: `${entry.contact.name} · ${entry.contact.email}`,
    })),
  }
}

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
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function requestNeedsMeetLink(input: string) {
  const normalized = normalizeInput(input)
  const explicitlyNoMeet =
    /\b(sans|without|no|pas de|aucun)\s+(google meet|meet|visio|visioconference|video|zoom|teams)\b/.test(normalized) ||
    /\b(google meet|meet|visio|visioconference|video|zoom|teams)\b.*\b(sans|without|no|off|disabled)\b/.test(normalized)

  if (explicitlyNoMeet) {
    return false
  }

  return /(google meet|meet|visio|visioconference|visioconférence|video|vidéo|remote|zoom|teams|réunion|reunion|rendez-vous|rendezvous|\brdv\b|\bpoint\b|atelier|workshop|kickoff|\bsync\b)/.test(
    normalized
  )
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

function hasResolvableCalendarSchedule(input: string, durationMinutes: number) {
  return hasConcreteCalendarSchedule(input) || canInferCalendarRangeFromUserText(input, durationMinutes)
}

function getCalendarAttendeesFromInput(input: string, contact?: KnownContact | null) {
  const explicitEmails = extractEmailAddresses(input)
  if (explicitEmails.length > 0) {
    return explicitEmails
  }

  if (contact?.email) {
    return [contact.email]
  }

  return []
}

function getCalendarContactLabel(input: string, contact?: KnownContact | null) {
  if (contact?.name) {
    return contact.name
  }

  const explicitEmails = extractEmailAddresses(input)
  if (explicitEmails.length === 1) {
    return deriveNameFromEmail(explicitEmails[0]) || explicitEmails[0]
  }

  return null
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

export function isConversationalInput(input: string) {
  const normalized = input.trim()
  if (!normalized) return true
  if (isGreetingOnly(normalized)) return true
  return !isActionRequest(normalized) && conversationalPattern.test(normalized)
}

function hasTemporalOrTargetingDetails(input: string) {
  const normalized = normalizeInput(input)
  return (
    emailPattern.test(input) ||
    /["“][^"”]+["”]/.test(input) ||
    /\b(demain|tomorrow|aujourd'hui|aujourdhui|today|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday|semaine prochaine|next week|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b/.test(
      normalized
    ) ||
    /\b\d{1,2}\s*(?:h|heure|heures|min|minutes)\b/.test(normalized) ||
    /\b\d{1,2}:\d{2}\b/.test(normalized) ||
    /\bavec\s+[a-z0-9]/.test(normalized) ||
    /\bfor\s+[a-z0-9]/.test(normalized)
  )
}

function hasGenericCalendarParameters(proposal: AgentProposal, input: string) {
  const attendees = Array.isArray(proposal.parameters.attendees)
    ? proposal.parameters.attendees.filter((value): value is string => typeof value === 'string' && value.includes('@'))
    : []
  const title = typeof proposal.parameters.title === 'string' ? normalizeInput(proposal.parameters.title) : ''
  const genericTitles = new Set(['meeting', 'rendez-vous', 'rendez vous', 'point', 'point hebdo', 'call', 'dejeuner', 'cafe', 'presentation', 'debrief'])
  return attendees.length === 0 && !hasTemporalOrTargetingDetails(input) && (!title || genericTitles.has(title))
}

function isPlaceholderIdentifier(value: unknown) {
  if (typeof value !== 'string') return true
  const normalized = normalizeInput(value)
  return (
    normalized.length === 0 ||
    normalized === 'thread-id' ||
    normalized === 'message-id' ||
    normalized === 'event-id' ||
    normalized === 'document-id' ||
    normalized === 'file-id' ||
    normalized === 'drive-folder-id' ||
    normalized === 'page-id' ||
    normalized === 'notion-page-id' ||
    normalized === 'database-id'
  )
}

function proposalNeedsClarification(proposal: AgentProposal, input: string) {
  switch (proposal.type) {
    case 'create_calendar_event':
      return hasGenericCalendarParameters(proposal, input)
    case 'send_email':
    case 'create_gmail_draft':
    case 'update_gmail_draft':
      return hasPlaceholderRecipient(proposal.parameters) && !hasTemporalOrTargetingDetails(input)
    case 'send_gmail_draft':
      return isPlaceholderIdentifier(proposal.parameters.draftId)
    case 'forward_email':
      return (
        isPlaceholderIdentifier(proposal.parameters.messageId) &&
        isPlaceholderIdentifier(proposal.parameters.threadId)
      )
    case 'archive_gmail_thread':
    case 'unarchive_gmail_thread':
    case 'label_gmail_thread':
    case 'remove_gmail_thread_labels':
    case 'mark_gmail_thread_read':
    case 'mark_gmail_thread_unread':
    case 'star_gmail_thread':
    case 'unstar_gmail_thread':
    case 'trash_gmail_thread':
    case 'delete_gmail_thread_permanently':
      return isPlaceholderIdentifier(proposal.parameters.threadId)
    case 'update_calendar_event':
    case 'delete_calendar_event':
      return isPlaceholderIdentifier(proposal.parameters.eventId)
    case 'update_google_doc':
      return isPlaceholderIdentifier(proposal.parameters.documentId)
    case 'create_google_drive_folder': {
      const name = typeof proposal.parameters.name === 'string' ? normalizeInput(proposal.parameters.name) : ''
      return !hasTemporalOrTargetingDetails(input) && (name === 'new folder' || name === 'nouveau dossier')
    }
    case 'delete_google_drive_file':
    case 'move_google_drive_file':
    case 'rename_google_drive_file':
    case 'share_google_drive_file':
    case 'copy_google_drive_file':
    case 'unshare_google_drive_file':
    case 'update_google_drive_appdata_file':
    case 'delete_google_drive_appdata_file':
      return isPlaceholderIdentifier(proposal.parameters.fileId)
    case 'create_google_drive_appdata_file':
      return false
    case 'update_notion_page':
    case 'update_notion_page_properties':
    case 'archive_notion_page':
      return isPlaceholderIdentifier(proposal.parameters.pageId)
    case 'create_notion_page':
      return (
        isPlaceholderIdentifier(proposal.parameters.parentDatabaseId) &&
        isPlaceholderIdentifier(proposal.parameters.parentPageId)
      )
    default:
      return false
  }
}

/**
 * User is asking for help wording an email (meta-request), not providing the literal email to send.
 * Deterministic email builders must not treat the whole sentence as the message body.
 * Covers FR: "redige un mail" / "me redige un mail" / "j'aimerais... aider à rédiger" (word order varies).
 */
export function isEmailCompositionAssistanceRequest(input: string): boolean {
  const n = normalizeInput(input)
  if (!/\b(mail|email|courriel|gmail|message)\b/.test(n)) {
    return false
  }
  if (
    /\b(cherche|chercher|trouve|trouver|retrouve|retrouver|regarde|depuis)\b/.test(n) &&
    /\b(mail|email|courriel|adresse|gmail|envoy|envoyes|envoyés|boite|inbox)\b/.test(n)
  ) {
    return false
  }
  if (extractStrictGmailAddressLookupName(input)) {
    return false
  }

  const draftingVerb =
    /\b(formuler|rediger|redige|ecrire|ecris)\b/.test(n) ||
    /\b(write|draft|compose|formulate)\b/.test(n)

  const metaHelp =
    /\b(aide|aider)\b.*\b(mail|email|courriel|message)\b/.test(n) ||
    /\b(mail|email|courriel)\b.*\b(formuler|rediger|redige|ecrire|ecris)\b/.test(n) ||
    /\b(formuler|rediger|redige|ecrire|ecris)\b.*\b(mail|email|courriel)\b/.test(n) ||
    /\b(je veux que tu|peux-tu|pourrais-tu|tu peux)\b.*\b(formuler|rediger|redige|ecrire|aider)\b/.test(n) ||
    /\b(me redige|m redige|me rediger)\b/.test(n) ||
    (/\b(aimerai|aimerais)\b/.test(n) && draftingVerb) ||
    /\b(help me (to )?(write|draft|word|formulate))\b/.test(n) ||
    /\b(can you help (me )?(write|draft))\b/.test(n) ||
    /\b(formulate|draft) (a |an |the )?(email|mail)\b/.test(n) ||
    /\b(write|compose) (a |an |the )?(email|mail)\b/.test(n)

  if (!metaHelp) {
    return false
  }

  const recipient = extractRecipientName(input)
  if (
    recipient &&
    (/\b(me redige|m redige|me rediger|redige un mail|redige le mail|envoie|envoyer|send (the )?(email|mail)|transmets|transmettre|forward)\b/.test(n) ||
      /\s+lui\s+(envoie|envoyer)\b/.test(n))
  ) {
    return false
  }

  return true
}

export function isCapabilityQuestion(input: string, proposals: AgentProposal[]) {
  const trimmed = input.trim()
  const normalized = normalizeInput(trimmed)
  if (!trimmed || !capabilityQuestionPattern.test(normalized)) {
    return false
  }

  const asksAboutCapability =
    /\b(sais faire|savez faire|possible|capable|capable de)\b/.test(normalized) ||
    /^tu sais\b/.test(normalized) ||
    /^vous savez\b/.test(normalized)
  const isQuestionLead = /^(est ce que|est-ce que|tu peux|peux-tu|peux tu|vous pouvez|can you|could you|would you)\b/i.test(
    trimmed
  )

  if (!(trimmed.endsWith('?') && (isQuestionLead || asksAboutCapability))) {
    return false
  }

  if (hasTemporalOrTargetingDetails(input)) {
    return false
  }

  if (proposals.length === 0) {
    return appIntentPattern.test(trimmed) || actionIntentPattern.test(trimmed)
  }

  return proposals.every((proposal) => proposalNeedsClarification(proposal, input))
}

export function buildCapabilityResponse(input: string, proposals: AgentProposal[], profile?: AssistantProfile) {
  const language = profile?.defaultLanguage || 'fr'
  const firstProposal = proposals[0]

  switch (firstProposal?.type) {
    case 'create_calendar_event':
      return language === 'en'
        ? 'Yes. I can prepare the event cleanly. I just need the title, date, time, and attendees first.'
        : 'Oui. Je peux te préparer ça proprement. Il me faut simplement le titre, la date, l’heure et les invités.'
    case 'send_email':
    case 'create_gmail_draft':
    case 'update_gmail_draft':
    case 'send_gmail_draft':
    case 'forward_email':
      return language === 'en'
        ? 'Yes. I can handle the email. Give me the recipient and what you want to send, and I’ll prepare it properly.'
        : 'Oui. Je peux gérer le mail. Donne-moi le destinataire et ce que tu veux envoyer, et je te le prépare proprement.'
    case 'archive_gmail_thread':
    case 'unarchive_gmail_thread':
    case 'label_gmail_thread':
    case 'remove_gmail_thread_labels':
    case 'mark_gmail_thread_read':
    case 'mark_gmail_thread_unread':
    case 'star_gmail_thread':
    case 'unstar_gmail_thread':
    case 'trash_gmail_thread':
    case 'delete_gmail_thread_permanently':
      return language === 'en'
        ? 'Yes. I can do that. I just need to know which Gmail thread you want me to use.'
        : 'Oui. Je peux le faire. Il faut juste que tu me précises quel thread Gmail tu veux que j’utilise.'
    case 'create_google_drive_folder':
    case 'create_google_drive_file':
    case 'delete_google_drive_file':
    case 'move_google_drive_file':
    case 'rename_google_drive_file':
    case 'share_google_drive_file':
    case 'copy_google_drive_file':
    case 'unshare_google_drive_file':
    case 'create_google_drive_appdata_file':
    case 'update_google_drive_appdata_file':
    case 'delete_google_drive_appdata_file':
      return language === 'en'
        ? 'Yes. I can handle Drive. I just need the exact file or folder you want me to use.'
        : 'Oui. Je peux gérer Drive. Il me faut simplement le fichier ou le dossier exact à utiliser.'
    case 'create_google_photos_picker_session':
    case 'list_google_photos_media':
    case 'search_google_photos_media':
      return language === 'en'
        ? 'Yes. I can help with Google Photos. I open a secure picker first, then I can work with the media you selected.'
        : 'Oui. Je peux t’aider avec Google Photos. J’ouvre d’abord un sélecteur sécurisé, puis je travaille sur les médias que tu as choisis.'
    case 'update_notion_page':
    case 'update_notion_page_properties':
    case 'archive_notion_page':
    case 'create_notion_page':
      return language === 'en'
        ? 'Yes. I can handle Notion. I just need the exact page or database you want me to use.'
        : 'Oui. Je peux gérer Notion. Il me faut simplement la page ou la base exacte que tu veux utiliser.'
    default:
      return language === 'en'
        ? 'Yes. I can handle that. Tell me exactly what you want prepared and I’ll take it from there.'
        : 'Oui. Je peux m’en charger. Dis-moi exactement ce que tu veux préparer et je prends le relais.'
  }
}

export function shouldPreferDeterministicAction(input: string, proposals: AgentProposal[]) {
  if (proposals.length === 0) return false

  /** Default product mode: LLM-first. Enable with KOVA_PREFER_DETERMINISTIC_ACTIONS=true to skip the model on matching shortcuts (cost / latency). */
  const useShortcuts =
    process.env.KOVA_PREFER_DETERMINISTIC_ACTIONS === 'true' ||
    process.env.KOVA_PREFER_DETERMINISTIC_ACTIONS === '1'
  if (!useShortcuts) {
    return false
  }

  const hasCal = proposals.some((p) => p.type === 'create_calendar_event')
  const hasMail = proposals.some((p) => p.type === 'send_email' || p.type === 'create_gmail_draft')
  if (hasCal && hasMail) {
    return true
  }
  if (hasCal && proposals.length === 1) {
    return true
  }

  const normalized = normalizeInput(input)

  if (
    /(gmail|email|e-mail|mail|message|thread|inbox)/.test(normalized) &&
    /(archive|archiver|unarchive|restore|restaure|restaurer|label|labels|etiquette|etiquettes|marque|mark|star|etoile|étoile|trash|corbeille|forward|transfere|transferer|draft|brouillon|reply|repond|supprime definitivement|delete permanently|send draft|envoie le brouillon)/.test(normalized)
  ) {
    return true
  }

  if (
    /(google drive|drive\b|folder|dossier|fichier|file)/.test(normalized) &&
    /(move|deplace|deplacer|rename|renomme|renommer|share|partage|partager|copy|copie|duplique|duplicate|unshare|revoke|retire l acces|delete|supprime|create folder|cree un dossier|creer un dossier|nouveau dossier|appdata|app data|config file|fichier de config)/.test(normalized)
  ) {
    return true
  }

  if (
    /(google photos|photos|photo|album|image)/.test(normalized) &&
    /(search|cherche|chercher|find|retrouve|show|montre|list|liste|open|ouvrir|ouvre|select|selectionne|selectionner|choisir|choisis)/.test(normalized)
  ) {
    return true
  }

  if (
    /(notion|database|base de donnees|base de données|page|wiki)/.test(normalized) &&
    /(create|cr[eé]e|mets a jour|mettre a jour|update|status|statut|property|propriete|proprietes|archive|archiver|supprime)/.test(normalized)
  ) {
    return true
  }

  return false
}

export function buildConversationalResponse(input: string, profile?: AssistantProfile) {
  const language = profile?.defaultLanguage || 'fr'
  const normalized = normalizeInput(input)

  if (isGreetingOnly(input)) {
    return language === 'en'
      ? 'Hey — I’m here. What should we knock out first?'
      : 'Salut — je suis là. On attaque quoi en premier ?'
  }

  if (/parle moi|parle-moi/.test(normalized)) {
    return language === 'en'
      ? 'Of course. What do you want me to handle first?'
      : 'Bien sûr. Qu’est-ce que tu veux que je prenne en premier ?'
  }

  if (/comment ca va|comment ça va|ca va|ça va/.test(normalized)) {
    return language === 'en'
      ? 'All good on my side. What do you want me to take care of?'
      : 'Ça va bien. Qu’est-ce que tu veux que je gère pour toi ?'
  }

  return language === 'en'
    ? 'Give me the task, the goal, or the app involved, and I’ll take it from there.'
    : 'Donne-moi le sujet, l’objectif ou l’application concernée, et je prends le relais.'
}

function buildExecutiveEmailBody(input: string, profile?: AssistantProfile) {
  const looksLikePromptInstruction =
    isEmailCompositionAssistanceRequest(input) ||
    /\b(trouve son adresse|find (her|his|their) address|prepare l['’]invitation|prepare the invite|sur le meme modele|same as before|meme objectif|same objective)\b/i.test(
      normalizeInput(input)
    )

  if (looksLikePromptInstruction) {
    const signature = profile?.signatureBlock?.trim() || profile?.signatureName || 'Kova'
    return profile?.defaultLanguage === 'en'
      ? ['Hello,', '', '[Message body will be drafted after you confirm recipient and purpose.]', '', 'Best regards,', signature].join('\n')
      : ['Bonjour,', '', '[Le corps du mail sera rédigé après confirmation du destinataire et de l’objectif.]', '', 'Merci,', signature].join('\n')
  }

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
  if (
    isEmailCompositionAssistanceRequest(input) ||
    /\b(trouve son adresse|find (her|his|their) address|prepare l['’]invitation|prepare the invite|sur le meme modele|same as before|meme objectif|same objective)\b/i.test(
      normalizeInput(input)
    )
  ) {
    return profile?.defaultLanguage === 'en' ? 'Follow-up' : 'Suivi'
  }

  const cleaned = input.trim().replace(/\s+/g, ' ')
  if (!cleaned) {
    return profile?.defaultLanguage === 'en' ? 'Follow-up' : 'Suivi'
  }

  const subject = cleaned.length > 72 ? `${cleaned.slice(0, 69)}...` : cleaned
  return profile?.defaultLanguage === 'en' ? subject : subject
}

function buildCalendarEventDescriptionFromInput(input: string, meetingTitle: string, profile?: AssistantProfile) {
  const trimmed = input.trim()
  const lang = profile?.defaultLanguage === 'en' ? 'en' : 'fr'
  if (lang === 'en') {
    return [`Agenda: ${meetingTitle}`, '', 'Context from the request:', trimmed].join('\n').slice(0, 8000)
  }
  return [`Ordre du jour : ${meetingTitle}`, '', 'Demande initiale :', trimmed].join('\n').slice(0, 8000)
}

export function buildCalendarProposal(input: string, profile?: AssistantProfile, contact?: KnownContact | null): AgentProposal {
  const durationMinutes = profile?.meetingDefaultDurationMinutes || 30
  const inferredRange = inferCalendarRangeFromUserText(input, durationMinutes)
  const now = Date.now()
  const fallbackStart = new Date(now + 1000 * 60 * 60 * 24)
  const start = inferredRange?.start ?? fallbackStart
  const end = inferredRange?.end ?? new Date(fallbackStart.getTime() + durationMinutes * 60 * 1000)
  const calendarContactLabel = getCalendarContactLabel(input, contact)
  const attendeeEmails = getCalendarAttendeesFromInput(input, contact)
  const inferredTitle = (() => {
    const n = normalizeInput(input)
    if (/déjeuner|dejeuner|lunch/.test(n)) return calendarContactLabel ? `Déjeuner avec ${calendarContactLabel}` : 'Déjeuner'
    if (/café|cafe|coffee/.test(n)) return calendarContactLabel ? `Café avec ${calendarContactLabel}` : 'Café'
    if (/call|appel/.test(n)) return calendarContactLabel ? `Call avec ${calendarContactLabel}` : 'Call'
    if (/point|sync|weekly|hebdo/.test(n)) return calendarContactLabel ? `Point avec ${calendarContactLabel}` : 'Point hebdo'
    if (/debrief|debriefing/.test(n)) return calendarContactLabel ? `Debrief avec ${calendarContactLabel}` : 'Debrief'
    if (/présentation|presentation/.test(n)) return calendarContactLabel ? `Présentation avec ${calendarContactLabel}` : 'Présentation'
    if (calendarContactLabel) {
      return profile?.defaultLanguage === 'en' ? `Meeting with ${calendarContactLabel}` : `Réunion avec ${calendarContactLabel}`
    }
    return profile?.defaultLanguage === 'en' ? 'Meeting' : 'Rendez-vous'
  })()
  const meetingTitle = inferredTitle
  const richDescription = buildCalendarEventDescriptionFromInput(input, meetingTitle, profile)

  return {
    type: 'create_calendar_event',
    title: calendarContactLabel ? `Create meeting invite for ${calendarContactLabel}` : 'Create calendar event',
    description: 'Create a Google Calendar invite with attendee-ready scheduling details.',
    parameters: {
      title: meetingTitle,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      attendees: attendeeEmails,
      createMeetLink: requestNeedsMeetLink(input),
      description: richDescription,
      notes:
        profile?.defaultLanguage === 'en'
          ? `Kova · default duration ${durationMinutes} min · buffer ${profile?.schedulingBufferMinutes || 0} min · Google Meet when applicable`
          : `Kova · durée ${durationMinutes} min · buffer ${profile?.schedulingBufferMinutes || 0} min · Google Meet si pertinent`,
    },
    confidenceScore: 0.9,
  }
}

function summarizeMeetingReminderFromInput(input: string, language: 'fr' | 'en'): string {
  const n = normalizeInput(input)
  const dayMatch = n.match(
    /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|tomorrow|today|aujourd[' ]?hui)\b/
  )
  let timeStr = ''
  const hm = n.match(/\b(\d{1,2})\s*h(?:eures?)?\b/)
  const colon = n.match(/\b(\d{1,2}):(\d{2})\b/)
  if (hm) {
    timeStr = `${hm[1]}h`
  } else if (colon) {
    timeStr = `${colon[1]}h${colon[2]}`
  }

  if (language === 'en') {
    const topic =
      /objectif.*agence|agency objective|agency objectives/.test(n)
        ? 'the agency objectives'
        : /meeting|call|sync|touchpoint|réunion|reunion/.test(n)
          ? 'our meeting'
          : 'our discussion'
    const whenParts: string[] = []
    if (dayMatch) whenParts.push(`on ${dayMatch[1]}`)
    if (timeStr) whenParts.push(`at ${timeStr}`)
    const when = whenParts.join(' ')
    return `Just a reminder ${when ? `${when} ` : ''}about ${topic}.`
  }

  const topic = /objectif.*agence|agence.*objectif/.test(n)
    ? "les objectifs de l'agence"
    : /réunion|reunion|point|rdv|meet|visio/.test(n)
      ? 'notre rendez-vous'
      : 'notre échange'
  const whenParts: string[] = []
  if (dayMatch) whenParts.push(dayMatch[1])
  if (timeStr) whenParts.push(`à ${timeStr}`)
  const when = whenParts.filter(Boolean).join(' ')
  return `Petit rappel${when ? ` pour ${when}` : ''} concernant ${topic}.`
}

export function buildMeetingEmailFollowupProposal(
  input: string,
  contact: KnownContact | null,
  profile?: AssistantProfile
): AgentProposal {
  const language = profile?.defaultLanguage || 'fr'
  const first = contact?.name?.split(/\s+/).filter(Boolean)[0] || ''
  const greeting =
    language === 'en' ? (first ? `Hello ${first},` : 'Hello,') : first ? `Bonjour ${first},` : 'Bonjour,'
  const reminder = summarizeMeetingReminderFromInput(input, language)
  const body =
    language === 'en'
      ? [
          greeting,
          '',
          reminder,
          '',
          'Here is the Google Meet link for the call:',
          '{{meet_link}}',
          '',
          'See you then,',
          profile?.signatureBlock?.trim() || profile?.signatureName || 'Kova',
        ].join('\n')
      : [
          greeting,
          '',
          reminder,
          '',
          'Voici le lien Google Meet pour la visio :',
          '{{meet_link}}',
          '',
          'À tout à l’heure,',
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
          ? 'Meeting reminder'
          : /objectif/.test(normalizeInput(input)) && /agence/.test(normalizeInput(input))
            ? "Rappel — objectifs de l'agence"
            : 'Rappel — réunion',
      body,
      ...(contact ? { resolvedContactName: contact.name } : {}),
    },
    confidenceScore: contact ? 0.94 : 0.6,
  }
}

function buildEmailProposal(
  input: string,
  profile: AssistantProfile | undefined,
  to: string[],
  resolvedContactName?: string
): AgentProposal {
  return {
    type: 'send_email',
    title: resolvedContactName ? `Send email to ${resolvedContactName}` : 'Send email draft',
    description: 'Prepare a polished Gmail message for approval and sending.',
    parameters: {
      to,
      subject: buildEmailSubject(input, profile),
      body: buildExecutiveEmailBody(input, profile),
      ...(resolvedContactName ? { resolvedContactName } : {}),
    },
    confidenceScore: resolvedContactName ? 0.93 : 0.87,
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

function buildGmailDraftProposal(
  input: string,
  profile: AssistantProfile | undefined,
  to: string[],
  resolvedContactName?: string
): AgentProposal {
  return {
    type: 'create_gmail_draft',
    title:
      resolvedContactName
        ? profile?.defaultLanguage === 'en'
          ? `Create draft for ${resolvedContactName}`
          : `Brouillon pour ${resolvedContactName}`
        : profile?.defaultLanguage === 'en'
          ? 'Create Gmail draft'
          : 'Créer un brouillon Gmail',
    description:
      profile?.defaultLanguage === 'en'
        ? 'Prepare a Gmail draft without sending it.'
        : 'Préparer un brouillon Gmail sans l’envoyer.',
    parameters: {
      to,
      subject: buildEmailSubject(input, profile),
      body: buildExecutiveEmailBody(input, profile),
      ...(resolvedContactName ? { resolvedContactName } : {}),
    },
    confidenceScore: resolvedContactName ? 0.9 : 0.84,
  }
}

function buildSendGmailDraftProposal(profile?: AssistantProfile): AgentProposal {
  return {
    type: 'send_gmail_draft',
    title: profile?.defaultLanguage === 'en' ? 'Send Gmail draft' : 'Envoyer le brouillon Gmail',
    description:
      profile?.defaultLanguage === 'en'
        ? 'Send the matching Gmail draft.'
        : 'Envoyer le brouillon Gmail correspondant.',
    parameters: {
      draftId: '',
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

function buildUnarchiveEmailProposal(profile?: AssistantProfile): AgentProposal {
  return {
    type: 'unarchive_gmail_thread',
    title: profile?.defaultLanguage === 'en' ? 'Restore Gmail thread' : 'Restaurer le thread Gmail',
    description:
      profile?.defaultLanguage === 'en'
        ? 'Restore the matching Gmail thread to the inbox.'
        : 'Restaurer le thread Gmail correspondant dans la boîte de réception.',
    parameters: {
      threadId: '',
    },
    confidenceScore: 0.8,
  }
}

function buildLabelEmailProposal(input: string, profile?: AssistantProfile): AgentProposal {
  const labelMatch = input.match(/(?:label|labels|etiquette|etiquettes|tag)\s+["“]?([^"”]+?)["”]?(?=\s+(?:au|a|à|sur|for|to|du|de la|de l'|de)\b|$|[,.!?])/i)
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

function buildRemoveLabelEmailProposal(input: string, profile?: AssistantProfile): AgentProposal {
  const labelMatch = input.match(/(?:label|labels|etiquette|etiquettes|tag)\s+["“]?([^"”]+?)["”]?(?=\s+(?:au|a|à|sur|for|to|du|de la|de l'|de)\b|$|[,.!?])/i)
  const label = labelMatch?.[1]?.trim() || (profile?.defaultLanguage === 'en' ? 'To review' : 'À revoir')
  return {
    type: 'remove_gmail_thread_labels',
    title: profile?.defaultLanguage === 'en' ? 'Remove Gmail labels' : 'Retirer des labels Gmail',
    description:
      profile?.defaultLanguage === 'en'
        ? 'Remove labels from the matching Gmail thread.'
        : 'Retirer des labels du thread Gmail correspondant.',
    parameters: {
      threadId: '',
      labelNames: [label],
    },
    confidenceScore: 0.78,
  }
}

function buildStarGmailProposal(starred: boolean, profile?: AssistantProfile): AgentProposal {
  return {
    type: starred ? 'star_gmail_thread' : 'unstar_gmail_thread',
    title:
      profile?.defaultLanguage === 'en'
        ? starred ? 'Star Gmail thread' : 'Unstar Gmail thread'
        : starred ? 'Ajouter une étoile au thread Gmail' : 'Retirer l’étoile du thread Gmail',
    description:
      profile?.defaultLanguage === 'en'
        ? starred ? 'Star the matching Gmail thread.' : 'Remove the star from the matching Gmail thread.'
        : starred ? 'Ajouter une étoile au thread Gmail correspondant.' : 'Retirer l’étoile du thread Gmail correspondant.',
    parameters: {
      threadId: '',
    },
    confidenceScore: 0.8,
  }
}

function buildTrashGmailProposal(profile?: AssistantProfile): AgentProposal {
  return {
    type: 'trash_gmail_thread',
    title: profile?.defaultLanguage === 'en' ? 'Trash Gmail thread' : 'Mettre le thread Gmail à la corbeille',
    description:
      profile?.defaultLanguage === 'en'
        ? 'Move the matching Gmail thread to trash.'
        : 'Déplacer le thread Gmail correspondant dans la corbeille.',
    parameters: {
      threadId: '',
    },
    confidenceScore: 0.77,
  }
}

function buildDeleteGmailProposal(profile?: AssistantProfile): AgentProposal {
  return {
    type: 'delete_gmail_thread_permanently',
    title: profile?.defaultLanguage === 'en' ? 'Delete Gmail thread permanently' : 'Supprimer définitivement le thread Gmail',
    description:
      profile?.defaultLanguage === 'en'
        ? 'Permanently delete the matching Gmail thread.'
        : 'Supprimer définitivement le thread Gmail correspondant.',
    parameters: {
      threadId: '',
    },
    confidenceScore: 0.72,
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

function extractRelativeCalendarShiftMinutes(input: string) {
  const normalized = normalizeInput(input)
  const match =
    normalized.match(/\b(?:decale|decaler|decalant|décale|décaler|décalant|shift|move)\b.*?\b(\d{1,3})\s*(minute|min|minutes)\b/) ||
    normalized.match(/\b(\d{1,3})\s*(minute|min|minutes)\b.*?\b(?:plus tard|later|after)\b/) ||
    normalized.match(/\b(\d{1,3})\s*(minute|min|minutes)\b.*?\b(?:plus tot|plus tôt|earlier|before)\b/)

  if (!match) return null

  const minutes = Number.parseInt(match[1] || '', 10)
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return null
  }

  const negative = /\b(plus tot|plus tôt|earlier|before|avance|avancer)\b/.test(normalized)
  return negative ? -minutes : minutes
}

function buildUpdateCalendarProposal(input: string, profile?: AssistantProfile): AgentProposal {
  const language = profile?.defaultLanguage || 'fr'
  const relativeShiftMinutes = extractRelativeCalendarShiftMinutes(input)

  return {
    type: 'update_calendar_event',
    title: language === 'en' ? 'Update calendar event' : 'Mettre à jour un événement agenda',
    description:
      language === 'en'
        ? 'Update the selected Google Calendar event with the requested changes.'
        : "Mettre à jour l'événement Google Calendar sélectionné avec les changements demandés.",
    parameters: {
      eventId: '',
      ...(relativeShiftMinutes ? { relativeShiftMinutes } : {}),
      ...(typeof input === 'string' && input.trim().length > 0 ? { description: input.trim() } : {}),
    },
    confidenceScore: relativeShiftMinutes ? 0.84 : 0.74,
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

function buildCopyGoogleDriveProposal(input: string, profile?: AssistantProfile): AgentProposal {
  const quoted = input.match(/["“]([^"”]+)["”]/)
  const folderMatch = input.match(/(?:dans|vers|to|into)\s+["“]?([^"”]+?)["”]?(?=$|[,.!?])/i)

  return {
    type: 'copy_google_drive_file',
    title: profile?.defaultLanguage === 'en' ? 'Copy Drive file' : 'Copier le fichier Drive',
    description:
      profile?.defaultLanguage === 'en'
        ? 'Copy the matching Google Drive file.'
        : 'Copier le fichier Google Drive correspondant.',
    parameters: {
      fileId: '',
      ...(quoted?.[1]?.trim() ? { name: quoted[1].trim() } : {}),
      ...(folderMatch?.[1]?.trim() ? { destinationFolderName: folderMatch[1].trim() } : {}),
    },
    confidenceScore: 0.79,
  }
}

function buildDriveAppDataProposal(input: string, updateExisting: boolean, profile?: AssistantProfile): AgentProposal {
  const quoted = input.match(/["“]([^"”]+)["”]/)
  return {
    type: updateExisting ? 'update_google_drive_appdata_file' : 'create_google_drive_appdata_file',
    title:
      profile?.defaultLanguage === 'en'
        ? updateExisting ? 'Update Drive app data' : 'Create Drive app data'
        : updateExisting ? 'Mettre à jour les données app Drive' : 'Créer des données app Drive',
    description:
      profile?.defaultLanguage === 'en'
        ? 'Store structured app data inside Drive appDataFolder.'
        : 'Stocker des données structurées dans appDataFolder de Drive.',
    parameters: {
      name: quoted?.[1]?.trim() || 'kova-config.json',
      content: input,
    },
    confidenceScore: 0.74,
  }
}

function buildDeleteDriveAppDataProposal(input: string, profile?: AssistantProfile): AgentProposal {
  const quoted = input.match(/["“]([^"”]+)["”]/)
  return {
    type: 'delete_google_drive_appdata_file',
    title: profile?.defaultLanguage === 'en' ? 'Delete Drive app data' : 'Supprimer les données app Drive',
    description:
      profile?.defaultLanguage === 'en'
        ? 'Delete a file stored in Drive appDataFolder.'
        : 'Supprimer un fichier stocké dans appDataFolder de Drive.',
    parameters: {
      fileId: '',
      name: quoted?.[1]?.trim() || 'kova-config.json',
    },
    confidenceScore: 0.72,
  }
}

function buildGooglePhotosProposal(input: string, profile?: AssistantProfile): AgentProposal {
  const normalized = normalizeInput(input)
  const searchMatch = input.match(/["“]([^"”]+)["”]/)
  const hasSearchTerm = Boolean(searchMatch?.[1]?.trim())
  const refersToSelectedPhotos =
    /\b(selection|selected|picked|chosen|selectionnes|selectionnees|choisies|choisis|choisi)\b/.test(normalized)

  return hasSearchTerm && refersToSelectedPhotos
    ? {
        type: 'search_google_photos_media',
        title: profile?.defaultLanguage === 'en' ? 'Search Google Photos' : 'Chercher dans Google Photos',
        description:
          profile?.defaultLanguage === 'en'
            ? 'Search through the Google Photos media that was already selected in the picker.'
            : 'Chercher dans les médias Google Photos déjà sélectionnés dans le picker.',
        parameters: {
          query: searchMatch?.[1]?.trim() || input.trim(),
          maxResults: 12,
        },
        confidenceScore: 0.78,
      }
    : {
        type: 'create_google_photos_picker_session',
        title: profile?.defaultLanguage === 'en' ? 'Open Google Photos picker' : 'Ouvrir le picker Google Photos',
        description:
          profile?.defaultLanguage === 'en'
            ? 'Start a secure picker session so the user can choose the exact photos to use.'
            : 'Démarrer une session picker sécurisée pour que l’utilisateur choisisse les photos exactes à utiliser.',
        parameters: {},
        confidenceScore: 0.8,
      }
}

function buildUnshareGoogleDriveProposal(input: string, contact: KnownContact | null, profile?: AssistantProfile): AgentProposal {
  return {
    type: 'unshare_google_drive_file',
    title: profile?.defaultLanguage === 'en' ? 'Unshare Drive file' : 'Retirer le partage Drive',
    description:
      profile?.defaultLanguage === 'en'
        ? 'Remove access to the matching Google Drive file.'
        : 'Retirer l’accès au fichier Google Drive correspondant.',
    parameters: {
      fileId: '',
      emails: contact ? [contact.email] : ['recipient@example.com'],
      ...(contact ? { resolvedContactName: contact.name } : {}),
    },
    confidenceScore: contact ? 0.84 : 0.66,
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

function buildGoogleDriveFolderProposal(input: string, profile?: AssistantProfile): AgentProposal {
  const quoted = input.match(/["“]([^"”]+)["”]/)
  const folderMatch = input.match(/(?:dans|inside|into)\s+["“]?([^"”]+?)["”]?(?=$|[,.!?])/i)
  const parentFolderName = folderMatch?.[1]?.trim()

  return {
    type: 'create_google_drive_folder',
    title: profile?.defaultLanguage === 'en' ? 'Create Drive folder' : 'Créer un dossier Drive',
    description:
      profile?.defaultLanguage === 'en'
        ? 'Create a new Google Drive folder.'
        : 'Créer un nouveau dossier Google Drive.',
    parameters: {
      name: quoted?.[1]?.trim() || (profile?.defaultLanguage === 'en' ? 'New folder' : 'Nouveau dossier'),
      ...(parentFolderName
        ? {
            folderName: parentFolderName,
            parentFolderId: 'drive-folder-id',
          }
        : {}),
    },
    confidenceScore: 0.82,
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

function buildArchiveNotionPageProposal(profile?: AssistantProfile): AgentProposal {
  return {
    type: 'archive_notion_page',
    title: profile?.defaultLanguage === 'en' ? 'Archive Notion page' : 'Archiver la page Notion',
    description:
      profile?.defaultLanguage === 'en'
        ? 'Archive the matching Notion page.'
        : 'Archiver la page Notion correspondante.',
    parameters: {
      pageId: 'notion-page-id',
    },
    confidenceScore: 0.76,
  }
}

export function buildDisambiguationResponse(
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

export function buildFallbackResponseWithContactsAndProfile(
  input: string,
  knownContacts: KnownContact[],
  assistantProfile?: AssistantProfile
): AgentTurnResult {
  const normalized = normalizeInput(input)
  const intentText = normalized
    .replace(emailPattern, ' ')
    .replace(/\[\[kova-ref:[^\]]+\]\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const language = assistantProfile?.defaultLanguage || 'fr'
  const maybeRecipient = extractRecipientName(input)
  const contactCandidates = maybeRecipient ? findContactCandidatesByName(maybeRecipient, knownContacts) : []
  const knownContact = pickContactFromCandidates(contactCandidates)
  const isExplicitNotionRequest = /(notion|wiki|database|base de donnees|base de données|workspace|page)/.test(intentText)
  const isMeetingRequest =
    !isExplicitNotionRequest &&
    /(calendar|calendrier|meeting|schedule|invite|appel|rdv|réunion|reunion|visio|visioconference|visioconférence|google meet|meet|zoom|event|evenement|événement)/.test(intentText)
  const wantsMeetingConfirmation =
    /(confirmation|confirm|confirmer|lien|link|visio|meet|invite)/.test(intentText)
  const explicitlyWantsSeparateEmail =
    /(send an email|send email|email recap|mail recap|follow-up email|envoie un mail|envoyer un mail|envoie un email|envoyer un email|courriel distinct|rediger un mail|rédiger un mail|redige un mail|rédige un mail|rediger un message|rédiger un message|redige un message|rédige un message|me redige|me rediger|lui envoyer|lui envoie|envoyer.*mail|envoie.*mail|same as before|meme modele|meme objectif|prepare l email|prepare le mail|prepare the email)/.test(
      intentText
    )
  const explicitEmailIntent = isEmailSendIntent(intentText)
  const explicitReplyIntent =
    /(reply|reponds|repondre|reponse|réponds|répondre|réponse|answer this email|reply to|reponds-lui|reponds lui)/.test(
      intentText
    )
  const explicitForwardIntent = /(forward|transfere|transferer|transmets|faire suivre)/.test(intentText)
  const draftIntent = /(draft|brouillon|prepare sans envoyer|prépare sans envoyer)/.test(intentText)
  const sendDraftIntent = /(send draft|envoie le brouillon|envoyer le brouillon|send the draft|send this draft)/.test(intentText)
  const archiveIntent = /(archive|archiver|range|ranger)/.test(intentText)
  const unarchiveIntent =
    /(unarchive|restore|restaure|restaurer|remets?.*(boite de reception|inbox)|retablis?.*(boite de reception|inbox))/.test(
      intentText
    )
  const labelIntent = /(label|labels|etiquette|etiquettes|tag|tags)/.test(intentText)
  const removeLabelIntent = /(remove label|remove labels|retire le label|retire les labels|supprime le label|supprime les labels)/.test(intentText)
  const markUnreadIntent = /(non lu|unread|marque.*non lu|mark.*unread)/.test(intentText)
  const markReadIntent = /(marque.*lu|mark.*read|\blu\b)/.test(intentText) && !markUnreadIntent
  const starIntent = /\b(star|etoile|étoile|epingle|épingl(?:e|er|é|ée|er)?)\b/.test(intentText)
  const unstarIntent = /\b(unstar)\b|(retire|retirer|enleve|enlever).*(etoile|étoile)/.test(intentText)
  const trashIntent = /(trash|corbeille|supprime.*gmail|jette)/.test(intentText)
  const permanentDeleteIntent = /(supprime definitivement|supprimer definitivement|hard delete|delete permanently|efface definitivement)/.test(intentText)
  const deleteIntent = /(delete|remove|supprime|supprimer|efface|annule|cancel)/.test(intentText)
  const updateIntent = /(update|edit|revise|rewrite|modifie|modifier|mets a jour|mettre a jour|complete|compl[eè]te|add|append|ajoute|ajouter|insere|inserer|insert)/.test(
    intentText
  )
  const moveIntent = /(move|deplace|deplacer|range dans|place dans)/.test(intentText)
  const renameIntent = /(rename|renomme|renommer)/.test(intentText)
  const shareIntent = /(share|partage|partager)/.test(intentText)
  const copyIntent = /(copy|copie|duplique|dupliquer|duplicate)/.test(intentText)
  const unshareIntent = /(unshare|remove access|revoke|retire(?:r)? l[' ]acces|supprime l[' ]acces)/.test(intentText)
  const createFolderIntent = /(create|cree|creer|nouveau|new).*(folder|dossier)|\b(folder|dossier)\b.*(create|cree|creer)/.test(intentText)
  const appDataIntent = /(appdata|app data|configuration interne|config interne|fichier de config|config file)/.test(intentText)
  const notionPropertiesIntent = /(status|statut|priority|priorite|priorité|property|properties|propriete|proprietes)/.test(intentText)
  const notionArchiveIntent = /(archive|archiver|supprime|supprimer|retire|retirer)/.test(intentText)

  if (
    isMeetingRequest &&
    updateIntent &&
    !deleteIntent &&
    !explicitEmailIntent
  ) {
    return {
      response:
        language === 'en'
          ? 'Calendar update ready for review.'
          : "Mise à jour de l'événement prête à valider.",
      proposals: [buildUpdateCalendarProposal(input, assistantProfile)],
    }
  }

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
    updateIntent &&
    !deleteIntent &&
    !explicitEmailIntent
  ) {
    return {
      response:
        language === 'en'
          ? 'Calendar update ready. Review and confirm.'
          : 'Mise à jour de l’événement prête. Vérifie et confirme.',
      proposals: [buildUpdateCalendarProposal(input, assistantProfile)],
    }
  }

  if (
    isMeetingRequest &&
    /(gmail|email|e-mail|mail|send|envoie|envoyer|courriel|lien|link)/.test(intentText) &&
    explicitlyWantsSeparateEmail
  ) {
    if (!hasResolvableCalendarSchedule(input, assistantProfile?.meetingDefaultDurationMinutes || 30)) {
      const attendeeEmails = getCalendarAttendeesFromInput(input, knownContact)
      return {
        response:
          language === 'en'
            ? `Yes. I can prepare it. I still need the date and exact time${attendeeEmails.length > 0 ? `, and I'll keep ${attendeeEmails.join(', ')} as attendee${attendeeEmails.length > 1 ? 's' : ''}` : ''}.`
            : `Oui. Je peux le préparer. Il me manque juste la date et l’heure exacte${attendeeEmails.length > 0 ? `, et je garde ${attendeeEmails.join(', ')} en invité${attendeeEmails.length > 1 ? 's' : ''}` : ''}.`,
        proposals: [],
      }
    }

    const calProp = buildCalendarProposal(input, assistantProfile, knownContact)
    const durationMinutes = assistantProfile?.meetingDefaultDurationMinutes || 30
    return {
      response:
        language === 'en'
          ? `I used the next matching slot in Europe/Paris (${durationMinutes} min default). Say if the timezone, duration, or exact week should change before you approve. The invite includes Google Meet; the email will carry the same link once the event is created.`
          : `J’ai pris le prochain créneau qui correspond (Europe/Paris, ${durationMinutes} min par défaut). Dis-moi si le fuseau, la durée ou la semaine doivent changer avant validation. L’invitation inclut Google Meet ; l’email reprendra le même lien après création de l’événement.`,
      proposals: [
        calProp,
        buildMeetingEmailFollowupProposal(input, knownContact, assistantProfile),
      ],
    }
  }

  if ((isMeetingRequest || (wantsMeetingConfirmation && knownContact)) && !explicitEmailIntent) {
    if (!hasResolvableCalendarSchedule(input, assistantProfile?.meetingDefaultDurationMinutes || 30)) {
      const attendeeEmails = getCalendarAttendeesFromInput(input, knownContact)
      return {
        response:
          language === 'en'
            ? `Yes. I can prepare it. I still need the date and exact time${attendeeEmails.length > 0 ? `, and I'll keep ${attendeeEmails.join(', ')} as attendee${attendeeEmails.length > 1 ? 's' : ''}` : ''}.`
            : `Oui. Je peux le préparer. Il me manque juste la date et l’heure exacte${attendeeEmails.length > 0 ? `, et je garde ${attendeeEmails.join(', ')} en invité${attendeeEmails.length > 1 ? 's' : ''}` : ''}.`,
        proposals: [],
      }
    }

    const calProp = buildCalendarProposal(input, assistantProfile, knownContact)
    const title = typeof calProp.parameters.title === 'string' ? calProp.parameters.title : ''
    const mentionsMeet = Boolean(calProp.parameters.createMeetLink)
    return {
      response:
        language === 'en'
          ? mentionsMeet
            ? `Done. "${title}" is ready with a Google Meet link.`
            : `Done. "${title}" is ready for review.`
          : mentionsMeet
            ? `C'est prêt. "${title}" avec lien Google Meet.`
            : `C'est prêt. "${title}" est prêt à vérifier.`,
      proposals: [calProp],
    }
  }

  if (explicitReplyIntent && /(gmail|email|e-mail|mail|message|messages|thread)/.test(intentText)) {
    return {
      response:
        language === 'en'
          ? 'Reply draft ready. Review and confirm.'
          : 'Réponse prête. Vérifie et confirme.',
      proposals: [buildEmailReplyProposal(input, assistantProfile)],
    }
  }

  if (explicitForwardIntent && /(gmail|email|e-mail|mail|message|messages|thread)/.test(intentText)) {
    return {
      response:
        language === 'en'
          ? 'Forward is ready. Review and confirm.'
          : 'Transfert prêt. Vérifie et confirme.',
      proposals: [buildForwardEmailProposal(input, assistantProfile, knownContact)],
    }
  }

  if ((archiveIntent || unarchiveIntent || labelIntent || removeLabelIntent || markReadIntent || markUnreadIntent || starIntent || unstarIntent || trashIntent || permanentDeleteIntent || sendDraftIntent) && /(gmail|email|e-mail|mail|message|messages|thread|inbox|draft|brouillon)/.test(intentText)) {
    if (sendDraftIntent) {
      return {
        response:
          language === 'en'
            ? 'Draft send is ready for review.'
            : 'Envoi du brouillon prêt à valider.',
        proposals: [buildSendGmailDraftProposal(assistantProfile)],
      }
    }

    if (unarchiveIntent) {
      return {
        response:
          language === 'en'
            ? 'Inbox restore ready.'
            : 'Restauration inbox prête.',
        proposals: [buildUnarchiveEmailProposal(assistantProfile)],
      }
    }

    if (trashIntent) {
      return {
        response:
          language === 'en'
            ? 'Trash action ready.'
            : 'Mise en corbeille prête.',
        proposals: [buildTrashGmailProposal(assistantProfile)],
      }
    }

    if (permanentDeleteIntent) {
      return {
        response:
          language === 'en'
            ? 'Permanent delete ready for review.'
            : 'Suppression définitive prête à valider.',
        proposals: [buildDeleteGmailProposal(assistantProfile)],
      }
    }

    if (unstarIntent) {
      return {
        response:
          language === 'en'
            ? 'Unstar action ready.'
            : 'Retrait de l’étoile prêt.',
        proposals: [buildStarGmailProposal(false, assistantProfile)],
      }
    }

    if (starIntent) {
      return {
        response:
          language === 'en'
            ? 'Star action ready.'
            : 'Ajout d’étoile prêt.',
        proposals: [buildStarGmailProposal(true, assistantProfile)],
      }
    }

    if (archiveIntent) {
      return {
        response:
          language === 'en'
            ? 'Archive action ready.'
            : 'Archivage prêt.',
        proposals: [buildArchiveEmailProposal(assistantProfile)],
      }
    }

    if (removeLabelIntent) {
      return {
        response:
          language === 'en'
            ? 'Label removal is ready.'
            : 'Retrait du label prêt.',
        proposals: [buildRemoveLabelEmailProposal(input, assistantProfile)],
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

  if (/(google doc|google docs|doc\b|document|brief|report|summary|compte rendu|compte-rendu|rapport|note)/.test(intentText)) {
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

  if (/(google drive|drive\b|dossier|folder|upload|save to drive|save in drive|enregistrer dans drive|mettre dans drive|stocke.*drive)/.test(intentText)) {
    if (appDataIntent) {
      if (deleteIntent) {
        return {
          response:
            language === 'en'
              ? 'Drive app data deletion is ready for review.'
              : 'Suppression des données app Drive prête à valider.',
          proposals: [buildDeleteDriveAppDataProposal(input, assistantProfile)],
        }
      }

      return {
        response:
          language === 'en'
            ? updateIntent ? 'Drive app data update is ready.' : 'Drive app data is ready.'
            : updateIntent ? 'Mise à jour des données app Drive prête.' : 'Données app Drive prêtes.',
        proposals: [buildDriveAppDataProposal(input, updateIntent, assistantProfile)],
      }
    }

    if (createFolderIntent) {
      return {
        response:
          language === 'en'
            ? 'Drive folder creation ready.'
            : 'Création du dossier Drive prête.',
        proposals: [buildGoogleDriveFolderProposal(input, assistantProfile)],
      }
    }

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

    if (unshareIntent) {
      return {
        response:
          language === 'en'
            ? 'Drive access removal ready.'
            : 'Retrait d’accès Drive prêt.',
        proposals: [buildUnshareGoogleDriveProposal(input, knownContact, assistantProfile)],
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

    if (copyIntent) {
      return {
        response:
          language === 'en'
            ? 'Drive copy ready.'
            : 'Copie Drive prête.',
        proposals: [buildCopyGoogleDriveProposal(input, assistantProfile)],
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

  if (
    /(google photos|photos|photo|album|image)/.test(intentText) &&
    /(search|cherche|chercher|find|find me|retrouve|list|liste|show|montre|open|ouvrir|ouvre|select|selectionne|selectionner|choisir|choisis)/.test(intentText)
  ) {
    return {
      response:
        language === 'en'
          ? 'Google Photos access is ready.'
          : 'Accès Google Photos prêt.',
      proposals: [buildGooglePhotosProposal(input, assistantProfile)],
    }
  }

  if (/(notion|wiki|database|base de donnees|base de données|workspace|page)/.test(intentText)) {
    if (notionArchiveIntent && !notionPropertiesIntent && !updateIntent) {
      return {
        response:
          language === 'en'
            ? 'Notion archive ready for review.'
            : 'Archivage Notion prêt à valider.',
        proposals: [buildArchiveNotionPageProposal(assistantProfile)],
      }
    }

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

  if (isEmailSendIntent(intentText)) {
    const matchedEmail = firstRealRecipientEmailFromInput(input)
    const ambiguousRecipients = contactMatchIsAmbiguous(contactCandidates)

    if (updateIntent && draftIntent) {
      return {
        response:
          language === 'en'
            ? 'Draft update is ready. Review and confirm.'
            : 'Mise à jour du brouillon prête. Vérifie et confirme.',
        proposals: [{
          type: 'update_gmail_draft',
          title: language === 'en' ? 'Update Gmail draft' : 'Mettre à jour le brouillon Gmail',
          description:
            language === 'en'
              ? 'Update the matching Gmail draft before sending it.'
              : 'Mettre à jour le brouillon Gmail correspondant avant envoi.',
          parameters: {
            draftId: '',
            subject: buildEmailSubject(input, assistantProfile),
            body: buildExecutiveEmailBody(input, assistantProfile),
          },
          confidenceScore: 0.76,
        }],
      }
    }

    if (draftIntent) {
      if (!matchedEmail && ambiguousRecipients) {
        return {
          response:
            language === 'en'
              ? 'Several contacts match that name. Pick the right recipient.'
              : 'Plusieurs contacts correspondent à ce nom. Choisis le bon destinataire.',
          proposals: [],
          disambiguations: [buildContactRecipientDisambiguation(contactCandidates, 'create_gmail_draft', language)],
        }
      }

      if (!matchedEmail && maybeRecipient && !knownContact) {
        return {
          response:
            language === 'en'
              ? `I don’t have "${maybeRecipient}" in workspace contacts yet. I’ll look them up from your Gmail threads when you confirm the next step, or paste their email here.`
              : `Je n’ai pas encore « ${maybeRecipient} » en contacts workspace : je peux retrouver son adresse dans tes mails (envoyés/reçus) si Gmail est connecté, ou colle son email ici.`,
          proposals: [],
        }
      }

      if (matchedEmail) {
        const resolvedName =
          knownContact && knownContact.email.toLowerCase() === matchedEmail ? knownContact.name : undefined
        return {
          response:
            language === 'en'
              ? 'Draft ready. Review and confirm.'
              : 'Brouillon prêt. Vérifie et confirme.',
          proposals: [buildGmailDraftProposal(input, assistantProfile, [matchedEmail], resolvedName)],
        }
      }

      if (knownContact) {
        return {
          response:
            language === 'en'
              ? `Draft ready for ${knownContact.name}. Review and confirm.`
              : `Brouillon prêt pour ${knownContact.name}. Vérifie et confirme.`,
          proposals: [buildGmailDraftProposal(input, assistantProfile, [knownContact.email], knownContact.name)],
        }
      }

      return {
        response:
          language === 'en'
            ? 'Who is the draft for? Give an email, a full name (I can match Gmail history), or a workspace contact.'
            : 'Pour qui est le brouillon ? Donne un email, un nom complet (je peux le retrouver dans Gmail), ou un contact workspace.',
        proposals: [],
      }
    }

    if (!matchedEmail && ambiguousRecipients) {
      return {
        response:
          language === 'en'
            ? 'Several contacts match that name. Pick the right recipient.'
            : 'Plusieurs contacts correspondent à ce nom. Choisis le bon destinataire.',
        proposals: [],
        disambiguations: [buildContactRecipientDisambiguation(contactCandidates, 'send_email', language)],
      }
    }

    if (!matchedEmail && maybeRecipient && !knownContact) {
      return {
        response:
          language === 'en'
            ? `No saved address for "${maybeRecipient}" in workspace contacts. I can resolve it from Gmail threads when connected, or paste their email.`
            : `Pas d’adresse enregistrée pour « ${maybeRecipient} » : je peux la retrouver dans tes mails Gmail si la connexion est active, ou colle son email.`,
        proposals: [],
      }
    }

    if (matchedEmail) {
      const resolvedName =
        knownContact && knownContact.email.toLowerCase() === matchedEmail ? knownContact.name : undefined
      return {
        response:
          language === 'en'
            ? 'Email ready. Check the details and confirm.'
            : 'Email prêt. Vérifie les détails et confirme.',
        proposals: [buildEmailProposal(input, assistantProfile, [matchedEmail], resolvedName)],
      }
    }

    if (knownContact) {
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
          ? 'Who should receive this? Share an email or a person’s name (I’ll match Gmail + contacts).'
          : 'À qui part ce mail ? Donne une adresse ou un nom (je croise Gmail et tes contacts).',
      proposals: [],
    }
  }

  return {
    response:
      language === 'en'
        ? 'I didn’t connect that to a clear next step. Say it in one sentence: who it’s for, what you want (email, invite, doc, etc.), and any date or subject.'
        : 'Je n’ai pas relié ça à une suite claire. Reformule en une phrase : pour qui, ce que tu veux (mail, invitation, doc…), et la date ou le sujet si besoin.',
    proposals: [],
  }
}
