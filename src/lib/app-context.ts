import { auth, currentUser } from '@clerk/nextjs/server'
import { Prisma } from '@prisma/client'
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

  let ownedWorkspaceIds: string[] = []
  const preferredWorkspaceId = cookies().get('kova_workspace_id')?.value?.trim() || null

  const ownedWorkspaces = await prisma.workspace.findMany({
    where: { ownerId: dbUser.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, createdAt: true },
  })

  ownedWorkspaceIds = ownedWorkspaces.map((workspace) => workspace.id)

  if (ownedWorkspaces.length === 0) {
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

    dbUser = await prisma.user.update({
      where: { id: dbUser.id },
      data: {
        activeWorkspaceId: workspace.id,
      },
    })

    return {
      userId,
      dbUserId: dbUser.id,
      workspaceId: workspace.id,
      workspaceRole: 'owner',
    }
  }

  await Promise.all(
    ownedWorkspaceIds.map((workspaceId) =>
      prisma.workspaceMembership.upsert({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId: dbUser!.id,
          },
        },
        update: {
          role: 'owner',
        },
        create: {
          workspaceId,
          userId: dbUser!.id,
          role: 'owner',
        },
      })
    )
  )

  const memberships = await prisma.workspaceMembership.findMany({
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

  if (dbUser.activeWorkspaceId !== activeWorkspaceId) {
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
  }
}
