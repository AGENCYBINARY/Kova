import { prisma } from '@/lib/db/prisma'
import { createAuditLog } from '@/lib/audit/service'
import { claimPendingActionIds } from '@/lib/actions/claim-pending'
import { executePersistedActionBatch } from '@/lib/actions/execute-persisted-batch'
import { inferRiskLevel } from '@/lib/agent/policy'
import type { AgentProposal } from '@/lib/agent/v1'

export async function persistAndExecuteAgentProposals(params: {
  proposals: AgentProposal[]
  executionMode: 'ask' | 'auto'
  executionReason: string
  assistantMessageId: string
  userId: string
  workspaceId: string
}) {
  const requestGroupId = params.proposals.length > 1 ? `group_${Date.now()}_${params.userId.slice(0, 6)}` : null

  const createdActions =
    params.proposals.length > 0
      ? await Promise.all(
          params.proposals.map((proposal, index) =>
            prisma.action.create({
              data: {
                type: proposal.type,
                title: proposal.title,
                description: proposal.description,
                parameters: {
                  ...proposal.parameters,
                  confidenceScore: proposal.confidenceScore,
                  proposalIndex: index,
                  ...(requestGroupId ? { requestGroupId } : {}),
                },
                status: 'pending',
                userId: params.userId,
                workspaceId: params.workspaceId,
                ...(index === 0 ? { messageId: params.assistantMessageId } : {}),
              },
            })
          )
        )
      : []

  if (createdActions.length > 0 && params.executionMode === 'ask') {
    await Promise.all(
      createdActions.map((action) =>
        createAuditLog({
          actionType: action.type,
          status: 'review_required',
          actionId: action.id,
          workspaceId: params.workspaceId,
          userId: params.userId,
          riskLevel: inferRiskLevel(action.type as AgentProposal['type'], action.parameters as Record<string, unknown>),
          executionReason: params.executionReason,
          executionTrigger: 'review',
          details: {
            source: 'chat',
          },
        })
      )
    )
  }

  let executionMessages: Array<Awaited<ReturnType<typeof prisma.message.create>>> = []
  let autoExecutionFailed = false
  let reviewableActions = createdActions

  if (createdActions.length > 0 && params.executionMode === 'auto') {
    await claimPendingActionIds(prisma, {
      actionIds: createdActions.map((action) => action.id),
      workspaceId: params.workspaceId,
      userId: params.userId,
    })

    const batchResult = await executePersistedActionBatch({
      actions: createdActions.map((action) => ({
        id: action.id,
        type: action.type,
        title: action.title,
        description: action.description,
        parameters: action.parameters,
        workspaceId: params.workspaceId,
        userId: params.userId,
      })),
      trigger: 'auto',
    })

    if (batchResult.completed.length > 0) {
      const executionMessage = await prisma.message.create({
        data: {
          content:
            batchResult.completed.length === 1
              ? `C'est bon. "${batchResult.completed[0].action.title}" a ete execute automatiquement. ${batchResult.completed[0].execution.details}`
              : `C'est bon. ${batchResult.completed.length} actions ont ete executees automatiquement.`,
          role: 'assistant',
          metadata: {
            actionStatus: 'completed',
            actionCount: batchResult.completed.length,
            executionMode: 'auto',
            executionReason: params.executionReason,
          },
          userId: params.userId,
          workspaceId: params.workspaceId,
        },
      })

      executionMessages.push(executionMessage)
    }

    if (batchResult.failed) {
      autoExecutionFailed = true
      reviewableActions = createdActions.filter((createdAction) =>
        batchResult.blocked.some((blockedAction) => blockedAction.action.id === createdAction.id)
      )

      const executionMessage = await prisma.message.create({
        data: {
          content:
            batchResult.blocked.length > 0
              ? `L'execution automatique s'est arretee sur "${batchResult.failed.action.title}": ${batchResult.failed.error}. ${batchResult.blocked.length} action(s) restent en attente de validation.`
              : `L'execution automatique s'est arretee sur "${batchResult.failed.action.title}": ${batchResult.failed.error}.`,
          role: 'assistant',
          metadata: {
            actionId: batchResult.failed.action.id,
            actionStatus: 'failed',
            blockedActionCount: batchResult.blocked.length,
            executionMode: 'auto',
            autoExecutionFailed: true,
            executionReason: params.executionReason,
          },
          userId: params.userId,
          workspaceId: params.workspaceId,
        },
      })

      executionMessages.push(executionMessage)
    }
  }

  return {
    createdActions,
    reviewableActions,
    executionMessages,
    autoExecutionFailed,
  }
}
