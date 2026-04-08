import { auth, currentUser } from '@clerk/nextjs/server'
import { Prisma } from '@prisma/client'
import { cache } from 'react'
import { cookies } from 'next/headers'
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
  workspaceRole: string
  userName: string
  userEmail: string
}

interface ResolvedDbUser {
  id: string
  clerkId: string
  email: string
  name: string | null
  activeWorkspaceId: string | null
}

function isMissingActiveWorkspaceColumn(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2022' &&
    typeof error.meta?.column === 'string' &&
    error.meta.column.includes('User.activeWorkspaceId')
  )
}

async function findDbUserByClerkId(clerkId: string): Promise<{ user: ResolvedDbUser | null; supportsActiveWorkspaceColumn: boolean }> {
  try {
    const user = await prisma.user.findUnique({
      where: { clerkId },
    })

    return {
      user,
      supportsActiveWorkspaceColumn: true,
    }
  } catch (error) {
    if (!isMissingActiveWorkspaceColumn(error)) {
      throw error
    }

    const user = await prisma.user.findUnique({
      where: { clerkId },
      select: {
        id: true,
        clerkId: true,
        email: true,
        name: true,
      },
    })

    return {
      user: user ? { ...user, activeWorkspaceId: null } : null,
      supportsActiveWorkspaceColumn: false,
    }
  }
}

export const getAppContext = cache(async function getAppContext(): Promise<AppContextResult> {
  const { userId } = auth()

  if (!userId) {
    throw new Error('Unauthorized')
  }

  let { user: dbUser, supportsActiveWorkspaceColumn } = await findDbUserByClerkId(userId)

  if (!dbUser) {
    const clerkUser = await currentUser()
    const email = clerkUser?.emailAddresses[0]?.emailAddress || `${userId}@kova.local`
    const name =
      [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ') ||
      clerkUser?.username ||
      'Kova Operator'

    try {
      const createdUser = await prisma.user.create({
        data: {
          clerkId: userId,
          email,
          name,
        },
      })
      dbUser = createdUser
      supportsActiveWorkspaceColumn = true
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code !== 'P2002'
      ) {
        throw error
      }

      const resolved = await findDbUserByClerkId(userId)
      dbUser = resolved.user
      supportsActiveWorkspaceColumn = resolved.supportsActiveWorkspaceColumn
    }
  }

  if (!dbUser) {
    throw new Error('Unable to resolve current user.')
  }

  const preferredWorkspaceId = cookies().get('kova_workspace_id')?.value?.trim() || null

  let memberships = await prisma.workspaceMembership.findMany({
    where: {
      userId: dbUser.id,
    },
    orderBy: [
      {
        workspace: {
          createdAt: 'asc',
        },
      },
    ],
    include: {
      workspace: {
        select: {
          id: true,
        },
      },
    },
  })

  if (memberships.length === 0) {
    const ownedWorkspaces = await prisma.workspace.findMany({
      where: { ownerId: dbUser.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })

    if (ownedWorkspaces.length > 0) {
      await prisma.workspaceMembership.createMany({
        data: ownedWorkspaces.map((workspace) => ({
          workspaceId: workspace.id,
          userId: dbUser!.id,
          role: 'owner',
        })),
        skipDuplicates: true,
      })

      memberships = await prisma.workspaceMembership.findMany({
        where: {
          userId: dbUser.id,
        },
        orderBy: [
          {
            workspace: {
              createdAt: 'asc',
            },
          },
        ],
        include: {
          workspace: {
            select: {
              id: true,
            },
          },
        },
      })
    }
  }

  if (memberships.length === 0) {
    const workspace = await prisma.workspace.create({
      data: {
        ownerId: dbUser.id,
        name: `${dbUser.name || 'Kova'}'s Workspace`,
        slug: `${slugify(dbUser.name || 'workspace')}-${dbUser.id.slice(0, 6)}`,
        preferences: defaultAssistantProfile as unknown as Prisma.JsonObject,
      },
    })

    await prisma.workspaceMembership.create({
      data: {
        workspaceId: workspace.id,
        userId: dbUser.id,
        role: 'owner',
      },
    })

    if (supportsActiveWorkspaceColumn) {
      dbUser = await prisma.user.update({
        where: { id: dbUser.id },
        data: {
          activeWorkspaceId: workspace.id,
        },
      })
    }

      return {
        userId,
        dbUserId: dbUser.id,
        workspaceId: workspace.id,
        workspaceRole: 'owner',
        userName: dbUser.name || 'Kova Operator',
        userEmail: dbUser.email,
      }
  }

  if (memberships.length === 0) {
    throw new Error('Unable to resolve current workspace membership.')
  }

  const membershipByWorkspaceId = new Map(memberships.map((membership) => [membership.workspaceId, membership]))
  const activeWorkspaceId =
    (preferredWorkspaceId && membershipByWorkspaceId.has(preferredWorkspaceId) ? preferredWorkspaceId : null)
    || (dbUser.activeWorkspaceId && membershipByWorkspaceId.has(dbUser.activeWorkspaceId) ? dbUser.activeWorkspaceId : null)
    || memberships.find((membership) => membership.role === 'owner')?.workspaceId
    || memberships[0]?.workspaceId

  if (!activeWorkspaceId) {
    throw new Error('Unable to resolve active workspace.')
  }

  if (supportsActiveWorkspaceColumn && dbUser.activeWorkspaceId !== activeWorkspaceId) {
    dbUser = await prisma.user.update({
      where: { id: dbUser.id },
      data: {
        activeWorkspaceId,
      },
    })
  }

  const activeMembership = membershipByWorkspaceId.get(activeWorkspaceId)

  return {
    userId,
    dbUserId: dbUser.id,
    workspaceId: activeWorkspaceId,
    workspaceRole: activeMembership?.role || 'viewer',
    userName: dbUser.name || 'Kova Operator',
    userEmail: dbUser.email,
  }
})
