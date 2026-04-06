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
import { isEmailCompositionAssistanceRequest } from '@/lib/agent/v1-deterministic'
import { buildCalendarRedoFollowUp } from '@/lib/agent/follow-up'
import {
  type ChatContext,
  buildWelcomeMessage,
  extractConnectedContextSeed,
  loadChatPageState,
  loadChatRuntimeState,
  toJsonValue,
} from '@/lib/agent/chat-state'
import { getWorkspaceGovernance } from '@/lib/agent/governance'
import { inferRiskLevel, resolveExecutionDecision } from '@/lib/agent/policy'
import { listKnownContacts } from '@/lib/contacts'
import {
  resolveCorrectedContactFromChatInput,
  resolveEmailContactFromGoogle,
} from '@/lib/agent/orchestrator-contacts'
import { persistAndExecuteAgentProposals } from '@/lib/agent/orchestrator-actions'
import { buildConnectedContextFallbackResponse, buildDeterministicConnectedResponse } from '@/lib/workspace-context/fallback'
import { resolveConnectedWorkspaceContext } from '@/lib/workspace-context/service'

export type ChatExecutionMode = 'ask' | 'auto'

export async function getChatPageData(context: ChatContext) {
  const { messages, proposals } = await loadChatPageState(context)

  return {
    messages: messages.length > 0 ? messages : [buildWelcomeMessage()],
    proposals,
  }
}

export async function orchestrateChatTurn(params: {
  content: string
  executionMode: ChatExecutionMode
  context: ChatContext
}) {
  const { userId, workspaceId } = params.context
  const knownContactsPromise = listKnownContacts({
    userId,
    workspaceId,
  })
  const assistantProfilePromise = getAssistantProfile(workspaceId)
  const governancePromise = getWorkspaceGovernance({
    workspaceId,
    userId,
  })
  const chatRuntimeStatePromise = loadChatRuntimeState(params.context)

  const [knownContacts, assistantProfile, governance, chatRuntimeState] = await Promise.all([
    knownContactsPromise,
    assistantProfilePromise,
    governancePromise,
    chatRuntimeStatePromise,
  ])
  const { previousMessages, pendingActions, recentActions } = chatRuntimeState

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
  const emailCompositionHelp = isEmailCompositionAssistanceRequest(params.content)
  // Skip connected-workspace resolution for drafting help: avoids mistaken read-only
  // summaries ("Résumé connecté…") and unnecessary Gmail/Calendar prefetch; the agent
  // still sees the full user text and can use tools when the user asks to search Gmail.
  const connectedContextResult = emailCompositionHelp
    ? null
    : await resolveConnectedWorkspaceContext({
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

  const { reviewableActions, executionMessages, autoExecutionFailed } = await persistAndExecuteAgentProposals({
    proposals: agentResult.proposals,
    executionMode: effectiveExecutionMode,
    executionReason: executionDecision.reason,
    assistantMessageId: assistantMessage.id,
    userId,
    workspaceId,
  })

  const finalAssistantMessage =
    effectiveExecutionMode === 'auto' && !autoExecutionFailed && executionMessages.length > 0
      ? await prisma.message.update({
          where: { id: assistantMessage.id },
          data: {
            content:
              assistantProfile.defaultLanguage === 'en'
                ? 'I handled it automatically.'
                : 'Je m’en suis chargé automatiquement.',
          },
        })
      : assistantMessage

  return {
    userMessage,
    assistantMessage: finalAssistantMessage,
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
      metadata: toJsonValue({
        ...params.connectedContextResult.metadata,
        proposalCount: 0,
        workspaceRole: params.governanceRole,
      }),
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
