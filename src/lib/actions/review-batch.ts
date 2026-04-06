import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { createAuditLog } from '@/lib/audit/service'
import { claimPendingActionIds } from '@/lib/actions/claim-pending'
import { syncActionPlansForActionIds } from '@/lib/actions/action-plans'
import { asActionParameters } from '@/lib/actions/parameter-resolution'
import { executePersistedActionBatch } from '@/lib/actions/execute-persisted-batch'
import { isOpenAiConfigured } from '@/lib/ai/client'
import { synthesizePostExecutionOutcome, type PostExecutionOutcomeFact } from '@/lib/ai/narration'
import { loadChatTurnContextForActionMessage } from '@/lib/chat/turn-context'

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

function templateBulkApprovalSummary(params: {
  lang: 'fr' | 'en'
  completedCount: number
  failedCount: number
  blockedCount: number
}) {
  const { lang, completedCount, failedCount, blockedCount } = params
  if (failedCount > 0) {
    if (blockedCount > 0) {
      return lang === 'en'
        ? `${completedCount} action(s) ran. ${failedCount} group(s) failed; ${blockedCount} action(s) still pending review.`
        : `${completedCount} action(s) exécutée(s). ${failedCount} lot(s) en échec ; ${blockedCount} action(s) encore en attente.`
    }
    return lang === 'en'
      ? `${completedCount} action(s) ran. ${failedCount} group(s) failed during bulk approval.`
      : `${completedCount} action(s) exécutée(s). ${failedCount} lot(s) ont échoué pendant l’approbation groupée.`
  }
  return lang === 'en'
    ? `All set — ${completedCount} actions ran successfully.`
    : `C’est bon — ${completedCount} actions exécutées avec succès.`
}

export async function approvePendingActionBatch(params: {
  workspaceId: string
  userId: string
  defaultLanguage?: 'fr' | 'en'
  actions: Array<{
    id: string
    type: string
    title: string
    description: string
    parameters: Prisma.JsonValue
    messageId?: string | null
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
  const allCompleted: PostExecutionOutcomeFact[] = []
  const batchFailures: Array<{ title: string; error: string; blockedCount: number }> = []

  for (const groupKey of groupOrder) {
    const rawGroupActions = groups.get(groupKey) || []
    if (rawGroupActions.length === 0) {
      continue
    }

    const actions = [...rawGroupActions].sort((left, right) => {
      const leftIndex =
        typeof asActionParameters(left.parameters).proposalIndex === 'number'
          ? (asActionParameters(left.parameters).proposalIndex as number)
          : 0
      const rightIndex =
        typeof asActionParameters(right.parameters).proposalIndex === 'number'
          ? (asActionParameters(right.parameters).proposalIndex as number)
          : 0
      return leftIndex - rightIndex
    })

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

    for (const completed of batchResult.completed) {
      allCompleted.push({
        title: completed.action.title,
        type: completed.action.type,
        details: completed.execution.details,
      })
    }

    if (batchResult.failed) {
      batchFailures.push({
        title: batchResult.failed.action.title,
        error: batchResult.failed.error,
        blockedCount: batchResult.blocked.length,
      })
    }

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

  const lang = params.defaultLanguage === 'en' ? 'en' : 'fr'
  const messageId =
    params.actions.map((action) => action.messageId).find((id) => typeof id === 'string' && id.length > 0) ?? null

  const anchor = await loadChatTurnContextForActionMessage({
    workspaceId: params.workspaceId,
    userId: params.userId,
    messageId,
  })

  let content = templateBulkApprovalSummary({ lang, completedCount, failedCount, blockedCount })
  let narrationFromLlm = false
  if (isOpenAiConfigured()) {
    try {
      content = await synthesizePostExecutionOutcome({
        defaultLanguage: lang,
        userRequest: anchor.userRequest,
        assistantPlanBeforeExecution: anchor.assistantPlan,
        completed: allCompleted,
        batchFailures: batchFailures.length > 0 ? batchFailures : undefined,
        scenarioNotes: `Bulk approval: ${params.actions.length} selected action(s) in ${groupOrder.length} execution group(s). ${completedCount} tool run(s) succeeded, ${failedCount} group(s) reported an error, ${blockedCount} action(s) left blocked/pending.`,
      })
      narrationFromLlm = true
    } catch {
      // template
    }
  }

  const assistantMessage = await prisma.message.create({
    data: {
      content,
      role: 'assistant',
      metadata: {
        actionStatus: failedCount > 0 ? 'partial_failure' : 'completed',
        actionCount: params.actions.length,
        blockedActionCount: blockedCount,
        batchReview: true,
        narrationSource: narrationFromLlm ? 'llm' : 'template',
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

  await syncActionPlansForActionIds({
    actionIds: params.actions.map((action) => action.id),
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
