import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { getAppContext } from '@/lib/app-context'
import { analyzeUserRequest } from '@/lib/ai/client'
import { getAssistantProfile } from '@/lib/assistant/store'
import { runAgentTurn } from '@/lib/agent/v1'
import { executePersistedActionBatch } from '@/lib/actions/execute-persisted-batch'
import { getWorkspaceGovernance } from '@/lib/agent/governance'
import { resolveExecutionDecision } from '@/lib/agent/policy'
import { extractRecipientName, findContactByName, listKnownContacts, rememberContact } from '@/lib/contacts'
import { findGoogleContactEmail, getValidGoogleAccessToken } from '@/lib/integrations/google'
import { getErrorStatus } from '@/lib/http/errors'
import { buildConnectedContextFallbackResponse, buildDeterministicConnectedResponse } from '@/lib/workspace-context/fallback'
import { resolveConnectedWorkspaceContext } from '@/lib/workspace-context/service'
import type { ConnectedContextSeed, ConnectedContextSource } from '@/lib/workspace-context/intents'

const requestSchema = z.object({
  content: z.string().min(1).max(4000),
  executionMode: z.enum(['ask', 'auto']).default('ask'),
})

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

function extractConnectedContextSeed(messages: Array<{ role: string; content: string; metadata: unknown }>): ConnectedContextSeed | null {
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
              value === 'gmail' || value === 'calendar' || value === 'google_drive' || value === 'notion'
          )
        : []
      const timeframe = metadata.connectedContextTimeframe

      if (
        sources.length > 0 &&
        (timeframe === 'today' || timeframe === 'week' || timeframe === 'recent')
      ) {
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
  }

  return null
}

export async function GET() {
  try {
    const { dbUserId, workspaceId } = await getAppContext()
    const [messages, actions] = await Promise.all([
      prisma.message.findMany({
        where: {
          userId: dbUserId,
          workspaceId,
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
      }),
      prisma.action.findMany({
        where: {
          userId: dbUserId,
          workspaceId,
          status: 'pending',
        },
        orderBy: { createdAt: 'asc' },
        take: 20,
      }),
    ])

    return NextResponse.json({
      messages: messages.length > 0 ? messages : [buildWelcomeMessage()],
      proposals: actions.map((action) => ({
        id: action.id,
        type: action.type,
        title: action.title,
        description: action.description,
        parameters: action.parameters,
      })),
    })
  } catch (error) {
    const { status, message } = getErrorStatus(error)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json())
    const { dbUserId, workspaceId } = await getAppContext()

    const previousMessages = await prisma.message.findMany({
      where: {
        userId: dbUserId,
        workspaceId,
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    })

    const [knownContacts, assistantProfile, governance] = await Promise.all([
      listKnownContacts({
        userId: dbUserId,
        workspaceId,
      }),
      getAssistantProfile(workspaceId),
      getWorkspaceGovernance({
        workspaceId,
        userId: dbUserId,
      }),
    ])

    const conversationHistory = previousMessages.map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: message.content,
    }))
    const connectedContextSeed = extractConnectedContextSeed(previousMessages)

    const connectedContextResult = await resolveConnectedWorkspaceContext({
      content: body.content,
      userId: dbUserId,
      workspaceId,
      contextSeed: connectedContextSeed,
    })

    if (connectedContextResult?.request.mode === 'read') {
      let liveResponse =
        buildDeterministicConnectedResponse(
          body.content,
          connectedContextResult,
          assistantProfile.defaultLanguage
        ) || ''

      if (!liveResponse) {
        try {
          const aiResult = await analyzeUserRequest(
            body.content,
            conversationHistory,
            {
              assistantProfile,
              workspaceContext: connectedContextResult.workspaceContext,
            }
          )
          liveResponse = aiResult.response
        } catch {
          liveResponse = buildConnectedContextFallbackResponse(
            connectedContextResult,
            assistantProfile.defaultLanguage
          )
        }
      }

      const userMessage = await prisma.message.create({
        data: {
          content: body.content,
          role: 'user',
          userId: dbUserId,
          workspaceId,
        },
      })

      const assistantMessage = await prisma.message.create({
        data: {
          content: liveResponse,
          role: 'assistant',
          metadata: {
            ...connectedContextResult.metadata,
            proposalCount: 0,
            workspaceRole: governance.role,
          },
          userId: dbUserId,
          workspaceId,
        },
      })

      return NextResponse.json({
        userMessage,
        assistantMessage,
        proposals: [],
        executionMessages: [],
        effectiveExecutionMode: 'ask',
        executionModeReason: 'connected_workspace_read',
        workspaceRole: governance.role,
      })
    }

    const googleResolvedContact =
      assistantProfile.autoResolveKnownContacts
        ? await resolveEmailContactFromGoogle({
            content: body.content,
            knownContacts,
            userId: dbUserId,
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
      body.content,
      conversationHistory,
      effectiveKnownContacts,
      assistantProfile,
      governance.allowedActionTypes,
      {
        workspaceContext: connectedContextResult?.workspaceContext,
      }
    )

    const proposals = agentResult.proposals
    const executionDecision = resolveExecutionDecision({
      requestedMode: body.executionMode,
      proposals: proposals.map((proposal) => ({
        type: proposal.type,
        confidenceScore: proposal.confidenceScore,
        parameters: proposal.parameters,
      })),
      assistantProfile,
    })
    const effectiveExecutionMode = executionDecision.effectiveMode

    const userMessage = await prisma.message.create({
      data: {
        content: body.content,
        role: 'user',
        userId: dbUserId,
        workspaceId,
      },
    })

    const assistantMessage = await prisma.message.create({
      data: {
        content: agentResult.response,
        role: 'assistant',
        metadata: {
          proposalCount: agentResult.proposals.length,
          workspaceRole: governance.role,
          ...(connectedContextResult?.metadata || {}),
        },
        userId: dbUserId,
        workspaceId,
      },
    })

    const requestGroupId = proposals.length > 1 ? `group_${Date.now()}_${dbUserId.slice(0, 6)}` : null

    const createdActions = proposals.length > 0
      ? await Promise.all(
          proposals.map((proposal, index) =>
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
                userId: dbUserId,
                workspaceId,
                ...(index === 0 ? { messageId: assistantMessage.id } : {}),
              },
            })
          )
        )
      : []

    let executionMessages: Array<Awaited<ReturnType<typeof prisma.message.create>>> = []
    let autoExecutionFailed = false
    let reviewableActions = createdActions

    if (createdActions.length > 0 && effectiveExecutionMode === 'auto') {
      const batchResult = await executePersistedActionBatch({
        actions: createdActions.map((action) => ({
          id: action.id,
          type: action.type,
          title: action.title,
          description: action.description,
          parameters: action.parameters,
          workspaceId,
          userId: dbUserId,
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
            userId: dbUserId,
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
            userId: dbUserId,
            workspaceId,
          },
        })

        executionMessages.push(executionMessage)
      }
    }

    return NextResponse.json({
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
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    const { status, message } = getErrorStatus(error)
    return NextResponse.json({ error: message }, { status })
  }
}
