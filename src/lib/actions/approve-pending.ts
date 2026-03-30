import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { asActionParameters } from '@/lib/actions/parameter-resolution'
import { claimPendingActionIds } from '@/lib/actions/claim-pending'
import { executePersistedActionBatch } from '@/lib/actions/execute-persisted-batch'

type PersistedActionRecord = {
  id: string
  type: string
  title: string
  description: string
  parameters: Prisma.JsonValue
  workspaceId: string
  userId: string
}

export async function approvePendingActionById(params: {
  actionId: string
  workspaceId: string
  userId: string
}) {
  const actionsToExecute = await prisma.$transaction(async (tx) => {
    const action = await tx.action.findFirst({
      where: {
        id: params.actionId,
        userId: params.userId,
        workspaceId: params.workspaceId,
      },
    })

    if (!action) {
      throw new Error('Action not found.')
    }

    if (action.status !== 'pending') {
      throw new Error('Action is no longer pending.')
    }

    const actionParameters = asActionParameters(action.parameters)
    const requestGroupId =
      typeof actionParameters.requestGroupId === 'string' ? actionParameters.requestGroupId : null

    const groupedActions = requestGroupId
      ? await tx.action.findMany({
          where: {
            status: 'pending',
            userId: params.userId,
            workspaceId: params.workspaceId,
            parameters: {
              path: ['requestGroupId'],
              equals: requestGroupId,
            },
          },
          orderBy: { createdAt: 'asc' },
        })
      : [action]

    const claimedActions = groupedActions.length > 0 ? groupedActions : [action]

    await claimPendingActionIds(tx, {
      actionIds: claimedActions.map((item) => item.id),
      workspaceId: params.workspaceId,
      userId: params.userId,
    })

    return claimedActions.map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      description: item.description,
      parameters: item.parameters,
      workspaceId: params.workspaceId,
      userId: params.userId,
    })) satisfies PersistedActionRecord[]
  })

  const batchResult = await executePersistedActionBatch({
    actions: actionsToExecute,
    trigger: 'approval',
  })

  const primaryAction = actionsToExecute[0]

  const [updatedActions, assistantMessage] = await Promise.all([
    prisma.action.findMany({
      where: {
        id: {
          in: actionsToExecute.map((item) => item.id),
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.message.create({
      data: {
        content:
          batchResult.failed
            ? batchResult.blocked.length > 0
              ? `${batchResult.completed.length} action(s) executee(s). Echec sur "${batchResult.failed.action.title}": ${batchResult.failed.error}. ${batchResult.blocked.length} action(s) restent en attente.`
              : `Echec sur "${batchResult.failed.action.title}": ${batchResult.failed.error}.`
            : batchResult.completed.length > 1
              ? `C'est bon. ${batchResult.completed.length} actions ont ete executees avec succes.`
              : `C'est bon. "${batchResult.completed[0].action.title}" a ete execute. ${batchResult.completed[0].execution.details}`,
        role: 'assistant',
        metadata: {
          actionId: primaryAction.id,
          actionStatus: batchResult.failed ? 'partial_failure' : 'completed',
          actionCount: actionsToExecute.length,
          blockedActionCount: batchResult.blocked.length,
        },
        workspaceId: params.workspaceId,
        userId: params.userId,
      },
    }),
  ])

  return {
    actions: updatedActions,
    assistantMessage,
    partialFailure: Boolean(batchResult.failed),
  }
}

export async function approvePendingActionBatch(params: {
  workspaceId: string
  userId: string
  actionIds?: string[]
}) {
  const requestedIds =
    params.actionIds && params.actionIds.length > 0
      ? Array.from(new Set(params.actionIds))
      : (
          await prisma.action.findMany({
            where: {
              workspaceId: params.workspaceId,
              userId: params.userId,
              status: 'pending',
            },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          })
        ).map((action) => action.id)

  const handledIds = new Set<string>()
  const actions = new Map<string, Awaited<ReturnType<typeof approvePendingActionById>>['actions'][number]>()
  const assistantMessages: Array<Awaited<ReturnType<typeof approvePendingActionById>>['assistantMessage']> = []
  let partialFailure = false

  for (const actionId of requestedIds) {
    if (handledIds.has(actionId)) {
      continue
    }

    const result = await approvePendingActionById({
      actionId,
      workspaceId: params.workspaceId,
      userId: params.userId,
    })

    partialFailure = partialFailure || result.partialFailure
    assistantMessages.push(result.assistantMessage)

    for (const action of result.actions) {
      handledIds.add(action.id)
      actions.set(action.id, action)
    }
  }

  return {
    actions: Array.from(actions.values()),
    assistantMessages,
    partialFailure,
  }
}
