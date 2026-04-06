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

export function buildWelcomeMessage(defaultLanguage: 'fr' | 'en' = 'fr') {
  const content =
    defaultLanguage === 'en'
      ? [
          "I'm **Kova** — a real operational assistant for your company (or personal stack), not a generic chatbot.",
          '',
          '**What I do with your connected apps** (once they’re linked):',
          '• **Gmail** — draft or send mail, reply, forward, organize threads; when you only give a name, I use your **sent/received context** and contacts to find the right address, or I ask you once if I can’t.',
          '• **Google Calendar** — create or update events, attendees, and **Google Meet** links when a call or external meeting makes sense (unless you say no Meet).',
          '• **Google Docs & Drive** — write real documents, create folders, move, rename, share — so deliverables land where your team expects them.',
          '• **Notion** — create or update pages, adjust **database properties** (status, dates, people, checkboxes / task-style fields) when the parent database is known from context, archive pages — keep your wiki and task DBs current.',
          '• **Google Photos** — I open a **secure picker** so you choose images, then I work from that selection (privacy-first).',
          '',
          'I **think out loud**, propose **concrete actions** you can approve (or auto-run when your workspace allows), and follow up after execution. Tell me what you need done.',
        ].join('\n')
      : [
          'Je suis **Kova** — une assistante **opérationnelle** pour ton entreprise (ou ton usage perso), pas un chatbot générique.',
          '',
          '**Ce que je fais sur tes apps connectées** (une fois les intégrations actives) :',
          '• **Gmail** — rédiger ou envoyer des mails, répondre, transférer, ranger les conversations ; si tu ne donnes qu’un **nom**, j’utilise ton **historique mails** (envoyés/reçus), tes contacts et le contexte workspace pour retrouver l’adresse — sinon je te demande **une** précision.',
          '• **Google Agenda** — créer ou modifier des événements, invités, et **lien Google Meet** quand un appel ou une réunion à distance est logique (sauf si tu demandes sans Meet).',
          '• **Google Docs & Drive** — rédiger de vrais documents, créer des dossiers, déplacer, renommer, partager — pour que les livrables arrivent au bon endroit.',
          '• **Notion** — créer ou mettre à jour des pages, ajuster les **propriétés de bases** (statuts, dates, personnes, cases / tâches) quand la base parente est connue via le contexte, archiver des pages — tenir ton wiki et tes DB à jour.',
          '• **Google Photos** — j’ouvre un **sélecteur sécurisé** pour que tu choisisses des médias, puis je travaille sur cette sélection (respect de la vie privée).',
          '',
          'Je **réfléchis de façon visible**, je prépare des **actions concrètes** à valider (ou en exécution auto selon les réglages du workspace), et je te fais un retour après coup. Dis-moi ce que tu veux enclencher.',
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
