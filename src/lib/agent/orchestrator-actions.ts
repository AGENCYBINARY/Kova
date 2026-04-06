import { prisma } from '@/lib/db/prisma'
import { createAuditLog } from '@/lib/audit/service'
import { claimPendingActionIds } from '@/lib/actions/claim-pending'
import { createActionPlanForTurn } from '@/lib/actions/action-plans'
import { executePersistedActionBatch } from '@/lib/actions/execute-persisted-batch'
import { isOpenAiConfigured } from '@/lib/ai/client'
import { synthesizePostExecutionOutcome } from '@/lib/ai/narration'
import { inferRiskLevel } from '@/lib/agent/policy'
import type { AgentProposal } from '@/lib/agent/v1'
import type { AgentPlanStep } from '@/lib/agent/planning'

function templateAutoExecutionFollowUp(params: {
  lang: 'fr' | 'en'
  completed: Array<{ action: { title: string }; execution: { details: string } }>
  failed: null | { action: { title: string }; error: string; blockedCount: number }
}) {
  const { lang, completed, failed } = params
  if (failed && completed.length > 0) {
    return lang === 'en'
      ? `Auto-run stopped on "${failed.action.title}": ${failed.error}. ${completed.length} prior action(s) still completed. ${failed.blockedCount} remain for your review.`
      : `L’exécution auto s’est arrêtée sur « ${failed.action.title} » : ${failed.error}. ${completed.length} action(s) avaient déjà réussi. ${failed.blockedCount} restent à valider.`
  }
  if (failed && completed.length === 0) {
    return lang === 'en'
      ? `Auto-run stopped on "${failed.action.title}": ${failed.error}.`
      : `L’exécution auto s’est arrêtée sur « ${failed.action.title} » : ${failed.error}.`
  }
  if (completed.length === 1) {
    return lang === 'en'
      ? `Ran it: ${completed[0].action.title}. ${completed[0].execution.details}`
      : `Exécuté : ${completed[0].action.title}. ${completed[0].execution.details}`
  }
  return lang === 'en'
    ? `All set — ${completed.length} actions ran.`
    : `C’est bon — ${completed.length} actions ont été exécutées.`
}

export async function persistAndExecuteAgentProposals(params: {
  proposals: AgentProposal[]
  executionMode: 'ask' | 'auto'
  executionReason: string
  assistantMessageId: string
  userId: string
  workspaceId: string
  /** Used for execution follow-up copy only (main assistant reply stays the model output). */
  defaultLanguage?: 'fr' | 'en'
  /** Last user chat line (for LLM execution recap). */
  userTurnContent?: string
  /** Assistant message shown before auto-run (for LLM execution recap). */
  assistantPlanContent?: string
  /** Structured model plan persisted for multi-step follow-up anchoring. */
  plan?: AgentPlanStep[]
}) {
  const lang = params.defaultLanguage === 'en' ? 'en' : 'fr'
  const requestGroupId = params.proposals.length > 1 ? `group_${Date.now()}_${params.userId.slice(0, 6)}` : null

  const { actionPlan, createdActions } = await prisma.$transaction(async (tx) => {
    const actionPlan = await createActionPlanForTurn(tx, {
      workspaceId: params.workspaceId,
      userId: params.userId,
      messageId: params.assistantMessageId,
      proposals: params.proposals,
      plan: params.plan || [],
      assistantPlanContent: params.assistantPlanContent,
      language: lang,
    })

    const createdActions =
      params.proposals.length > 0
        ? await Promise.all(
            params.proposals.map((proposal, index) =>
              tx.action.create({
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
                  planId: actionPlan?.id || null,
                  planStepIndex: actionPlan ? index : null,
                  ...(index === 0 ? { messageId: params.assistantMessageId } : {}),
                },
              })
            )
          )
        : []

    return {
      actionPlan,
      createdActions,
    }
  })

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

    const hasSuccess = batchResult.completed.length > 0
    const hasFailure = Boolean(batchResult.failed)

    if (hasFailure) {
      autoExecutionFailed = true
      reviewableActions = createdActions.filter((createdAction) =>
        batchResult.blocked.some((blockedAction) => blockedAction.action.id === createdAction.id)
      )
    }

    if (hasSuccess || hasFailure) {
      const failure = batchResult.failed
      let content = templateAutoExecutionFollowUp({
        lang,
        completed: batchResult.completed,
        failed: failure
          ? {
              action: failure.action,
              error: failure.error,
              blockedCount: batchResult.blocked.length,
            }
          : null,
      })

      let narrationFromLlm = false
      if (isOpenAiConfigured()) {
        try {
          content = await synthesizePostExecutionOutcome({
            defaultLanguage: lang,
            userRequest: params.userTurnContent?.trim() || null,
            assistantPlanBeforeExecution: params.assistantPlanContent?.trim() || null,
            completed: batchResult.completed.map((c) => ({
              title: c.action.title,
              type: c.action.type,
              details: c.execution.details,
            })),
            failure: failure
              ? {
                  title: failure.action.title,
                  error: failure.error,
                  blockedCount: batchResult.blocked.length,
                  priorCompletedCount: batchResult.completed.length,
                }
              : undefined,
          })
          narrationFromLlm = true
        } catch {
          // keep template
        }
      }

      const executionMessage = await prisma.message.create({
        data: {
          content,
          role: 'assistant',
          metadata: {
            ...(failure
              ? {
                  actionId: failure.action.id,
                  actionStatus: hasSuccess ? 'partial_failure' : 'failed',
                  blockedActionCount: batchResult.blocked.length,
                  autoExecutionFailed: true,
                }
              : {
                  actionStatus: 'completed',
                  actionCount: batchResult.completed.length,
                }),
            executionMode: 'auto',
            executionReason: params.executionReason,
            narrationSource: narrationFromLlm ? 'llm' : 'template',
            unifiedAgentFollowUp: true,
          },
          userId: params.userId,
          workspaceId: params.workspaceId,
        },
      })

      executionMessages.push(executionMessage)
    }
  }

  return {
    actionPlan,
    createdActions,
    reviewableActions,
    executionMessages,
    autoExecutionFailed,
  }
}
