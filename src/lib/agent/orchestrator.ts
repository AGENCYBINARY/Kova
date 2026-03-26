import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { analyzeUserRequest, isLowValueAssistantResponse } from '@/lib/ai/client'
import {
  createAuditLog,
  createConnectedReadAuditLog,
  createDecisionAuditLog,
  createFallbackAuditLog,
  createToolVisibilityAuditLog,
} from '@/lib/audit/service'
import { getAssistantProfile } from '@/lib/assistant/store'
import { runAgentTurn } from '@/lib/agent/v1'
import { buildCalendarRedoFollowUp } from '@/lib/agent/follow-up'
import { claimPendingActionIds } from '@/lib/actions/claim-pending'
import { executePersistedActionBatch } from '@/lib/actions/execute-persisted-batch'
import { getWorkspaceGovernance } from '@/lib/agent/governance'
import { inferRiskLevel, resolveExecutionDecision } from '@/lib/agent/policy'
import {
  extractEmailAddresses,
  extractNameBeforeEmail,
  extractNameNearEmail,
  extractRecipientName,
  findContactByName,
  listKnownContacts,
  looksLikeContactCorrection,
  rememberContact,
} from '@/lib/contacts'
import { findGoogleContactEmail, getValidGoogleAccessToken } from '@/lib/integrations/google'
import { buildConnectedContextFallbackResponse, buildDeterministicConnectedResponse } from '@/lib/workspace-context/fallback'
import { resolveConnectedWorkspaceContext } from '@/lib/workspace-context/service'
import type { ConnectedContextSeed, ConnectedContextSource } from '@/lib/workspace-context/intents'
import type { ReferenceDisambiguation } from '@/lib/agent/reference-resolution'

export type ChatExecutionMode = 'ask' | 'auto'

interface ChatContext {
  userId: string
  workspaceId: string
}

interface PersistedMessageRecord {
  role: string
  content: string
  metadata: unknown
}

interface PendingActionRecord {
  id: string
  type: string
  title: string
  description: string
  parameters: Record<string, unknown>
}

interface ChatMessageMetadata {
  disambiguations?: ReferenceDisambiguation[]
}

interface CorrectedContactResult {
  correctedContact: {
    name: string
    email: string
    aliases: string[]
  }
  updatedPendingAction?: PendingActionRecord
  assistantResponse?: string
}

function mapChatRole(role: string): 'user' | 'assistant' {
  return role === 'user' ? 'user' : 'assistant'
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return {}
}

