import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { getAppContext } from '@/lib/app-context'
import { getAssistantProfile } from '@/lib/assistant/store'
import { runAgentTurn } from '@/lib/agent/v1'
import type { AssistantProfile } from '@/lib/assistant/profile'
import { asActionParameters, injectExecutionOutputsIntoParameters } from '@/lib/actions/parameter-resolution'
import { extractNameBeforeEmail, extractRecipientName, findContactByName, listKnownContacts, rememberContact } from '@/lib/contacts'
import { executePersistedAction } from '@/lib/integrations/execute'
import { findGoogleContactEmail, getValidGoogleAccessToken } from '@/lib/integrations/google'

const requestSchema = z.object({
  content: z.string().min(1).max(4000),
  executionMode: z.enum(['ask', 'auto']).default('ask'),
})

function getRecipientEmails(parameters: Prisma.JsonValue | Record<string, unknown>) {
  const record = asActionParameters(parameters)
  const recipients = Array.isArray(record.to) ? record.to : []
  return recipients.filter((value): value is string => typeof value === 'string' && value.includes('@'))
}

function hasPlaceholderRecipient(parameters: Prisma.JsonValue | Record<string, unknown>) {
  return getRecipientEmails(parameters).some((email) => {
    const normalized = email.trim().toLowerCase()
    return normalized === 'recipient@example.com' || normalized.endsWith('@example.com')
  })
}

function resolveEffectiveExecutionMode(params: {
  requestedMode: 'ask' | 'auto'
  proposals: Array<{ type: string; confidenceScore: number; parameters: Record<string, unknown> }>
  assistantProfile: AssistantProfile
}) {
  if (params.requestedMode === 'ask') {
    return {
      effectiveMode: 'ask' as const,
      reason: 'manual_review',
    }
  }

  if (params.assistantProfile.executionPolicy === 'always_ask') {
    return {
      effectiveMode: 'ask' as const,
      reason: 'profile_requires_review',
    }
  }

  const hasPlaceholderReviewRisk = params.proposals.some(
    (proposal) => proposal.type === 'send_email' && hasPlaceholderRecipient(proposal.parameters)
  )
  if (hasPlaceholderReviewRisk) {
    return {
      effectiveMode: 'ask' as const,
      reason: 'missing_recipient',
    }
  }

  const lowestConfidence = params.proposals.reduce(
    (current, proposal) => Math.min(current, proposal.confidenceScore),
    1
  )
  if (params.proposals.length > 0 && lowestConfidence < params.assistantProfile.confidenceThreshold) {
    return {
      effectiveMode: 'ask' as const,
      reason: 'confidence_below_threshold',
    }
  }

  return {
    effectiveMode: 'auto' as const,
    reason: 'auto_approved',
  }
}

