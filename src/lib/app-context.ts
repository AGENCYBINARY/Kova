import { auth, currentUser } from '@clerk/nextjs/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { defaultAssistantProfile } from '@/lib/assistant/profile'

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

  let dbUser = await prisma.user.findUnique({
    where: { clerkId: userId },
  })

  if (!dbUser) {
    const clerkUser = await currentUser()
    const email = clerkUser?.emailAddresses[0]?.emailAddress || `${userId}@kova.local`
    const name =
      [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ') ||
      clerkUser?.username ||
      'Kova Operator'

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

  let workspace = await prisma.workspace.findFirst({
    where: { ownerId: dbUser.id },
    orderBy: { createdAt: 'asc' },
  })

  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        ownerId: dbUser.id,
        name: `${dbUser.name || 'Kova'}'s Workspace`,
        slug: `${slugify(dbUser.name || 'workspace')}-${dbUser.id.slice(0, 6)}`,
        preferences: defaultAssistantProfile as unknown as Prisma.JsonObject,
      },
    })
  }

  return {
    userId,
    dbUserId: dbUser.id,
    workspaceId: workspace.id,
  }
}
