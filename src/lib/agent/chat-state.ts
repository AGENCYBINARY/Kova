import { prisma } from '@/lib/db/prisma'
import { expirePendingActions } from '@/lib/actions/pending-expiration'
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

export function buildWelcomeMessage() {
  return {
    id: 'welcome',
    role: 'assistant' as const,
    content:
      "I'm your Kova operator. Ask me to draft emails, schedule meetings, work in Notion, create Google Docs, or save files to Google Drive. I will prepare the action for approval before execution.",
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

export async function loadChatPageState(context: ChatContext) {
  await expirePendingActions(context)

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
  await expirePendingActions(context)

  const [previousMessagesRaw, pendingActionsRaw, recentActionsRaw] = await Promise.all([
    prisma.message.findMany({
      where: {
        userId: context.userId,
        workspaceId: context.workspaceId,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.action.findMany({
      where: {
        userId: context.userId,
        workspaceId: context.workspaceId,
        status: 'pending',
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.action.findMany({
      where: {
        userId: context.userId,
        workspaceId: context.workspaceId,
        status: {
          in: ['pending', 'rejected'],
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
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
    })) satisfies PendingActionRecord[],
    recentActions: recentActionsRaw.map((action) => ({
      id: action.id,
      type: action.type,
      title: action.title,
      description: action.description,
      parameters: asRecord(action.parameters),
    })) satisfies PendingActionRecord[],
  }
}
