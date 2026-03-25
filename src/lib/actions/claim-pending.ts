import type { Prisma, PrismaClient } from '@prisma/client'

type ActionWriter = Pick<PrismaClient, 'action'> | Prisma.TransactionClient

export async function claimPendingActionIds(
  db: ActionWriter,
  params: {
    actionIds: string[]
    workspaceId: string
    userId: string
  }
) {
  const uniqueIds = Array.from(new Set(params.actionIds.filter(Boolean)))
  if (uniqueIds.length === 0) {
    return
  }

  const result = await db.action.updateMany({
    where: {
      id: { in: uniqueIds },
      workspaceId: params.workspaceId,
      userId: params.userId,
      status: 'pending',
    },
    data: {
      status: 'executing',
    },
  })

  if (result.count !== uniqueIds.length) {
    throw new Error(uniqueIds.length > 1 ? 'Action group is no longer pending.' : 'Action is no longer pending.')
  }
}
