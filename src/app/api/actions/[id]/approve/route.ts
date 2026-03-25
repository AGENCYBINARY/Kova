import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getAppContext } from '@/lib/app-context'
import { asActionParameters } from '@/lib/actions/parameter-resolution'
import { claimPendingActionIds } from '@/lib/actions/claim-pending'
import { executePersistedActionBatch } from '@/lib/actions/execute-persisted-batch'
import { getErrorStatus } from '@/lib/http/errors'

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { dbUserId, workspaceId } = await getAppContext()
    const actionsToExecute = await prisma.$transaction(async (tx) => {
      const action = await tx.action.findFirst({
        where: {
          id: params.id,
          userId: dbUserId,
          workspaceId,
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
              userId: dbUserId,
              workspaceId,
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
        workspaceId,
        userId: dbUserId,
      })

      return claimedActions
    })

    const batchResult = await executePersistedActionBatch({
      actions: actionsToExecute.map((pendingAction) => ({
        id: pendingAction.id,
        type: pendingAction.type,
        title: pendingAction.title,
        description: pendingAction.description,
        parameters: pendingAction.parameters,
        workspaceId,
        userId: dbUserId,
      })),
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
          workspaceId,
          userId: dbUserId,
        },
      }),
    ])

    return NextResponse.json({
      actions: updatedActions,
      assistantMessage,
      partialFailure: Boolean(batchResult.failed),
    })
  } catch (error) {
    const { status, message } = getErrorStatus(error)
    return NextResponse.json({ error: message }, { status })
  }
}
