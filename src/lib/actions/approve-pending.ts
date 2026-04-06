import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { asActionParameters } from '@/lib/actions/parameter-resolution'
import { claimPendingActionIds } from '@/lib/actions/claim-pending'
import { executePersistedActionBatch } from '@/lib/actions/execute-persisted-batch'
import { isOpenAiConfigured } from '@/lib/ai/client'
import { synthesizePostExecutionOutcome } from '@/lib/ai/narration'
import { loadChatTurnContextForActionMessage } from '@/lib/chat/turn-context'

type PersistedActionRecord = {
  id: string
  type: string
  title: string
  description: string
  parameters: Prisma.JsonValue
  workspaceId: string
  userId: string
  messageId: string | null
}

function templateApprovalFollowUp(params: {
  lang: 'fr' | 'en'
  batchResult: Awaited<ReturnType<typeof executePersistedActionBatch>>
}) {
  const { lang, batchResult } = params
  if (batchResult.failed) {
    if (batchResult.blocked.length > 0) {
      return lang === 'en'
        ? `${batchResult.completed.length} action(s) ran. Stopped on "${batchResult.failed.action.title}": ${batchResult.failed.error}. ${batchResult.blocked.length} still pending review.`
        : `${batchResult.completed.length} action(s) exécutée(s). Arrêt sur « ${batchResult.failed.action.title} » : ${batchResult.failed.error}. ${batchResult.blocked.length} en attente de validation.`
    }
    return lang === 'en'
      ? `Stopped on "${batchResult.failed.action.title}": ${batchResult.failed.error}.`
      : `Arrêt sur « ${batchResult.failed.action.title} » : ${batchResult.failed.error}.`
  }
  if (batchResult.completed.length > 1) {
    return lang === 'en'
      ? `All set — ${batchResult.completed.length} actions ran.`
      : `C’est bon — ${batchResult.completed.length} actions exécutées.`
  }
  const first = batchResult.completed[0]
  return lang === 'en'
    ? `Done: ${first.action.title}. ${first.execution.details}`
    : `Exécuté : ${first.action.title}. ${first.execution.details}`
}

export async function approvePendingActionById(params: {
  actionId: string
  workspaceId: string
  userId: string
  defaultLanguage?: 'fr' | 'en'
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

    const groupedActionsRaw = requestGroupId
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

    const groupedActions = [...groupedActionsRaw].sort((left, right) => {
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
      messageId: item.messageId,
    })) satisfies PersistedActionRecord[]
  })

  const batchResult = await executePersistedActionBatch({
    actions: actionsToExecute,
    trigger: 'approval',
  })

  const primaryAction = actionsToExecute[0]
  const lang = params.defaultLanguage === 'en' ? 'en' : 'fr'

  const anchor = await loadChatTurnContextForActionMessage({
    workspaceId: params.workspaceId,
    userId: params.userId,
    messageId: primaryAction.messageId,
  })

  let content = templateApprovalFollowUp({ lang, batchResult })
  let narrationFromLlm = false
  if (isOpenAiConfigured()) {
    try {
      content = await synthesizePostExecutionOutcome({
        defaultLanguage: lang,
        userRequest: anchor.userRequest,
        assistantPlanBeforeExecution: anchor.assistantPlan,
        completed: batchResult.completed.map((c) => ({
          title: c.action.title,
          type: c.action.type,
          details: c.execution.details,
        })),
        failure: batchResult.failed
          ? {
              title: batchResult.failed.action.title,
              error: batchResult.failed.error,
              blockedCount: batchResult.blocked.length,
              priorCompletedCount: batchResult.completed.length,
            }
          : undefined,
      })
      narrationFromLlm = true
    } catch {
      // template
    }
  }

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
        content,
        role: 'assistant',
        metadata: {
          actionId: primaryAction.id,
          actionStatus: batchResult.failed
            ? batchResult.completed.length > 0
              ? 'partial_failure'
              : 'failed'
            : 'completed',
          actionCount: actionsToExecute.length,
          blockedActionCount: batchResult.failed ? batchResult.blocked.length : 0,
          narrationSource: narrationFromLlm ? 'llm' : 'template',
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
