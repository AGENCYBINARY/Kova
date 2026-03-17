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

  const dbUser = await prisma.user.upsert({
    where: { clerkId: userId },
    update: {
      email,
      name,
    },
    create: {
      clerkId: userId,
      email,
      name,
    },
  })

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

  const existingIntegrations = await prisma.integration.findMany({
    where: {
      workspaceId: workspace.id,
      userId: dbUser.id,
    },
    select: { type: true },
  })

  const existingTypes = new Set(existingIntegrations.map((integration) => integration.type))
  const missingIntegrations = dashboardIntegrations.filter((integration) => !existingTypes.has(integration.id))

  if (missingIntegrations.length > 0) {
    await prisma.integration.createMany({
      data: missingIntegrations.map((integration) => ({
        type: integration.id,
        accessToken: 'disconnected',
        refreshToken: null,
        status: integration.id === 'slack' ? 'disconnected' : 'disconnected',
        lastSyncAt: null,
        metadata: {
          connectedAccount: null,
          seededBy: 'codex-v1',
        },
        workspaceId: workspace.id,
        userId: dbUser.id,
      })),
    })
  }

  await prisma.integration.updateMany({
    where: {
      workspaceId: workspace.id,
      userId: dbUser.id,
      OR: [
        { accessToken: 'disconnected' },
        { accessToken: 'pending_oauth_connection' },
      ],
    },
    data: {
      status: 'disconnected',
      lastSyncAt: null,
      expiresAt: null,
      metadata: {
        connectedAccount: null,
        normalizedBy: 'codex-auth-bootstrap',
      },
    },
  })

  return {
    userId,
    dbUserId: dbUser.id,
    workspaceId: workspace.id,
  }
}
