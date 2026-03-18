import { z } from 'zod'
import { analyzeUserRequest } from '@/lib/ai/client'
import { executiveAssistantSkills, type AssistantProfile } from '@/lib/assistant/profile'
import { extractRecipientName, findContactByName, type KnownContact } from '@/lib/contacts'
import { prepareActionParameters } from '@/lib/agent/data-prep'
import { getToolByActionType, listMcpTools } from '@/lib/mcp/registry'
import { isEmailSendIntent, isReadOnlyWorkspaceQuestion } from '@/lib/workspace-context/intents'

export const agentActionTypeSchema = z.enum([
  'send_email',
  'create_calendar_event',
  'update_notion_page',
  'create_notion_page',
  'create_google_doc',
  'update_google_doc',
  'create_google_drive_file',
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
  /(send|email|mail|draft|reply|write|create|update|schedule|book|invite|plan|share|upload|save|store|sync|connect|disconnect|refresh|envoie|envoyer|rédige|redige|écris|ecris|crée|cree|mets|mettre|ajoute|ajouter|planifie|programme|partage|enregistre|stocke|sauvegarde|connecte|déconnecte|deconnecte|actualise|rafraichis)/i
const appIntentPattern =
  /(gmail|google calendar|calendar|calendrier|google meet|meet|google docs|google doc|docs|document|notion|google drive|drive|visio|réunion|reunion|dossier|folder|fichier|file|page|doc\b)/i
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
  const meetingTitle =
    contact
      ? profile?.defaultLanguage === 'en'
        ? `Meeting with ${contact.name}`
        : `Reunion avec ${contact.name}`
      : input.length > 80
        ? `${input.slice(0, 77)}...`
        : input

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
        },
        confidenceScore: 0.82,
      }
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

  if (
    isMeetingRequest &&
    /(gmail|email|e-mail|mail|send|envoie|envoyer|courriel|lien|link)/.test(normalized) &&
    explicitlyWantsSeparateEmail
  ) {
    return {
      response:
        language === 'en'
          ? 'I prepared the calendar event and the follow-up email with the meeting link.'
          : "J'ai prepare l'evenement calendar et l'email avec le lien de reunion.",
      proposals: [
        buildCalendarProposal(input, assistantProfile, knownContact),
        buildMeetingEmailFollowupProposal(input, knownContact, assistantProfile),
      ],
    }
  }

  if (isMeetingRequest || (wantsMeetingConfirmation && knownContact)) {
    return {
      response:
        language === 'en'
          ? knownContact
            ? `I prepared a Google Calendar invite with Google Meet for ${knownContact.name}.`
            : 'I prepared a Google Calendar invite with a meeting link.'
          : knownContact
            ? `J'ai préparé une invitation Google Calendar avec Google Meet pour ${knownContact.name}.`
            : "J'ai préparé une invitation Google Calendar avec lien de réunion.",
      proposals: [buildCalendarProposal(input, assistantProfile, knownContact)],
    }
  }

  if (isEmailSendIntent(normalized)) {
    const matchedEmail = input.match(emailPattern)?.[1]
    if (!matchedEmail) {
      if (maybeRecipient) {
        if (knownContact) {
          return {
            response:
              language === 'en'
                ? `I recognized ${knownContact.name} in your contacts and prepared the Gmail action using ${knownContact.email}.`
                : `J’ai reconnu ${knownContact.name} dans vos contacts et préparé l’action Gmail avec ${knownContact.email}.`,
            proposals: [buildResolvedEmailProposal(input, knownContact, assistantProfile)],
          }
        }
      }
    }

    return {
      response:
        language === 'en'
          ? 'I prepared a Gmail action for review.'
          : 'J’ai préparé une action Gmail à valider.',
      proposals: [buildEmailProposal(input, assistantProfile)],
    }
  }

  if (/(google doc|google docs|doc\b|document|brief|report|summary|compte rendu|compte-rendu|rapport|note)/.test(normalized)) {
    return {
      response:
        language === 'en'
          ? 'I prepared a Google Docs action for review.'
          : 'J’ai préparé une action Google Docs à valider.',
      proposals: [buildGoogleDocProposal(input, assistantProfile)],
    }
  }

  if (/(google drive|drive\b|dossier|folder|upload|save to drive|save in drive|enregistrer dans drive|mettre dans drive|stocke.*drive)/.test(normalized)) {
    return {
      response:
        language === 'en'
          ? 'I prepared a Google Drive action for review.'
          : 'J’ai préparé une action Google Drive à valider.',
      proposals: [buildGoogleDriveProposal(input, assistantProfile)],
    }
  }

  if (/(notion|wiki|database|base de donnees|base de données|workspace|page)/.test(normalized)) {
    return {
      response:
        language === 'en'
          ? 'I prepared a Notion action for review.'
          : 'J’ai préparé une action Notion à valider.',
      proposals: [buildNotionProposal(input, assistantProfile)],
    }
  }

  return {
    response:
      language === 'en'
        ? 'I can convert that into an action for Gmail, Google Calendar, Google Drive, Notion, or Google Docs. Specify the target app or intended result and I will prepare it.'
        : 'Je peux transformer cela en action pour Gmail, Google Calendar, Google Drive, Notion ou Google Docs. Précisez l’application cible ou le résultat attendu et je la préparerai.',
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
  } = {}
): Promise<AgentTurnResult> {
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
            skills: executiveAssistantSkills.filter((skill) =>
              assistantProfile?.enabledSkills?.includes(skill.id) ?? true
            ),
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
          skills: executiveAssistantSkills.filter((skill) =>
            assistantProfile?.enabledSkills?.includes(skill.id) ?? true
          ),
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

      const enrichedProposals = proposals.map((proposal) => {
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

        if (proposal.type !== 'send_email') {
          return proposal
        }

        const to = Array.isArray(proposal.parameters.to) ? proposal.parameters.to : []
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
          title: `Send email to ${knownContact.name}`,
          parameters: {
            ...proposal.parameters,
            to: [knownContact.email],
            resolvedContactName: knownContact.name,
          },
          confidenceScore: Math.max(proposal.confidenceScore, 0.93),
        }
      })

      const safeProposals = enrichedProposals.map((proposal) => {
        if (proposal.type !== 'send_email' || !hasPlaceholderRecipient(proposal.parameters)) {
          return proposal
        }

        return {
          ...proposal,
          confidenceScore: Math.min(proposal.confidenceScore, 0.45),
        }
      })

      const allowProposals = isActionRequest(input)
      const deniedByRole = allowProposals && aiResult.proposals.length > 0 && safeProposals.length === 0

      return {
        response:
          deniedByRole
            ? assistantProfile?.defaultLanguage === 'en'
              ? 'I understood the request, but your workspace role is not allowed to use that tool.'
              : 'J’ai compris la demande, mais ton rôle workspace n’est pas autorisé à utiliser cet outil.'
            : !allowProposals && safeProposals.length > 0
            ? buildConversationalResponse(input, assistantProfile)
            : aiResult.response,
        proposals: allowProposals ? safeProposals : [],
      }
    } catch {
      const fallback = buildFallbackResponseWithContactsAndProfile(input, knownContacts, assistantProfile)
      const filteredProposals = fallback.proposals.filter((proposal) => allowedActionTypes.includes(proposal.type))

      return {
        response:
          fallback.proposals.length > 0 && filteredProposals.length === 0
            ? assistantProfile?.defaultLanguage === 'en'
              ? 'I understood the request, but your workspace role is not allowed to use that tool.'
              : 'J’ai compris la demande, mais ton rôle workspace n’est pas autorisé à utiliser cet outil.'
            : fallback.response,
        proposals: filteredProposals,
      }
    }
  }

  const fallback = buildFallbackResponseWithContactsAndProfile(input, knownContacts, assistantProfile)
  const filteredProposals = fallback.proposals.filter((proposal) => allowedActionTypes.includes(proposal.type))

  return {
    response:
      fallback.proposals.length > 0 && filteredProposals.length === 0
        ? assistantProfile?.defaultLanguage === 'en'
          ? 'I understood the request, but your workspace role is not allowed to use that tool.'
          : 'J’ai compris la demande, mais ton rôle workspace n’est pas autorisé à utiliser cet outil.'
        : fallback.response,
    proposals: filteredProposals,
  }
}
