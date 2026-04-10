import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { executeBatch, type BatchAction } from '@/lib/actions/batch-execution'
import { syncActionPlansForActionIds } from '@/lib/actions/action-plans'
import { compensateCompletedActions } from '@/lib/actions/compensation'
import { scheduleRetryForFailedAction, syncActionPlanWorkflowsForActionIds } from '@/lib/actions/workflow-state'
import { sortBatchActionsForExecution } from '@/lib/actions/batch-order'
import { asActionParameters, injectExecutionOutputsIntoParameters } from '@/lib/actions/parameter-resolution'
import { createAuditLog } from '@/lib/audit/service'
import { extractNameBeforeEmail, rememberContact } from '@/lib/contacts'
import { executePersistedAction } from '@/lib/integrations/execute'

type PersistedActionRecord = {
  id: string
  type: string
  title: string
  description: string
  parameters: Prisma.JsonValue
  workspaceId: string
  userId: string
}

function getConfidenceScore(parameters: Prisma.JsonValue) {
  const actionParameters = asActionParameters(parameters)
  return typeof actionParameters.confidenceScore === 'number' ? actionParameters.confidenceScore : 0.85
}

const MAX_SCHEDULE_AHEAD_MS = 1000 * 60 * 60 * 24 * 90

/** If send_email should be deferred until scheduledSendAt (future, within horizon). */
export function resolveSendEmailScheduledExecution(effectiveParameters: Record<string, unknown>) {
  const raw = effectiveParameters.scheduledSendAt
  if (raw === undefined || raw === null) {
    return { defer: false as const }
  }
  const str = typeof raw === 'string' ? raw.trim() : ''
  if (!str) {
    return { defer: false as const }
  }
  const when = new Date(str)
  if (Number.isNaN(when.getTime())) {
    return { defer: false as const }
  }
  const now = Date.now()
  if (when.getTime() <= now) {
    return { defer: false as const }
  }
  if (when.getTime() > now + MAX_SCHEDULE_AHEAD_MS) {
    return { defer: false as const }
  }
  return { defer: true as const, when }
}

async function rememberSuccessfulEmailRecipients(params: {
  action: PersistedActionRecord
  parameters: Record<string, unknown>
}) {
  if (
    params.action.type !== 'send_email' &&
    params.action.type !== 'forward_email' &&
    params.action.type !== 'create_gmail_draft'
  ) {
    return
  }

  const recipients =
    Array.isArray(params.parameters.to)
      ? params.parameters.to.filter((value): value is string => typeof value === 'string')
      : []

  for (const recipient of recipients) {
    if (!recipient.includes('@')) continue

    await rememberContact({
      userId: params.action.userId,
      workspaceId: params.action.workspaceId,
      email: recipient,
      name:
        typeof params.parameters.resolvedContactName === 'string'
          ? params.parameters.resolvedContactName
          : extractNameBeforeEmail(params.action.description, recipient),
    })
  }
}

