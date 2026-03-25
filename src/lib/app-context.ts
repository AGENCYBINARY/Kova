import { auth, currentUser } from '@clerk/nextjs/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { defaultAssistantProfile } from '@/lib/assistant/profile'
import { dashboardIntegrations } from '@/lib/dashboard-data'

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export interface AppContextResult {
  userId: string
  dbUserId: string
  workspaceId: string
}

type WorkspaceIntegrationRecord = {
  type: string
  status: string
  lastSyncAt: Date | null
  updatedAt: Date
}

function shouldUpdateUser(
  dbUser: {
    email: string
    name: string | null
  },
  next: {
    email: string
    name: string
  }
) {
  return dbUser.email !== next.email || (dbUser.name || null) !== next.name
}

function rankIntegration(record: WorkspaceIntegrationRecord) {
  return [
    record.status === 'connected' ? 2 : record.status === 'error' ? 1 : 0,
    record.lastSyncAt?.getTime() || 0,
    record.updatedAt.getTime(),
  ] as const
}

function compareIntegrationPriority(left: WorkspaceIntegrationRecord, right: WorkspaceIntegrationRecord) {
  const leftRank = rankIntegration(left)
  const rightRank = rankIntegration(right)

  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] !== rightRank[index]) {
      return rightRank[index] - leftRank[index]
    }
  }

  return 0
}

async function normalizeWorkspaceIntegrations(params: {
  workspaceId: string
  userId: string
}) {
  const integrations = await prisma.integration.findMany({
    where: {
      workspaceId: params.workspaceId,
      userId: params.userId,
    },
    select: {
      type: true,
      status: true,
      lastSyncAt: true,
      updatedAt: true,
    },
    orderBy: [{ updatedAt: 'desc' }],
  })

  const grouped = new Map<string, WorkspaceIntegrationRecord[]>()
  for (const integration of integrations) {
    const items = grouped.get(integration.type) || []
    items.push(integration)
    grouped.set(integration.type, items)
  }

  const normalized = new Set<string>()
  for (const records of Array.from(grouped.values())) {
    const sorted = [...records].sort(compareIntegrationPriority)
    if (sorted[0]) {
      normalized.add(sorted[0].type)
    }
  }

  return normalized
}

export async function getAppContext(): Promise<AppContextResult> {
  const { userId } = auth()

  if (!userId) {
    throw new Error('Unauthorized')
  }

  const clerkUser = await currentUser()
  const email = clerkUser?.emailAddresses[0]?.emailAddress || `${userId}@kova.local`
  const name =
    [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ') ||
    clerkUser?.username ||
    'Kova Operator'

  let dbUser = await prisma.user.findUnique({
    where: { clerkId: userId },
  })

  if (!dbUser) {
    try {
      dbUser = await prisma.user.create({
        data: {
          clerkId: userId,
          email,
          name,
        },
      })
    } catch {
      dbUser = await prisma.user.findUnique({
        where: { clerkId: userId },
      })
    }
  }

  if (!dbUser) {
    throw new Error('Unable to resolve current user.')
  }

  if (shouldUpdateUser(dbUser, { email, name })) {
    dbUser = await prisma.user.update({
      where: { id: dbUser.id },
      data: {
        email,
        name,
      },
    })
  }

  let workspace = await prisma.workspace.findFirst({
    where: { ownerId: dbUser.id },
    orderBy: { createdAt: 'asc' },
  })

  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        ownerId: dbUser.id,
        name: `${name}'s Workspace`,
        slug: `${slugify(name || 'workspace')}-${dbUser.id.slice(0, 6)}`,
        preferences: defaultAssistantProfile as unknown as Prisma.JsonObject,
      },
    })
  }

  const existingTypes = await normalizeWorkspaceIntegrations({
    workspaceId: workspace.id,
    userId: dbUser.id,
  })
  const missingIntegrations = dashboardIntegrations.filter((integration) => !existingTypes.has(integration.id))

  if (missingIntegrations.length > 0) {
    await prisma.integration.createMany({
      data: missingIntegrations.map((integration) => ({
        type: integration.id,
        accessToken: 'disconnected',
        refreshToken: null,
        status: 'disconnected',
        lastSyncAt: null,
        metadata: {
          connectedAccount: null,
          seededBy: 'kova-v1',
        },
        workspaceId: workspace.id,
        userId: dbUser.id,
      })),
    })
  }

  return {
    userId,
    dbUserId: dbUser.id,
    workspaceId: workspace.id,
  }
}