async function rememberEmailRecipients(params: {
  parameters: Prisma.JsonValue | Record<string, unknown>
  content: string
  userId: string
  workspaceId: string
}) {
  const record = asActionParameters(params.parameters)
  const recipients = getRecipientEmails(record)

  for (const recipient of recipients) {
    await rememberContact({
      userId: params.userId,
      workspaceId: params.workspaceId,
      email: recipient,
      name:
        typeof record.resolvedContactName === 'string'
          ? record.resolvedContactName
          : extractNameBeforeEmail(params.content, recipient),
    })
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
      "I'm your CODEX operator. Ask me to draft emails, schedule meetings, update Notion, or create Google Docs. I will prepare the action for approval before execution.",
  }
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
    const message = error instanceof Error ? error.message : 'Unknown error'

    return NextResponse.json(
      {
        messages: [buildWelcomeMessage()],
        proposals: [],
        fallback: true,
        error: message,
      },
      { status: 200 }
    )
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

    const [knownContacts, assistantProfile] = await Promise.all([
      listKnownContacts({
        userId: dbUserId,
        workspaceId,
      }),
      getAssistantProfile(workspaceId),
    ])

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
      previousMessages.map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content,
      })),
      effectiveKnownContacts,
      assistantProfile
    )

    const proposals = agentResult.proposals
    const executionDecision = resolveEffectiveExecutionMode({
      requestedMode: body.executionMode,
      proposals,
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

    for (const createdAction of createdActions) {
      if (createdAction.type === 'send_email') {
        await rememberEmailRecipients({
          parameters: createdAction.parameters,
          content: body.content,
          userId: dbUserId,
          workspaceId,
        })
      }
    }

    if (createdActions.length > 0 && effectiveExecutionMode === 'auto') {
      try {
        const priorOutputs: Array<Record<string, unknown>> = []

        for (const createdAction of createdActions) {
          const effectiveParameters = injectExecutionOutputsIntoParameters(createdAction.parameters, priorOutputs)

          const execution = await executePersistedAction({
            action: {
              id: createdAction.id,
              type: createdAction.type as Parameters<typeof executePersistedAction>[0]['action']['type'],
              title: createdAction.title,
              description: createdAction.description,
              parameters: effectiveParameters as Prisma.JsonObject,
              workspaceId,
              userId: dbUserId,
            },
          })

          priorOutputs.push(execution.output)

          await prisma.action.update({
            where: { id: createdAction.id },
            data: {
              status: 'completed',
              executedAt: new Date(),
              parameters: effectiveParameters as Prisma.JsonObject,
              result: {
                confidenceScore:
                  typeof asActionParameters(createdAction.parameters).confidenceScore === 'number'
                    ? asActionParameters(createdAction.parameters).confidenceScore
                    : 0.85,
                details: execution.details,
                output: execution.output as Prisma.JsonObject,
                autoApproved: true,
              } as Prisma.JsonObject,
            },
          })

          await prisma.executionLog.create({
            data: {
              actionType: createdAction.type,
              status: 'success',
              details: execution.output as Prisma.JsonObject,
              actionId: createdAction.id,
              workspaceId,
              userId: dbUserId,
            },
          })

          const executionMessage = await prisma.message.create({
            data: {
              content: `Executed automatically: "${createdAction.title}". ${execution.details}`,
              role: 'assistant',
              metadata: {
                actionId: createdAction.id,
                actionStatus: 'completed',
                executionMode: 'auto',
                executionReason: executionDecision.reason,
              },
              userId: dbUserId,
              workspaceId,
            },
          })

          executionMessages.push(executionMessage)
        }
      } catch (error) {
        autoExecutionFailed = true
        const message = error instanceof Error ? error.message : 'Automatic execution failed.'

        await Promise.all(
          createdActions.map((createdAction) =>
            prisma.action.update({
              where: { id: createdAction.id },
              data: {
                status: 'pending',
                result: {
                  confidenceScore:
                    typeof asActionParameters(createdAction.parameters).confidenceScore === 'number'
                      ? asActionParameters(createdAction.parameters).confidenceScore
                      : 0.85,
                  autoApproved: false,
                  autoExecutionAttempted: true,
                  autoExecutionError: message,
                } as Prisma.JsonObject,
              },
            })
          )
        )

        await Promise.all(
          createdActions.map((createdAction) =>
            prisma.executionLog.create({
              data: {
                actionType: createdAction.type,
                status: 'failure',
                error: message,
                actionId: createdAction.id,
                workspaceId,
                userId: dbUserId,
              },
            })
          )
        )

        const executionMessage = await prisma.message.create({
          data: {
            content: `I could not execute the request automatically: ${message}. I kept the actions pending for review.`,
            role: 'assistant',
            metadata: {
              actionStatus: 'pending',
              executionMode: 'auto',
              autoExecutionFailed: true,
              executionReason: executionDecision.reason,
            },
            userId: dbUserId,
            workspaceId,
          },
        })

        executionMessages = [executionMessage]
      }
    }

    return NextResponse.json({
      userMessage,
      assistantMessage,
      proposals:
        createdActions.length > 0 && (effectiveExecutionMode === 'ask' || autoExecutionFailed)
          ? createdActions.map((createdAction) => ({
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
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