export async function executePersistedActionBatch(params: {
  actions: PersistedActionRecord[]
  trigger: 'auto' | 'approval' | 'api'
}) {
  const persistedActionsById = new Map(params.actions.map((action) => [action.id, action]))
  const orderedActions = sortBatchActionsForExecution(params.actions)
  const actions = orderedActions.map((action) => ({
    id: action.id,
    type: action.type,
    title: action.title,
    description: action.description,
    parameters: asActionParameters(action.parameters),
  })) satisfies Array<BatchAction<Record<string, unknown>>>

  const batchResult = await executeBatch({
    actions,
    resolveParameters: (parameters, priorOutputs) =>
      injectExecutionOutputsIntoParameters(parameters, priorOutputs) as Record<string, unknown>,
    execute: async (action, effectiveParameters) => {
      const persistedAction = persistedActionsById.get(action.id)
      if (!persistedAction) {
        throw new Error('Action not found.')
      }

      if (action.type === 'send_email') {
        const schedule = resolveSendEmailScheduledExecution(effectiveParameters as Record<string, unknown>)
        if (schedule.defer) {
          return {
            details:
              params.trigger === 'approval'
                ? `Email programmé pour ${schedule.when.toISOString()} (UTC). Il part automatiquement à cette heure.`
                : `Email mis en file pour ${schedule.when.toISOString()} (UTC).`,
            output: {
              provider: 'gmail',
              toolName: 'send_email',
              scheduled: true,
              scheduledFor: schedule.when.toISOString(),
              zeroDataMovement: true,
              deterministic: true,
            },
          }
        }
      }

      return executePersistedAction({
        action: {
          id: persistedAction.id,
          type: persistedAction.type as Parameters<typeof executePersistedAction>[0]['action']['type'],
          title: persistedAction.title,
          description: persistedAction.description,
          parameters: effectiveParameters as Prisma.JsonObject,
          workspaceId: persistedAction.workspaceId,
          userId: persistedAction.userId,
        },
      })
    },
    onSuccess: async (action, effectiveParameters, execution) => {
      const persistedAction = persistedActionsById.get(action.id)
      if (!persistedAction) {
        throw new Error('Action not found.')
      }

      const output = execution.output as Record<string, unknown>
      const isScheduledDefer = output.scheduled === true && typeof output.scheduledFor === 'string'
      const scheduledFor = isScheduledDefer ? new Date(output.scheduledFor as string) : null

      if (isScheduledDefer && scheduledFor && !Number.isNaN(scheduledFor.getTime())) {
        const { scheduledSendAt: _ss, ...paramsToSave } = effectiveParameters as Record<string, unknown>
        await prisma.action.update({
          where: { id: action.id },
          data: {
            status: 'scheduled',
            scheduledFor,
            parameters: paramsToSave as Prisma.JsonObject,
            result: {
              confidenceScore: getConfidenceScore(persistedAction.parameters),
              details: execution.details,
              output: execution.output as Prisma.JsonObject,
              executionTrigger: params.trigger,
              scheduled: true,
            } as Prisma.JsonObject,
          },
        })

        await createAuditLog({
          actionType: persistedAction.type,
          status: 'success',
          actionId: persistedAction.id,
          workspaceId: persistedAction.workspaceId,
          userId: persistedAction.userId,
          details: { scheduled: true, scheduledFor: scheduledFor.toISOString() },
          provider: 'gmail',
          toolName: 'send_email',
          executionTrigger: params.trigger,
        })

        return
      }

      await prisma.action.update({
        where: { id: action.id },
        data: {
          status: 'completed',
          executedAt: new Date(),
          scheduledFor: null,
          parameters: effectiveParameters as Prisma.JsonObject,
          result: {
            confidenceScore: getConfidenceScore(persistedAction.parameters),
            details: execution.details,
            output: execution.output as Prisma.JsonObject,
            executionTrigger: params.trigger,
          } as Prisma.JsonObject,
        },
      })

      await createAuditLog({
        actionType: persistedAction.type,
        status: 'success',
        actionId: persistedAction.id,
        workspaceId: persistedAction.workspaceId,
        userId: persistedAction.userId,
        details: execution.output,
        provider:
          typeof execution.output.provider === 'string'
            ? (execution.output.provider as 'gmail' | 'calendar' | 'google_docs' | 'google_drive' | 'google_photos' | 'notion')
            : undefined,
        toolName: typeof execution.output.toolName === 'string' ? execution.output.toolName : undefined,
        toolVersion: typeof execution.output.toolVersion === 'string' ? execution.output.toolVersion : undefined,
        deterministic: typeof execution.output.deterministic === 'boolean' ? execution.output.deterministic : undefined,
        zeroDataMovement:
          typeof execution.output.zeroDataMovement === 'boolean' ? execution.output.zeroDataMovement : undefined,
        executionTrigger: params.trigger,
      })

      await rememberSuccessfulEmailRecipients({
        action: persistedAction,
        parameters: effectiveParameters,
      })
    },
    onFailure: async (action, effectiveParameters, error) => {
      const persistedAction = persistedActionsById.get(action.id)
      if (!persistedAction) {
        throw new Error('Action not found.')
      }

      await prisma.action.update({
        where: { id: action.id },
        data: {
          status: 'failed',
          executedAt: new Date(),
          parameters: effectiveParameters as Prisma.JsonObject,
          result: {
            confidenceScore: getConfidenceScore(persistedAction.parameters),
            details: 'Execution failed before the batch could finish.',
            error,
            executionTrigger: params.trigger,
          } as Prisma.JsonObject,
        },
      })

      await createAuditLog({
        actionType: persistedAction.type,
        status: 'failure',
        actionId: persistedAction.id,
        workspaceId: persistedAction.workspaceId,
        userId: persistedAction.userId,
        error,
        executionTrigger: params.trigger,
        details: {
          failedDuring: 'batch_execution',
        },
      })
    },
    onBlocked: async (action, effectiveParameters, error) => {
      const persistedAction = persistedActionsById.get(action.id)
      if (!persistedAction) {
        throw new Error('Action not found.')
      }

      await prisma.action.update({
        where: { id: action.id },
        data: {
          status: 'pending',
          parameters: effectiveParameters as Prisma.JsonObject,
          result: {
            confidenceScore: getConfidenceScore(persistedAction.parameters),
            details: 'Execution was paused because an earlier linked action failed.',
            blockedByError: error,
            executionTrigger: params.trigger,
            requiresReview: true,
          } as Prisma.JsonObject,
        },
      })
    },
  })

  let compensation: Awaited<ReturnType<typeof compensateCompletedActions>> | null = null

  if (batchResult.failed && batchResult.completed.length > 0) {
    const failedAction = persistedActionsById.get(batchResult.failed.action.id)
    if (!failedAction) {
      throw new Error('Failed action not found.')
    }

    compensation = await compensateCompletedActions({
      completed: batchResult.completed,
      workspaceId: failedAction.workspaceId,
      userId: failedAction.userId,
      trigger: params.trigger,
      failedActionId: failedAction.id,
    })

    const compensationByActionId = new Map(compensation.attempts.map((attempt) => [attempt.sourceActionId, attempt]))
    await Promise.all(
      batchResult.completed.map(async (completedAction) => {
        const persistedAction = persistedActionsById.get(completedAction.action.id)
        if (!persistedAction) {
          throw new Error('Completed action not found.')
        }

        const attempt = compensationByActionId.get(completedAction.action.id)
        const existingResult = asActionParameters(
          (await prisma.action.findUnique({
            where: { id: persistedAction.id },
            select: { result: true },
          }))?.result ?? {}
        )

        const compensationPayload = {
          status: attempt?.status || 'skipped',
          compensationActionType: attempt?.compensationActionType || null,
          reason: attempt?.reason || null,
          compensatedAt: attempt?.status === 'compensated' ? new Date().toISOString() : null,
        }

        await prisma.action.update({
          where: { id: persistedAction.id },
          data: {
            status: attempt?.status === 'compensated' ? 'compensated' : 'completed',
            result: {
              ...existingResult,
              compensation: compensationPayload,
            } as Prisma.JsonObject,
          },
        })
      })
    )
  }

  if (batchResult.failed) {
    await scheduleRetryForFailedAction({
      actionId: batchResult.failed.action.id,
      error: batchResult.failed.error,
    })
  }
  await syncActionPlansForActionIds({
    actionIds: params.actions.map((action) => action.id),
  })
  await syncActionPlanWorkflowsForActionIds({
    actionIds: params.actions.map((action) => action.id),
  })

  return {
    ...batchResult,
    compensation,
  }
}
