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
import { claimPendingActionIds } from '@/lib/actions/claim-pending'
import { executePersistedActionBatch } from '@/lib/actions/execute-persisted-batch'
import { getWorkspaceGovernance } from '@/lib/agent/governance'
import { inferRiskLevel, resolveExecutionDecision } from '@/lib/agent/policy'
import { extractRecipientName, findContactByName, listKnownContacts, rememberContact } from '@/lib/contacts'
import { findGoogleContactEmail, getValidGoogleAccessToken } from '@/lib/integrations/google'
import { buildConnectedContextFallbackResponse, buildDeterministicConnectedResponse } from '@/lib/workspace-context/fallback'
import { resolveConnectedWorkspaceContext } from '@/lib/workspace-context/service'
import type { ConnectedContextSeed, ConnectedContextSource } from '@/lib/workspace-context/intents'

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

function mapChatRole(role: string): 'user' | 'assistant' {
  return role === 'user' ? 'user' : 'assistant'
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return {}
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

  const previousMessages = [...(await previousMessagesPromise)].reverse()
  const [knownContacts, assistantProfile, governance] = await Promise.all([
    knownContactsPromise,
    assistantProfilePromise,
    governancePromise,
  ])

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

  const googleResolvedContact =
    assistantProfile.autoResolveKnownContacts
      ? await resolveEmailContactFromGoogle({
          content: params.content,
          knownContacts,
          userId,
          workspaceId,
        })
      : null

  const effectiveKnownContacts = googleResolvedContact
    ? [
        googleResolvedContact,
        ...knownContacts.filter((contact) => contact.email !== googleResolvedContact.email),
      ]
    : knownContacts

  const agentResult = await runAgentTurn(
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
        metadata: {
          proposalCount: agentResult.proposals.length,
          workspaceRole: governance.role,
          ...(connectedContextResult?.metadata || {}),
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
    executionMessages,
    effectiveExecutionMode: autoExecutionFailed ? 'ask' : effectiveExecutionMode,
    executionModeReason: autoExecutionFailed ? 'auto_execution_failed' : executionDecision.reason,
    workspaceRole: governance.role,
  }
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
