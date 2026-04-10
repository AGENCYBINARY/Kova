import { prisma } from '@/lib/db/prisma'
import { CHAT_WELCOME_EN, CHAT_WELCOME_FR } from '@/lib/chat/welcome-copy'
import { expirePendingActions } from '@/lib/actions/pending-expiration'
import { deferServerWork } from '@/lib/defer-server-work'
import type { ReferenceDisambiguation } from '@/lib/agent/reference-resolution'
import type { Prisma } from '@prisma/client'
import type { ConnectedContextSeed, ConnectedContextSource } from '@/lib/workspace-context/intents'

export type ChatContext = {
  userId: string
  workspaceId: string
}

export interface PersistedMessageRecord {
  role: string
  content: string
  metadata: unknown
}

export interface PendingActionRecord {
  id: string
  type: string
  title: string
  description: string
  parameters: Record<string, unknown>
  status?: string
  planId?: string | null
  planStepIndex?: number | null
  /** ISO timestamp — disambiguates multiple pending bundles */
  createdAt: string
}

export interface ChatMessageMetadata {
  disambiguations?: ReferenceDisambiguation[]
}

export function mapChatRole(role: string): 'user' | 'assistant' {
  return role === 'user' ? 'user' : 'assistant'
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return {}
}

export function toJsonValue(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

export function buildWelcomeMessage(defaultLanguage: 'fr' | 'en' = 'fr') {
  const content = defaultLanguage === 'en' ? CHAT_WELCOME_EN : CHAT_WELCOME_FR

  return {
    id: 'welcome',
    role: 'assistant' as const,
    content,
  }
}

export function extractConnectedContextSeed(messages: PersistedMessageRecord[]): ConnectedContextSeed | null {
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
              || value === 'google_photos'
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
  }

  return null
}

export async function loadChatPageState(context: ChatContext) {
  deferServerWork(expirePendingActions(context))

  const [messages, actions] = await Promise.all([
    prisma.message.findMany({
      where: {
        userId: context.userId,
        workspaceId: context.workspaceId,
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: {
        id: true,
        role: true,
        content: true,
        metadata: true,
      },
    }),
    prisma.action.findMany({
      where: {
        userId: context.userId,
        workspaceId: context.workspaceId,
        status: 'pending',
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        type: true,
        title: true,
        description: true,
        parameters: true,
      },
    }),
  ])

  return {
    messages: [...messages].reverse().map((message) => ({
      id: message.id,
      role: mapChatRole(message.role),
      content: message.content,
      metadata: asRecord(message.metadata) as ChatMessageMetadata,
    })),
    proposals: [...actions].reverse().map((action) => ({
      id: action.id,
      type: action.type,
      title: action.title,
      description: action.description,
      parameters: asRecord(action.parameters),
    })),
  }
}

export async function loadChatRuntimeState(context: ChatContext) {
  deferServerWork(expirePendingActions(context))

  const [previousMessagesRaw, pendingActionsRaw, recentActionsRaw] = await Promise.all([
    prisma.message.findMany({
      where: {
        userId: context.userId,
        workspaceId: context.workspaceId,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        role: true,
        content: true,
        metadata: true,
      },
    }),
    prisma.action.findMany({
      where: {
        userId: context.userId,
        workspaceId: context.workspaceId,
        status: 'pending',
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        type: true,
        title: true,
        description: true,
        parameters: true,
        status: true,
        planId: true,
        planStepIndex: true,
        createdAt: true,
      },
    }),
    prisma.action.findMany({
      where: {
        userId: context.userId,
        workspaceId: context.workspaceId,
        status: {
          in: [
            'pending',
            'waiting',
            'retry_scheduled',
            'scheduled',
            'rejected',
            'completed',
            'compensated',
            'failed',
          ],
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        type: true,
        title: true,
        description: true,
        parameters: true,
        status: true,
        planId: true,
        planStepIndex: true,
        createdAt: true,
      },
    }),
  ])

  return {
    previousMessages: [...previousMessagesRaw].reverse() satisfies PersistedMessageRecord[],
    pendingActions: pendingActionsRaw.map((action) => ({
      id: action.id,
      type: action.type,
      title: action.title,
      description: action.description,
      parameters: asRecord(action.parameters),
      status: action.status,
      planId: action.planId,
      planStepIndex: action.planStepIndex,
      createdAt: action.createdAt.toISOString(),
    })) satisfies PendingActionRecord[],
    recentActions: recentActionsRaw.map((action) => ({
      id: action.id,
      type: action.type,
      title: action.title,
      description: action.description,
      parameters: asRecord(action.parameters),
      status: action.status,
      planId: action.planId,
      planStepIndex: action.planStepIndex,
      createdAt: action.createdAt.toISOString(),
    })) satisfies PendingActionRecord[],
  }
}
