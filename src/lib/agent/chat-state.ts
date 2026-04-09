import { prisma } from '@/lib/db/prisma'
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
  const content =
    defaultLanguage === 'en'
      ? [
          "I'm **Kova** — your **operational copilot** in this console. **You're talking to Kova's AI** (the same engine answers here and prepares work across your stack): it reasons about what you want, reads **connected apps** when linked, and turns requests into **actions** you can approve (or that run automatically if your workspace allows).",
          '',
          '**Apps I work across** (same judgment as a strong EA — not canned templates):',
          '• **Gmail** — write, send, reply, forward, organize; if you only give a name, I pull from **threads + contacts** before asking once for a missing address.',
          '• **Google Calendar** — events, attendees, **Google Meet** when a remote meeting makes sense (unless you opt out).',
          '• **Google Docs & Drive** — real drafts, folders, moves, shares — deliverables where your team expects them.',
          '• **Notion** — pages and **database properties** when context gives me the parent DB; archive when needed.',
          '• **Google Photos** — **picker-first** so you choose media, then I act on that selection.',
          '',
          '**How we work together:** I explain my plan in plain language, package the right steps as proposals, and recap after things run. Say what you want in one shot or iterate — I’ll adapt. What should we tackle first?',
        ].join('\n')
      : [
          'Je suis **Kova** — ton **copilote opérationnel** dans cette console. **Tu parles à l’IA de Kova** (c’est le même moteur qui répond ici et prépare le travail sur ton stack) : elle comprend ce que tu veux, lit tes **apps connectées** quand elles sont liées, et transforme ça en **actions** à valider (ou en exécution auto selon le workspace).',
          '',
          '**Où j’interviens** (comme une bonne EA — pas des modèles vides) :',
          '• **Gmail** — rédaction, envoi, réponse, transfert, rangement ; avec un **seul prénom**, je m’appuie sur **threads + contacts** avant de te demander une seule précision si besoin.',
          '• **Google Agenda** — événements, invités, **Google Meet** quand la visio a du sens (sauf si tu dis sans Meet).',
          '• **Google Docs & Drive** — vrais contenus, dossiers, déplacements, partages.',
          '• **Notion** — pages et **propriétés de bases** quand le contexte permet ; archivage si tu le demandes.',
          '• **Google Photos** — je passe par un **sélecteur** : tu choisis, j’agis sur la sélection.',
          '',
          '**Ensemble :** je t’explique le plan clairement, je prépare les bonnes étapes sous forme de propositions, et je te fais un retour après exécution. Tu peux tout donner d’un coup ou affiner au fil de l’eau. Par quoi on commence ?',
        ].join('\n')

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

    if (/photos:/i.test(content) || /google photos|photos recentes|recent photos/i.test(content)) {
      return {
        sources: ['google_photos'],
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
          in: ['pending', 'waiting', 'retry_scheduled', 'rejected', 'completed', 'compensated', 'failed'],
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