function toJsonValue(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

export async function getChatPageData(context: ChatContext) {
  const [messages, actions] = await Promise.all([
    prisma.message.findMany({
      where: {
        userId: context.userId,
        workspaceId: context.workspaceId,
      },
      orderBy: { createdAt: 'desc' },
      take: 60,
    }),
    prisma.action.findMany({
      where: {
        userId: context.userId,
        workspaceId: context.workspaceId,
        status: 'pending',
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ])

  return {
    messages:
      messages.length > 0
        ? [...messages].reverse().map((message) => ({
            id: message.id,
            role: mapChatRole(message.role),
            content: message.content,
            metadata: asRecord(message.metadata) as ChatMessageMetadata,
          }))
        : [buildWelcomeMessage()],
    proposals: [...actions].reverse().map((action) => ({
      id: action.id,
      type: action.type,
      title: action.title,
      description: action.description,
      parameters: asRecord(action.parameters),
    })),
  }
}

export async function orchestrateChatTurn(params: {
  content: string
  executionMode: ChatExecutionMode
  context: ChatContext
}) {
  const { userId, workspaceId } = params.context
  const previousMessagesPromise = prisma.message.findMany({
    where: {
      userId,
      workspaceId,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  const knownContactsPromise = listKnownContacts({
    userId,
    workspaceId,
  })
  const assistantProfilePromise = getAssistantProfile(workspaceId)
  const governancePromise = getWorkspaceGovernance({
    workspaceId,
    userId,
  })
  const pendingActionsPromise = prisma.action.findMany({
    where: {
      userId,
      workspaceId,
      status: 'pending',
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
  const recentActionsPromise = prisma.action.findMany({
    where: {
      userId,
      workspaceId,
      status: {
        in: ['pending', 'rejected'],
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 10,
  })

  const previousMessages = [...(await previousMessagesPromise)].reverse()
  const [knownContacts, assistantProfile, governance, pendingActionsRaw, recentActionsRaw] = await Promise.all([
    knownContactsPromise,
    assistantProfilePromise,
    governancePromise,
    pendingActionsPromise,
    recentActionsPromise,
  ])
  const pendingActions = pendingActionsRaw.map((action) => ({
    id: action.id,
    type: action.type,
    title: action.title,
    description: action.description,
    parameters: asRecord(action.parameters),
  })) satisfies PendingActionRecord[]
  const recentActions = recentActionsRaw.map((action) => ({
    id: action.id,
    type: action.type,
    title: action.title,
    description: action.description,
    parameters: asRecord(action.parameters),
  })) satisfies PendingActionRecord[]

  await createToolVisibilityAuditLog({
    workspaceId,
    userId,
    source: 'chat',
    visibleTools: governance.allowedActionTypes,
    allowedActionTypes: governance.allowedActionTypes,
  })

  const conversationHistory = previousMessages.map((message) => ({
    role: message.role as 'user' | 'assistant',
    content: message.content,
  }))

  const connectedContextSeed = extractConnectedContextSeed(previousMessages)
  const connectedContextResult = await resolveConnectedWorkspaceContext({
    content: params.content,
    userId,
    workspaceId,
    contextSeed: connectedContextSeed,
  })

  if (connectedContextResult?.request.mode === 'read') {
    return orchestrateConnectedReadTurn({
      content: params.content,
      context: params.context,
      conversationHistory,
      governanceRole: governance.role,
      assistantProfile,
      connectedContextResult,
    })
  }

  const correctedContact = await resolveCorrectedContactFromChatInput({
    content: params.content,
    previousMessages,
    pendingActions,
    knownContacts,
    userId,
    workspaceId,
  })

  if (correctedContact?.updatedPendingAction && correctedContact.assistantResponse) {
    const [userMessage, assistantMessage] = await prisma.$transaction([
      prisma.message.create({
        data: {
          content: params.content,
          role: 'user',
          userId,
          workspaceId,
        },
      }),
      prisma.message.create({
        data: {
          content: correctedContact.assistantResponse,
          role: 'assistant',
          metadata: {
            proposalCount: 1,
            workspaceRole: governance.role,
            correctedActionId: correctedContact.updatedPendingAction.id,
          },
          userId,
          workspaceId,
        },
      }),
    ])

    await createDecisionAuditLog({
      workspaceId,
      userId,
      source: 'chat',
      executionMode: 'ask',
      executionReason: 'recipient_correction',
      proposalCount: 1,
      details: {
        actionId: correctedContact.updatedPendingAction.id,
        actionType: correctedContact.updatedPendingAction.type,
      },
    })

    return {
      userMessage,
      assistantMessage,
      proposals: [correctedContact.updatedPendingAction],
      disambiguations: [],
      executionMessages: [],
      effectiveExecutionMode: 'ask',
      executionModeReason: 'recipient_correction',
      workspaceRole: governance.role,
    }
  }

  const contactsAfterCorrection = correctedContact?.correctedContact
    ? [
        correctedContact.correctedContact,
        ...knownContacts.filter((contact) => contact.email !== correctedContact.correctedContact.email),
      ]
    : knownContacts

  const googleResolvedContact =
    assistantProfile.autoResolveKnownContacts
      ? await resolveEmailContactFromGoogle({
          content: params.content,
          knownContacts: contactsAfterCorrection,
          userId,
          workspaceId,
        })
      : null

  const effectiveKnownContacts = googleResolvedContact
    ? [
        googleResolvedContact,
        ...contactsAfterCorrection.filter((contact) => contact.email !== googleResolvedContact.email),
      ]
    : contactsAfterCorrection

  const calendarRedoFollowUp = buildCalendarRedoFollowUp({
    input: params.content,
    recentActions,
    language: assistantProfile.defaultLanguage,
  })

  const agentResult = calendarRedoFollowUp
    ? {
        response: calendarRedoFollowUp.response,
        proposals: calendarRedoFollowUp.proposals,
        disambiguations: [],
      }
    : await runAgentTurn(
        params.content,
        conversationHistory,
        effectiveKnownContacts,
        assistantProfile,
        governance.allowedActionTypes,
        {
          workspaceContext: connectedContextResult?.workspaceContext,
          connectedContextMetadata: connectedContextResult?.metadata,
        }
      )
  const agentDisambiguations = agentResult.disambiguations || []

  const executionDecision = resolveExecutionDecision({
    requestedMode: params.executionMode,
    proposals: agentResult.proposals.map((proposal) => ({
      type: proposal.type,
      confidenceScore: proposal.confidenceScore,
      parameters: proposal.parameters,
    })),
    assistantProfile,
  })
  const effectiveExecutionMode = executionDecision.effectiveMode
  const assistantMetadata = toJsonValue({
    proposalCount: agentResult.proposals.length,
    workspaceRole: governance.role,
    ...(agentDisambiguations.length > 0 ? { disambiguations: agentDisambiguations } : {}),
    ...(connectedContextResult?.metadata || {}),
  })

  const [userMessage, assistantMessage] = await prisma.$transaction([
    prisma.message.create({
      data: {
        content: params.content,
        role: 'user',
        userId,
        workspaceId,
      },
    }),
    prisma.message.create({
      data: {
        content: agentResult.response,
        role: 'assistant',
        metadata: assistantMetadata,
        userId,
        workspaceId,
      },
    }),
  ])

  await createDecisionAuditLog({
    workspaceId,
    userId,
    source: 'chat',
    executionMode: effectiveExecutionMode,
    executionReason: executionDecision.reason,
    proposalCount: agentResult.proposals.length,
    details: {
      workspaceRole: governance.role,
      connectedContextSources: connectedContextResult?.request.sources || [],
    },
  })

  const requestGroupId = agentResult.proposals.length > 1 ? `group_${Date.now()}_${userId.slice(0, 6)}` : null

  const createdActions = agentResult.proposals.length > 0
    ? await Promise.all(
        agentResult.proposals.map((proposal, index) =>
          prisma.action.create({
            data: {
              type: proposal.type,
              title: proposal.title,
              description: proposal.description,
              parameters: {
                ...proposal.parameters,
                confidenceScore: proposal.confidenceScore,
                proposalIndex: index,
                ...(requestGroupId ? { requestGroupId } : {}),
              },
              status: 'pending',
              userId,
              workspaceId,
              ...(index === 0 ? { messageId: assistantMessage.id } : {}),
            },
          })
        )
      )
    : []

  if (createdActions.length > 0 && effectiveExecutionMode === 'ask') {
    await Promise.all(
      createdActions.map((action) =>
        createAuditLog({
          actionType: action.type,
          status: 'review_required',
          actionId: action.id,
          workspaceId,
          userId,
          riskLevel: inferRiskLevel(action.type as typeof agentResult.proposals[number]['type'], action.parameters as Record<string, unknown>),
          executionReason: executionDecision.reason,
          executionTrigger: 'review',
          details: {
            source: 'chat',
          },
        })
      )
    )
  }

  let executionMessages: Array<Awaited<ReturnType<typeof prisma.message.create>>> = []
  let autoExecutionFailed = false
  let reviewableActions = createdActions

  if (createdActions.length > 0 && effectiveExecutionMode === 'auto') {
    await claimPendingActionIds(prisma, {
      actionIds: createdActions.map((action) => action.id),
      workspaceId,
      userId,
    })

    const batchResult = await executePersistedActionBatch({
      actions: createdActions.map((action) => ({
        id: action.id,
        type: action.type,
        title: action.title,
        description: action.description,
        parameters: action.parameters,
        workspaceId,
        userId,
      })),
      trigger: 'auto',
    })

    if (batchResult.completed.length > 0) {
      const executionMessage = await prisma.message.create({
        data: {
          content:
            batchResult.completed.length === 1
              ? `C'est bon. "${batchResult.completed[0].action.title}" a ete execute automatiquement. ${batchResult.completed[0].execution.details}`
              : `C'est bon. ${batchResult.completed.length} actions ont ete executees automatiquement.`,
          role: 'assistant',
          metadata: {
            actionStatus: 'completed',
            actionCount: batchResult.completed.length,
            executionMode: 'auto',
            executionReason: executionDecision.reason,
          },
          userId,
          workspaceId,
        },
      })

      executionMessages.push(executionMessage)
    }

    if (batchResult.failed) {
      autoExecutionFailed = true
      reviewableActions = createdActions.filter((createdAction) =>
        batchResult.blocked.some((blockedAction) => blockedAction.action.id === createdAction.id)
      )

      const executionMessage = await prisma.message.create({
        data: {
          content:
            batchResult.blocked.length > 0
              ? `L'execution automatique s'est arretee sur "${batchResult.failed.action.title}": ${batchResult.failed.error}. ${batchResult.blocked.length} action(s) restent en attente de validation.`
              : `L'execution automatique s'est arretee sur "${batchResult.failed.action.title}": ${batchResult.failed.error}.`,
          role: 'assistant',
          metadata: {
            actionId: batchResult.failed.action.id,
            actionStatus: 'failed',
            blockedActionCount: batchResult.blocked.length,
            executionMode: 'auto',
            autoExecutionFailed: true,
            executionReason: executionDecision.reason,
          },
          userId,
          workspaceId,
        },
      })

      executionMessages.push(executionMessage)
    }
  }

  return {
    userMessage,
    assistantMessage,
    proposals:
      reviewableActions.length > 0 && (effectiveExecutionMode === 'ask' || autoExecutionFailed)
        ? reviewableActions.map((createdAction) => ({
            id: createdAction.id,
            type: createdAction.type,
            title: createdAction.title,
            description: createdAction.description,
            parameters: createdAction.parameters,
          }))
        : [],
    disambiguations: agentDisambiguations,
    executionMessages,
    effectiveExecutionMode: autoExecutionFailed ? 'ask' : effectiveExecutionMode,
    executionModeReason: autoExecutionFailed ? 'auto_execution_failed' : executionDecision.reason,
    workspaceRole: governance.role,
  }
}

function extractResolvedContactNameFromPendingAction(action: PendingActionRecord) {
  if (typeof action.parameters.resolvedContactName === 'string' && action.parameters.resolvedContactName.trim()) {
    return action.parameters.resolvedContactName.trim()
  }

  const titleMatch = action.title.match(/send email to\s+(.+)$/i)
  if (titleMatch?.[1]) {
    return titleMatch[1].trim()
  }

  const descriptionMatch = action.description.match(/email to\s+(.+?)\s+(through|via|par|with)\b/i)
  if (descriptionMatch?.[1]) {
    return descriptionMatch[1].trim()
  }

  return null
}

async function resolveCorrectedContactFromChatInput(params: {
  content: string
  previousMessages: PersistedMessageRecord[]
  pendingActions: PendingActionRecord[]
  knownContacts: Awaited<ReturnType<typeof listKnownContacts>>
  userId: string
  workspaceId: string
}): Promise<CorrectedContactResult | null> {
  const emails = extractEmailAddresses(params.content)
  if (emails.length === 0 || !looksLikeContactCorrection(params.content)) {
    return null
  }

  const email = emails[0]
  const latestPendingEmailAction = params.pendingActions.find(
    (action) =>
      action.type === 'send_email' ||
      action.type === 'create_gmail_draft' ||
      action.type === 'reply_to_email' ||
      action.type === 'forward_email'
  )
  const explicitNameFromMessage =
    extractRecipientName(params.content) ||
    extractNameBeforeEmail(params.content, email) ||
    extractNameNearEmail(params.content, email)

  const inferredName =
    explicitNameFromMessage ||
    (latestPendingEmailAction ? extractResolvedContactNameFromPendingAction(latestPendingEmailAction) : null) ||
    (() => {
      for (let index = params.previousMessages.length - 1; index >= 0; index -= 1) {
        const message = params.previousMessages[index]
        if (message.role !== 'user') continue
        const fromPreviousMessage = extractRecipientName(message.content)
        if (fromPreviousMessage) return fromPreviousMessage
      }
      return null
    })()

  const existingByEmail = params.knownContacts.find((contact) => contact.email.toLowerCase() === email)
  const name = inferredName || existingByEmail?.name
  if (!name) {
    return null
  }
  const shouldPersistContact = Boolean(explicitNameFromMessage || existingByEmail?.name)

  const correctedContact = {
    name,
    email,
    aliases: explicitNameFromMessage ? [explicitNameFromMessage] : [],
  }

  if (latestPendingEmailAction) {
    const updatedParameters = {
      ...latestPendingEmailAction.parameters,
      to: [email],
      resolvedContactName: name,
    }
    const updatedTitle =
      latestPendingEmailAction.type === 'reply_to_email'
        ? `Reply to ${name}`
        : latestPendingEmailAction.type === 'create_gmail_draft'
          ? `Create draft for ${name}`
        : latestPendingEmailAction.type === 'forward_email'
          ? `Forward email to ${name}`
          : `Send email to ${name}`
    const updatedDescription =
      latestPendingEmailAction.type === 'reply_to_email'
        ? `Prepare a reply to ${name} in the relevant Gmail thread.`
        : latestPendingEmailAction.type === 'create_gmail_draft'
          ? `Prepare a Gmail draft for ${name}.`
        : latestPendingEmailAction.type === 'forward_email'
          ? `Forward the relevant Gmail message to ${name}.`
          : `Prepare and send an email to ${name} through Gmail.`

    const updatedAction = await prisma.action.update({
      where: { id: latestPendingEmailAction.id },
      data: {
        title: updatedTitle,
        description: updatedDescription,
        parameters: updatedParameters,
      },
    })

    if (shouldPersistContact) {
      await rememberContact({
        userId: params.userId,
        workspaceId: params.workspaceId,
        email,
        name,
        aliases: explicitNameFromMessage ? [explicitNameFromMessage] : [],
      })
    }

    return {
      correctedContact,
      updatedPendingAction: {
        id: updatedAction.id,
        type: updatedAction.type,
        title: updatedAction.title,
        description: updatedAction.description,
        parameters: asRecord(updatedAction.parameters),
      },
      assistantResponse: `Adresse corrigée pour ${name}. Vérifie puis confirme.`,
    }
  }

  if (!explicitNameFromMessage) {
    return null
  }

  await rememberContact({
    userId: params.userId,
    workspaceId: params.workspaceId,
    email,
    name,
    aliases: [explicitNameFromMessage],
  })

  return { correctedContact }
}

async function orchestrateConnectedReadTurn(params: {
  content: string
  context: ChatContext
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
  governanceRole: string
  assistantProfile: Awaited<ReturnType<typeof getAssistantProfile>>
  connectedContextResult: NonNullable<Awaited<ReturnType<typeof resolveConnectedWorkspaceContext>>>
}) {
  const { workspaceId, userId } = params.context
  let liveResponse = ''
  let strategy: 'model' | 'deterministic' | 'fallback' = 'fallback'

  try {
    const aiResult = await analyzeUserRequest(
      params.content,
      params.conversationHistory,
      {
        assistantProfile: params.assistantProfile,
        workspaceContext: params.connectedContextResult.workspaceContext,
        behaviorMode: 'connected_read',
      }
    )

    if (aiResult.proposals.length === 0 && !isLowValueAssistantResponse(aiResult.response)) {
      liveResponse = aiResult.response
      strategy = 'model'
    } else if (isLowValueAssistantResponse(aiResult.response)) {
      await createFallbackAuditLog({
        workspaceId,
        userId,
        source: 'chat',
        fallbackKind: 'low_value_response',
      })
    }
  } catch (error) {
    await createFallbackAuditLog({
      workspaceId,
      userId,
      source: 'chat',
      fallbackKind: 'model_error',
      details: {
        error: error instanceof Error ? error.message : 'Unknown model error.',
      },
    })
  }

  if (!liveResponse) {
    liveResponse =
      buildDeterministicConnectedResponse(
        params.content,
        params.connectedContextResult,
        params.assistantProfile.defaultLanguage
      ) || ''

    if (liveResponse) {
      strategy = 'deterministic'
      await createFallbackAuditLog({
        workspaceId,
        userId,
        source: 'chat',
        fallbackKind: 'deterministic',
      })
    } else {
      liveResponse = buildConnectedContextFallbackResponse(
        params.connectedContextResult,
        params.assistantProfile.defaultLanguage
      )
      strategy = 'fallback'
      await createFallbackAuditLog({
        workspaceId,
        userId,
        source: 'chat',
        fallbackKind: 'connected_context_fallback',
      })
    }
  }

  await createConnectedReadAuditLog({
    workspaceId,
    userId,
    sources: params.connectedContextResult.request.sources,
    timeframe: params.connectedContextResult.request.timeframe,
    strategy,
    details: {
      asksForAvailability: params.connectedContextResult.request.asksForAvailability,
      asksForPriorities: params.connectedContextResult.request.asksForPriorities,
    },
  })

  const userMessage = await prisma.message.create({
    data: {
      content: params.content,
      role: 'user',
      userId,
      workspaceId,
    },
  })

  const assistantMessage = await prisma.message.create({
    data: {
      content: liveResponse,
      role: 'assistant',
      metadata: {
        ...params.connectedContextResult.metadata,
        proposalCount: 0,
        workspaceRole: params.governanceRole,
      },
      userId,
      workspaceId,
    },
  })

  await createDecisionAuditLog({
    workspaceId,
    userId,
    source: 'chat',
    executionMode: 'ask',
    executionReason: 'connected_workspace_read',
    proposalCount: 0,
    details: {
      strategy,
      sources: params.connectedContextResult.request.sources,
    },
  })

  return {
    userMessage,
    assistantMessage,
    proposals: [],
    executionMessages: [],
    effectiveExecutionMode: 'ask',
    executionModeReason: 'connected_workspace_read',
    workspaceRole: params.governanceRole,
  }
}

async function resolveEmailContactFromGoogle(params: {
  content: string
  knownContacts: Awaited<ReturnType<typeof listKnownContacts>>
  userId: string
  workspaceId: string
}) {
  const requestedName = extractRecipientName(params.content)
  if (!requestedName) {
    return null
  }

  const knownContact = findContactByName(requestedName, params.knownContacts)
  if (knownContact) {
    return knownContact
  }

  const gmailIntegration = await prisma.integration.findFirst({
    where: {
      type: 'gmail',
      userId: params.userId,
      workspaceId: params.workspaceId,
      status: 'connected',
    },
  })

  if (!gmailIntegration) {
    return null
  }

  try {
    const accessToken = await getValidGoogleAccessToken(gmailIntegration)
    const email = await findGoogleContactEmail(accessToken, requestedName)
    if (!email) {
      return null
    }

    await rememberContact({
      userId: params.userId,
      workspaceId: params.workspaceId,
      email,
      name: requestedName,
    })

    return {
      name: requestedName,
      email,
      aliases: [requestedName],
    }
  } catch {
    return null
  }
}

function buildWelcomeMessage() {
  return {
    id: 'welcome',
    role: 'assistant' as const,
    content:
      "I'm your Kova operator. Ask me to draft emails, schedule meetings, work in Notion, create Google Docs, or save files to Google Drive. I will prepare the action for approval before execution.",
  }
}

function extractConnectedContextSeed(messages: PersistedMessageRecord[]): ConnectedContextSeed | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') {
      continue
    }

    if (message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)) {
      const metadata = message.metadata as Record<string, unknown>
      const sources = Array.isArray(metadata.connectedContextSources)
        ? metadata.connectedContextSources.filter(
            (value): value is ConnectedContextSource =>
              value === 'gmail' || value === 'calendar' || value === 'google_drive' || value === 'google_docs' || value === 'notion'
          )
        : []
      const timeframe = metadata.connectedContextTimeframe

      if (sources.length > 0 && (timeframe === 'today' || timeframe === 'week' || timeframe === 'recent')) {
        return {
          sources,
          timeframe,
          asksForAvailability: metadata.connectedContextAvailabilityMode === true,
          asksForPriorities: metadata.connectedContextPriorityMode === true,
        }
      }
    }

    const content = String(message.content || '')
    if (/gmail:/i.test(content)) {
      return {
        sources: ['gmail'],
        timeframe: /aujourd'hui|today/i.test(content) ? 'today' : 'recent',
        asksForAvailability: false,
        asksForPriorities: false,
      }
    }

    if (/calendar:/i.test(content) || /creneaux libres|free windows/i.test(content)) {
      return {
        sources: ['calendar'],
        timeframe: /cette semaine|this week/i.test(content) ? 'week' : 'today',
        asksForAvailability: /creneaux libres|free windows/i.test(content),
        asksForPriorities: false,
      }
    }

    if (/drive:/i.test(content) || /fichiers drive|drive files/i.test(content)) {
      return {
        sources: ['google_drive'],
        timeframe: 'recent',
        asksForAvailability: false,
        asksForPriorities: false,
      }
    }

    if (/notion:/i.test(content) || /pages notion|notion pages/i.test(content)) {
      return {
        sources: ['notion'],
        timeframe: 'recent',
        asksForAvailability: false,
        asksForPriorities: false,
      }
    }
  }

  return null
}
