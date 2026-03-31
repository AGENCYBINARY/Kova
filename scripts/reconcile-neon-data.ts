import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'

function buildIntegrationGroupKey(record: {
  workspaceId: string
  userId: string
  type: string
}) {
  return `${record.workspaceId}:${record.userId}:${record.type}`
}

async function reconcileWorkspaceMemberships() {
  const workspaces = await prisma.workspace.findMany({
    select: {
      id: true,
      ownerId: true,
    },
  })

  for (const workspace of workspaces) {
    await prisma.workspaceMembership.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: workspace.ownerId,
        },
      },
      update: {
        role: 'owner',
      },
      create: {
        workspaceId: workspace.id,
        userId: workspace.ownerId,
        role: 'owner',
      },
    })
  }
}

async function reconcileActiveWorkspaces() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      activeWorkspaceId: true,
      memberships: {
        select: {
          workspaceId: true,
          role: true,
          workspace: {
            select: {
              createdAt: true,
            },
          },
        },
        orderBy: {
          workspace: {
            createdAt: 'asc',
          },
        },
      },
      ownedWorkspaces: {
        select: {
          id: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  })

  for (const user of users) {
    const validWorkspaceIds = new Set(user.memberships.map((membership) => membership.workspaceId))
    const currentActiveWorkspaceId =
      user.activeWorkspaceId && validWorkspaceIds.has(user.activeWorkspaceId)
        ? user.activeWorkspaceId
        : null

    if (currentActiveWorkspaceId) {
      continue
    }

    const nextWorkspaceId =
      user.ownedWorkspaces[0]?.id
      || user.memberships[0]?.workspaceId

    if (!nextWorkspaceId) {
      continue
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        activeWorkspaceId: nextWorkspaceId,
      },
    })
  }
}

async function reconcileIntegrations() {
  const integrations = await prisma.integration.findMany({
    select: {
      id: true,
      type: true,
      workspaceId: true,
      userId: true,
      status: true,
      accessToken: true,
      refreshToken: true,
      expiresAt: true,
      metadata: true,
      lastSyncAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  })

  const groups = new Map<string, typeof integrations>()
  for (const integration of integrations) {
    const key = buildIntegrationGroupKey(integration)
    const group = groups.get(key) || []
    group.push(integration)
    groups.set(key, group)
  }

  for (const group of Array.from(groups.values())) {
    if (group.length <= 1) {
      continue
    }

    const [primary, ...duplicates] = group
    const freshestConnectedDuplicate = duplicates.find((record) => record.status === 'connected' || record.status === 'error')
    const mergedMetadata = (
      (primary.metadata && typeof primary.metadata === 'object')
        ? primary.metadata
        : freshestConnectedDuplicate?.metadata || primary.metadata || undefined
    ) as Prisma.InputJsonValue | undefined

    await prisma.integration.update({
      where: { id: primary.id },
      data: {
        accessToken:
          primary.accessToken !== 'disconnected'
            ? primary.accessToken
            : freshestConnectedDuplicate?.accessToken || primary.accessToken,
        refreshToken: primary.refreshToken || freshestConnectedDuplicate?.refreshToken || null,
        expiresAt: primary.expiresAt || freshestConnectedDuplicate?.expiresAt || null,
        metadata: mergedMetadata,
        status:
          primary.status !== 'disconnected'
            ? primary.status
            : freshestConnectedDuplicate?.status || primary.status,
        lastSyncAt: primary.lastSyncAt || freshestConnectedDuplicate?.lastSyncAt || null,
      },
    })

    await prisma.integration.deleteMany({
      where: {
        id: {
          in: duplicates.map((record) => record.id),
        },
      },
    })
  }
}

async function main() {
  await reconcileWorkspaceMemberships()
  await reconcileActiveWorkspaces()
  await reconcileIntegrations()
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
