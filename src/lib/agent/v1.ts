import { analyzeUserRequest, isOpenAiConfigured } from '@/lib/ai/client'
import {
  executiveAssistantSkills,
  resolveEnabledAssistantSkills,
  type AssistantProfile,
} from '@/lib/assistant/profile'
import { prepareActionParameters } from '@/lib/agent/data-prep'
import {
  agentActionTypeSchema,
  buildCapabilityResponse,
  buildConversationalResponse,
  buildDisambiguationResponse,
  buildFallbackResponseWithContactsAndProfile,
  isCapabilityQuestion,
  isConversationalInput,
  isEmailCompositionAssistanceRequest,
  shouldPreferDeterministicAction,
  type AgentActionType,
  type AgentProposal,
  type AgentTurnResult,
} from '@/lib/agent/v1-deterministic'
import { resolveActionReferencesDetailed } from '@/lib/agent/reference-resolution'
import {
  extractEmailAddresses,
  extractGmailLookupNameQuery,
  extractRecipientName,
  findContactByName,
  type KnownContact,
} from '@/lib/contacts'
import { getToolByActionType, listMcpTools } from '@/lib/mcp/registry'

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

  return /(google meet|meet|visio|visioconference|visioconférence|video|vidéo|remote|zoom|teams)/i.test(input)
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
    /\b(demain|tomorrow|aujourd'hui|aujourdhui|today|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(
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

export function responseClaimsActionReady(response: string) {
  return /(c'?est pret|c'est pret|pret(?:e)?|ready|done|prepared|action prete|email pret|draft ready|brouillon pret|rdv pret|invite ready|partage drive pret|archivage pret|sera archive(?:e)?|will be archived|va etre archive(?:e)?|session google photos ouverte|google photos session opened|picker google photos ouvert|google photos picker opened)/i.test(
    response
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
  )
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
    if (isOpenAiConfigured()) {
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
          disambiguations: [],
        }
      } catch {
        // Fall back to deterministic conversation if the model is unavailable.
      }
    }

    return {
      response: buildConversationalResponse(input, assistantProfile),
      proposals: [],
      disambiguations: [],
    }
  }

  if (availableTools.length === 0) {
    return {
      response:
        assistantProfile?.defaultLanguage === 'en'
          ? 'I can answer questions normally, but this workspace role is not allowed to execute connected app actions.'
          : 'Je peux répondre normalement, mais ce rôle workspace n’est pas autorisé à exécuter des actions sur les applications connectées.',
      proposals: [],
      disambiguations: [],
    }
  }

  const deterministicFallback = buildFallbackResponseWithContactsAndProfile(input, knownContacts, assistantProfile)

  if (deterministicFallback.disambiguations && deterministicFallback.disambiguations.length > 0) {
    return {
      response: buildDisambiguationResponse(deterministicFallback.disambiguations, assistantProfile),
      proposals: [],
      disambiguations: deterministicFallback.disambiguations,
    }
  }

  const deterministicResolution = resolveActionReferencesDetailed({
    proposals: deterministicFallback.proposals.filter((proposal) => allowedActionTypes.includes(proposal.type)),
    userInput: input,
    connectedContextMetadata: options.connectedContextMetadata,
  })
  const deterministicFilteredProposals = deterministicResolution.proposals

  if (isCapabilityQuestion(input, deterministicFallback.proposals)) {
    return {
      response: buildCapabilityResponse(input, deterministicFallback.proposals, assistantProfile),
      proposals: [],
      disambiguations: [],
    }
  }

  if (shouldPreferDeterministicAction(input, deterministicFallback.proposals)) {
    return {
      response:
        deterministicResolution.disambiguations.length > 0
          ? buildDisambiguationResponse(deterministicResolution.disambiguations, assistantProfile)
          : deterministicFallback.proposals.length > 0 && deterministicFilteredProposals.length === 0
            ? assistantProfile?.defaultLanguage === 'en'
              ? 'I understood the request, but your workspace role is not allowed to use that tool.'
              : 'J’ai compris la demande, mais ton rôle workspace n’est pas autorisé à utiliser cet outil.'
            : deterministicFallback.response,
      proposals: deterministicResolution.disambiguations.length > 0 ? [] : deterministicFilteredProposals,
      disambiguations: deterministicResolution.disambiguations,
    }
  }

  if (isOpenAiConfigured()) {
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
          const explicitInputEmails = extractEmailAddresses(input)
          const maybeRecipient = extractRecipientName(input) || extractGmailLookupNameQuery(input)
          const knownContact = maybeRecipient ? findContactByName(maybeRecipient, knownContacts) : null

          const forceMeetOff = requestForcesMeetLinkOff(input)
          const wantsMeet = requestNeedsMeetLink(input)

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

        const maybeRecipient = extractRecipientName(input) || extractGmailLookupNameQuery(input)
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

      const safeProposals = enrichedProposals.map((proposal) => {
        if (proposal.type === 'create_calendar_event' && !hasConcreteCalendarSchedule(input)) {
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

      const normalizedInput = normalizeInput(input)
      const allowProposals = /(send|email|mail|draft|reply|write|create|update|schedule|book|invite|plan|share|upload|save|store|sync|connect|disconnect|refresh|archive|unarchive|restore|label|forward|move|rename|star|unstar|trash|copy|duplicate|revoke|unshare|folder|open|ouvrir|ouvre|select|selectionne|selectionner|choisis|choisir|gmail|google calendar|calendar|calendrier|google meet|meet|google docs|google doc|docs|document|notion|google drive|drive|google photos|photos|photo|visio|réunion|reunion|dossier|folder|fichier|file|page|database|base de donnees|base de données|doc\\b|appdata|app data)/i.test(normalizedInput)
      const modelClaimsActionReadyWithoutProposal =
        allowProposals &&
        aiResult.proposals.length === 0 &&
        safeProposals.length === 0 &&
        responseClaimsActionReady(aiResult.response)
      const hadModelProposalButNoneValidated = allowProposals && aiResult.proposals.length > 0 && safeProposals.length === 0
      const fallbackResolutionForMissingOrInvalidModel = hadModelProposalButNoneValidated || modelClaimsActionReadyWithoutProposal
        ? resolveActionReferencesDetailed({
            proposals: (() => {
              const raw = buildFallbackResponseWithContactsAndProfile(input, knownContacts, assistantProfile).proposals.filter(
                (proposal) => allowedActionTypes.includes(proposal.type)
              )
              if (isEmailCompositionAssistanceRequest(input)) {
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
            userInput: input,
            connectedContextMetadata: options.connectedContextMetadata,
          })
        : { proposals: [], disambiguations: [] }
      const fallbackForMissingOrInvalidModelProposal = fallbackResolutionForMissingOrInvalidModel.proposals
      const deniedByRole =
        hadModelProposalButNoneValidated &&
        fallbackForMissingOrInvalidModelProposal.length === 0 &&
        availableTools.length === 0
      const hasDisambiguation =
        resolvedReferenceResult.disambiguations.length > 0 ||
        fallbackResolutionForMissingOrInvalidModel.disambiguations.length > 0
      const disambiguations = hasDisambiguation
        ? [
            ...resolvedReferenceResult.disambiguations,
            ...fallbackResolutionForMissingOrInvalidModel.disambiguations,
          ]
        : []
      const deterministicFallbackResponse = buildFallbackResponseWithContactsAndProfile(input, knownContacts, assistantProfile)
      const shouldUseFallbackResponse =
        allowProposals &&
        !hasDisambiguation &&
        safeProposals.length === 0 &&
        (fallbackForMissingOrInvalidModelProposal.length > 0 || responseClaimsActionReady(aiResult.response))

      return {
        response:
          hasDisambiguation
            ? buildDisambiguationResponse(disambiguations, assistantProfile)
            : deniedByRole
              ? assistantProfile?.defaultLanguage === 'en'
                ? 'I understood the request, but your workspace role is not allowed to use that tool.'
                : 'J’ai compris la demande, mais ton rôle workspace n’est pas autorisé à utiliser cet outil.'
              : shouldUseFallbackResponse
                ? deterministicFallbackResponse.response
                : safeProposals.some((proposal) => proposal.type === 'create_calendar_event' && proposal.confidenceScore <= 0.35)
                  ? deterministicFallbackResponse.response
                  : !allowProposals && safeProposals.length > 0
                    ? buildConversationalResponse(input, assistantProfile)
                    : aiResult.response,
        proposals:
          hasDisambiguation
            ? []
            : allowProposals
              ? safeProposals.length > 0
                ? safeProposals.filter(
                    (proposal) => !(proposal.type === 'create_calendar_event' && proposal.confidenceScore <= 0.35)
                  )
                : fallbackForMissingOrInvalidModelProposal
              : [],
        disambiguations,
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
        disambiguations: fallbackResolution.disambiguations,
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
    disambiguations: fallbackResolution.disambiguations,
  }
}
