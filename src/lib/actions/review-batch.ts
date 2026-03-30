import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { createAuditLog } from '@/lib/audit/service'
import { claimPendingActionIds } from '@/lib/actions/claim-pending'
import { asActionParameters } from '@/lib/actions/parameter-resolution'
import { executePersistedActionBatch } from '@/lib/actions/execute-persisted-batch'

function asJsonRecord(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return {}
}

export async function loadPendingActionsForReview(params: {
  workspaceId: string
  userId: string
  actionIds?: string[]
  take?: number
}) {
  const actionIds = Array.from(new Set((params.actionIds || []).filter(Boolean)))

  return prisma.action.findMany({
    where: {
      workspaceId: params.workspaceId,
      userId: params.userId,
      status: 'pending',
      ...(actionIds.length > 0
        ? {
            id: {
              in: actionIds,
            },
          }
        : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: actionIds.length > 0 ? actionIds.length : params.take || 50,
  })
}

export async function approvePendingActionBatch(params: {
  workspaceId: string
  userId: string
  actions: Array<{
    id: string
    type: string
    title: string
    description: string
    parameters: Prisma.JsonValue
  }>
}) {
  if (params.actions.length === 0) {
    throw new Error('No pending actions to approve.')
  }

  type PersistedAction = Awaited<ReturnType<typeof prisma.action.findMany>>[number]

  const groups = new Map<string, typeof params.actions>()
  const groupOrder: string[] = []

  for (const action of params.actions) {
    const requestGroupId = asActionParameters(action.parameters).requestGroupId
    const groupKey =
      typeof requestGroupId === 'string' && requestGroupId.trim().length > 0
        ? requestGroupId
        : action.id

    if (!groups.has(groupKey)) {
      groups.set(groupKey, [])
      groupOrder.push(groupKey)
    }

    groups.get(groupKey)?.push(action)
  }

  const updatedActions = new Map<string, PersistedAction>()
  let completedCount = 0
  let failedCount = 0
  let blockedCount = 0

  for (const groupKey of groupOrder) {
    const actions = groups.get(groupKey) || []
    if (actions.length === 0) {
      continue
    }

    await prisma.$transaction(async (tx) => {
      await claimPendingActionIds(tx, {
        actionIds: actions.map((action) => action.id),
        workspaceId: params.workspaceId,
        userId: params.userId,
      })
    })

    const batchResult = await executePersistedActionBatch({
      actions: actions.map((action) => ({
        ...action,
        workspaceId: params.workspaceId,
        userId: params.userId,
      })),
      trigger: 'approval',
    })

    completedCount += batchResult.completed.length
    failedCount += batchResult.failed ? 1 : 0
    blockedCount += batchResult.blocked.length

    const refreshedActions = await prisma.action.findMany({
      where: {
        id: {
          in: actions.map((action) => action.id),
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    for (const action of refreshedActions) {
      updatedActions.set(action.id, action)
    }
  }

  const assistantMessage = await prisma.message.create({
    data: {
      content:
        failedCount > 0
          ? blockedCount > 0
            ? `${completedCount} action(s) executee(s). ${failedCount} lot(s) en echec et ${blockedCount} action(s) restent en attente.`
            : `${completedCount} action(s) executee(s). ${failedCount} lot(s) ont echoue pendant l'approbation en masse.`
          : `C'est bon. ${completedCount} actions ont ete executees avec succes.`,
      role: 'assistant',
      metadata: {
        actionStatus: failedCount > 0 ? 'partial_failure' : 'completed',
        actionCount: params.actions.length,
        blockedActionCount: blockedCount,
        batchReview: true,
      },
      workspaceId: params.workspaceId,
      userId: params.userId,
    },
  })

  return {
    actions: Array.from(updatedActions.values()),
    assistantMessage,
    partialFailure: failedCount > 0,
  }
}

export async function rejectPendingActionBatch(params: {
  workspaceId: string
  userId: string
  actions: Array<{
    id: string
    type: string
    title: string
  }>
}) {
  if (params.actions.length === 0) {
    throw new Error('No pending actions to reject.')
  }

  const now = new Date()
  await prisma.action.updateMany({
    where: {
      id: {
        in: params.actions.map((action) => action.id),
      },
      status: 'pending',
    },
    data: {
      status: 'rejected',
      executedAt: now,
      result: {
        details: 'Rejected by user before execution.',
      } as Prisma.JsonObject,
    },
  })

  await Promise.all(
    params.actions.map((action) =>
      createAuditLog({
        actionType: action.type,
        status: 'rejected',
        actionId: action.id,
        workspaceId: params.workspaceId,
        userId: params.userId,
        error: 'User rejected action',
        executionTrigger: 'review',
        details: {
          reason: 'Rejected before execution',
          batchReview: true,
          actionCount: params.actions.length,
        },
      })
    )
  )

  const updatedActions = await prisma.action.findMany({
    where: {
      id: {
        in: params.actions.map((action) => action.id),
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  const assistantMessage = await prisma.message.create({
    data: {
      content: `Rejected ${params.actions.length} actions. No external action was executed.`,
      role: 'assistant',
      metadata: {
        actionStatus: 'rejected',
        actionCount: params.actions.length,
        batchReview: true,
      },
      workspaceId: params.workspaceId,
      userId: params.userId,
    },
  })

  return {
    actions: updatedActions.map((action) => ({
      id: action.id,
      type: action.type,
      title: action.title,
      description: action.description,
      parameters: asJsonRecord(action.parameters),
    })),
    assistantMessage,
  }
}
