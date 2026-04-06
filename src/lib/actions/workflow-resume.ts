import { prisma } from '@/lib/db/prisma'
import { claimPendingActionIds } from '@/lib/actions/claim-pending'
import { executePersistedActionBatch } from '@/lib/actions/execute-persisted-batch'
import {
  activateReadyWorkflowSteps,
  findDueWorkflowPlans,
  syncActionPlanWorkflowStates,
} from '@/lib/actions/workflow-state'

export async function resumeDueActionPlans(params?: {
  limit?: number
  now?: Date
}) {
  const now = params?.now || new Date()
  const duePlans = await findDueWorkflowPlans({
    limit: params?.limit,
    now,
  })

  const results: Array<{
    planId: string
    resumed: boolean
    executed: boolean
    detail: string
  }> = []

  for (const plan of duePlans) {
    await syncActionPlanWorkflowStates({
      planIds: [plan.id],
      now,
    })

    const activation = await activateReadyWorkflowSteps({
      planId: plan.id,
      now,
    })

    if (activation.activatedActionIds.length === 0) {
      results.push({
        planId: plan.id,
        resumed: false,
        executed: false,
        detail: 'No waiting actions were ready to resume.',
      })
      continue
    }

    if (activation.executionMode !== 'auto') {
      results.push({
        planId: plan.id,
        resumed: true,
        executed: false,
        detail: `${activation.activatedActionIds.length} action(s) reopened for human review.`,
      })
      continue
    }

    const actions = await prisma.action.findMany({
      where: {
        id: {
          in: activation.activatedActionIds,
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    if (actions.length === 0) {
      results.push({
        planId: plan.id,
        resumed: false,
        executed: false,
        detail: 'Workflow resumed, but no persisted actions were found.',
      })
      continue
    }

    await claimPendingActionIds(prisma, {
      actionIds: actions.map((action) => action.id),
      workspaceId: actions[0].workspaceId,
      userId: actions[0].userId,
    })

    await executePersistedActionBatch({
      actions: actions.map((action) => ({
        id: action.id,
        type: action.type,
        title: action.title,
        description: action.description,
        parameters: action.parameters,
        workspaceId: action.workspaceId,
        userId: action.userId,
      })),
      trigger: 'auto',
    })

    results.push({
      planId: plan.id,
      resumed: true,
      executed: true,
      detail: `${actions.length} action(s) resumed and executed automatically.`,
    })
  }

  return {
    resumedCount: results.filter((item) => item.resumed).length,
    executedCount: results.filter((item) => item.executed).length,
    results,
  }
}
