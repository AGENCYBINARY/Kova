import { prisma } from '@/lib/db/prisma'
import { createAuditLog } from '@/lib/audit/service'
import { syncActionPlansForActionIds } from '@/lib/actions/action-plans'

/**
 * Marks pending actions as expired when a newer turn replaces them (e.g. user refines Meet + email bundle).
 */
export async function expirePendingActionsAsSuperseded(params: {
  workspaceId: string
  userId: string
  actionIds: string[]
  reason: string
}) {
  const unique = Array.from(new Set(params.actionIds.filter(Boolean)))
  if (unique.length === 0) {
    return
  }

  const now = new Date()

  await prisma.action.updateMany({
    where: {
      id: { in: unique },
      workspaceId: params.workspaceId,
      userId: params.userId,
      status: 'pending',
    },
    data: {
      status: 'expired',
      executedAt: now,
      result: {
        details: 'Superseded by a refined proposal from a newer message.',
        reason: params.reason,
        supersededAt: now.toISOString(),
      },
    },
  })

  const actions = await prisma.action.findMany({
    where: { id: { in: unique } },
    select: { id: true, type: true },
  })

  await Promise.all(
    actions.map((action) =>
      createAuditLog({
        actionType: action.type,
        status: 'expired',
        actionId: action.id,
        workspaceId: params.workspaceId,
        userId: params.userId,
        error: 'Superseded before approval.',
        executionTrigger: 'review',
        details: {
          reason: params.reason,
        },
      })
    )
  )

  await syncActionPlansForActionIds({
    actionIds: unique,
  })
}
