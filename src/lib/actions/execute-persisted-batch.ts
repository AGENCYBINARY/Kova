import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { executeBatch, type BatchAction } from '@/lib/actions/batch-execution'
import { asActionParameters, injectExecutionOutputsIntoParameters } from '@/lib/actions/parameter-resolution'
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

async function rememberSuccessfulEmailRecipients(params: {
  action: PersistedActionRecord
  parameters: Record<string, unknown>
}) {
  if (params.action.type !== 'send_email') {
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
  const actions = params.actions.map((action) => ({
    id: action.id,
    type: action.type,
    title: action.title,
    description: action.description,
    parameters: asActionParameters(action.parameters),
  })) satisfies Array<BatchAction<Record<string, unknown>>>

  return executeBatch({
    actions,
    resolveParameters: (parameters, priorOutputs) =>
      injectExecutionOutputsIntoParameters(parameters, priorOutputs) as Record<string, unknown>,
    onBeforeExecute: async (action, effectiveParameters) => {
      await prisma.action.update({
        where: { id: action.id },
        data: {
          status: 'executing',
          parameters: effectiveParameters as Prisma.JsonObject,
        },
      })
    },
    execute: async (action, effectiveParameters) => {
      const persistedAction = params.actions.find((item) => item.id === action.id)
      if (!persistedAction) {
        throw new Error('Action not found.')
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
      const persistedAction = params.actions.find((item) => item.id === action.id)
      if (!persistedAction) {
        throw new Error('Action not found.')
      }

      await prisma.action.update({
        where: { id: action.id },
        data: {
          status: 'completed',
          executedAt: new Date(),
          parameters: effectiveParameters as Prisma.JsonObject,
          result: {
            confidenceScore: getConfidenceScore(persistedAction.parameters),
            details: execution.details,
            output: execution.output as Prisma.JsonObject,
            executionTrigger: params.trigger,
          } as Prisma.JsonObject,
        },
      })

      await prisma.executionLog.create({
        data: {
          actionType: persistedAction.type,
          status: 'success',
          details: execution.output as Prisma.JsonObject,
          actionId: persistedAction.id,
          workspaceId: persistedAction.workspaceId,
          userId: persistedAction.userId,
        },
      })

      await rememberSuccessfulEmailRecipients({
        action: persistedAction,
        parameters: effectiveParameters,
      })
    },
    onFailure: async (action, effectiveParameters, error) => {
      const persistedAction = params.actions.find((item) => item.id === action.id)
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

      await prisma.executionLog.create({
        data: {
          actionType: persistedAction.type,
          status: 'failure',
          error,
          actionId: persistedAction.id,
          workspaceId: persistedAction.workspaceId,
          userId: persistedAction.userId,
        },
      })
    },
    onBlocked: async (action, effectiveParameters, error) => {
      const persistedAction = params.actions.find((item) => item.id === action.id)
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
}
