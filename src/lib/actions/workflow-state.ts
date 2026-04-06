import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

type WorkflowPlanRecord = Awaited<ReturnType<typeof prisma.actionPlan.findMany>>[number] & {
  steps: Array<{
    id: string
    stepIndex: number
    status: string
    kind: string
    waitUntil: Date | null
    retryCount: number
    retryLimit: number
    retryBackoffSeconds: number
    lastError: string | null
    startedAt: Date | null
    completedAt: Date | null
    metadata: Prisma.JsonValue
  }>
  actions: Array<{
    id: string
    status: string
    planStepIndex: number | null
    result: Prisma.JsonValue
    type: string
    updatedAt: Date
  }>
}

type WorkflowCondition =
  | { type: 'always'; key?: string }
  | { type: 'if_previous_step_succeeded'; key?: string }
  | { type: 'if_previous_output_exists'; key?: string }

function asRecord(value: Prisma.JsonValue | null | undefined) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function isTerminalActionStatus(status: string) {
  return (
    status === 'completed' ||
    status === 'compensated' ||
    status === 'rejected' ||
    status === 'expired'
  )
}

function isRetryableProviderError(message: string) {
  return (
    /429/.test(message) ||
    /\b5\d{2}\b/.test(message) ||
    /timed out/i.test(message) ||
    /temporarily unavailable/i.test(message) ||
    /network/i.test(message) ||
    /ECONNRESET/i.test(message) ||
    /ETIMEDOUT/i.test(message)
  )
}

function isReconnectRequiredError(message: string) {
  return (
    /refresh token expired/i.test(message) ||
    /insufficient authentication scopes/i.test(message) ||
    /reconnect google/i.test(message) ||
    /reconnect notion/i.test(message) ||
    /\b401\b/.test(message)
  )
}

export function classifyWorkflowError(message: string) {
  if (isReconnectRequiredError(message)) {
    return {
      retryable: false,
      reconnectRequired: true,
    }
  }

  return {
    retryable: isRetryableProviderError(message),
    reconnectRequired: false,
  }
}

function readWorkflowCondition(step: WorkflowPlanRecord['steps'][number]): WorkflowCondition | null {
  const metadata = asRecord(step.metadata)
  const condition = metadata.condition
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
    return null
  }

  const parsed = condition as Record<string, unknown>
  const type = parsed.type
  if (
    type !== 'always' &&
    type !== 'if_previous_step_succeeded' &&
    type !== 'if_previous_output_exists'
  ) {
    return null
  }

  return {
    type,
    ...(typeof parsed.key === 'string' && parsed.key.trim().length > 0 ? { key: parsed.key } : {}),
  }
}

function getActionsForStep(plan: WorkflowPlanRecord, stepIndex: number) {
  return plan.actions.filter((action) => action.planStepIndex === stepIndex)
}

function getLastCompletedStepIndex(plan: WorkflowPlanRecord) {
  const completed = plan.steps
    .filter((step) => step.status === 'completed')
    .map((step) => step.stepIndex)
  return completed.length > 0 ? Math.max(...completed) : -1
}

function previousStepOutputHasKey(plan: WorkflowPlanRecord, stepIndex: number, key: string) {
  const previousActions = getActionsForStep(plan, stepIndex - 1).filter((action) =>
    action.status === 'completed' || action.status === 'compensated'
  )

  return previousActions.some((action) => {
    const result = asRecord(action.result)
    const output = asRecord(result.output as Prisma.JsonValue)
    return Object.prototype.hasOwnProperty.call(output, key)
  })
}

function isConditionSatisfied(plan: WorkflowPlanRecord, step: WorkflowPlanRecord['steps'][number]) {
  const condition = readWorkflowCondition(step)
  if (!condition || condition.type === 'always') {
    return true
  }

  if (condition.type === 'if_previous_step_succeeded') {
    if (step.stepIndex === 0) return true
    const previousStep = plan.steps.find((candidate) => candidate.stepIndex === step.stepIndex - 1)
    return previousStep?.status === 'completed'
  }

  if (condition.type === 'if_previous_output_exists') {
    if (!condition.key || step.stepIndex === 0) return false
    return previousStepOutputHasKey(plan, step.stepIndex, condition.key)
  }

  return true
}

function resolveCurrentStepIndex(plan: WorkflowPlanRecord) {
  const sorted = [...plan.steps].sort((left, right) => left.stepIndex - right.stepIndex)
  const active = sorted.find((step) =>
    step.status !== 'completed' &&
    step.status !== 'rejected' &&
    step.status !== 'expired'
  )

  if (active) {
    return active.stepIndex
  }

  return sorted.length > 0 ? sorted[sorted.length - 1].stepIndex : 0
}

async function markStepSkipped(tx: Prisma.TransactionClient, step: WorkflowPlanRecord['steps'][number], reason: string) {
  const metadata = asRecord(step.metadata)
  await tx.actionPlanStep.update({
    where: { id: step.id },
    data: {
      status: 'completed',
      completedAt: new Date(),
      metadata: {
        ...metadata,
        skipped: true,
        skippedReason: reason,
      } satisfies Prisma.JsonObject,
    },
  })
}

export async function scheduleRetryForFailedAction(params: {
  actionId: string
  error: string
  now?: Date
}) {
  const now = params.now || new Date()
  const action = await prisma.action.findUnique({
    where: { id: params.actionId },
    select: {
      id: true,
      planId: true,
      planStepIndex: true,
      result: true,
    },
  })

  if (!action?.planId || typeof action.planStepIndex !== 'number') {
    return { scheduled: false as const, reason: 'missing_plan' as const }
  }

  const classification = classifyWorkflowError(params.error)
  if (!classification.retryable) {
    return {
      scheduled: false as const,
      reason: classification.reconnectRequired ? 'reconnect_required' as const : 'not_retryable' as const,
    }
  }

  const step = await prisma.actionPlanStep.findFirst({
    where: {
      planId: action.planId,
      stepIndex: action.planStepIndex,
    },
    select: {
      id: true,
      retryCount: true,
      retryLimit: true,
      retryBackoffSeconds: true,
    },
  })

  if (!step || step.retryCount >= step.retryLimit) {
    return { scheduled: false as const, reason: 'retry_budget_exhausted' as const }
  }

  const retryAt = new Date(now.getTime() + step.retryBackoffSeconds * 1000)

  await prisma.$transaction(async (tx) => {
    const existingResult = asRecord(action.result)
    await tx.action.update({
      where: { id: action.id },
      data: {
        status: 'waiting',
        result: {
          ...existingResult,
          retryScheduledAt: retryAt.toISOString(),
          retryReason: params.error,
        } satisfies Prisma.JsonObject,
      },
    })

    await tx.actionPlanStep.update({
      where: { id: step.id },
      data: {
        status: 'waiting',
        retryCount: {
          increment: 1,
        },
        lastError: params.error,
      },
    })

    await tx.actionPlan.update({
      where: { id: action.planId! },
      data: {
        status: 'retry_scheduled',
        currentStepIndex: action.planStepIndex!,
        nextResumeAt: retryAt,
        lastError: params.error,
      },
    })
  })

  return { scheduled: true as const, retryAt }
}

export async function syncActionPlanWorkflowStates(params: {
  planIds: string[]
  now?: Date
}) {
  const now = params.now || new Date()
  const planIds = Array.from(new Set(params.planIds.filter(Boolean)))
  if (planIds.length === 0) {
    return
  }

  const plans = await prisma.actionPlan.findMany({
    where: {
      id: {
        in: planIds,
      },
    },
    include: {
      steps: {
        orderBy: { stepIndex: 'asc' },
      },
      actions: {
        select: {
          id: true,
          status: true,
          planStepIndex: true,
          result: true,
          type: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'asc' },
      },
    },
  })

  for (const plan of plans as WorkflowPlanRecord[]) {
    const currentStepIndex = resolveCurrentStepIndex(plan)
    const currentStep = plan.steps.find((step) => step.stepIndex === currentStepIndex)
    let nextStatus = plan.status
    let nextResumeAt = plan.nextResumeAt
    let nextError = plan.lastError

    if (currentStep) {
      const currentActions = getActionsForStep(plan, currentStep.stepIndex)
      const promoteWaitingActions = async (actionIds: string[]) => {
        if (actionIds.length === 0) {
          return
        }
        await prisma.action.updateMany({
          where: {
            id: {
              in: actionIds,
            },
            status: 'waiting',
          },
          data: {
            status: 'pending',
          },
        })
      }

      if (!isConditionSatisfied(plan, currentStep)) {
        await prisma.$transaction(async (tx) => {
          await markStepSkipped(tx, currentStep, 'condition_unmet')
          if (currentActions.length > 0) {
            await tx.action.updateMany({
              where: { id: { in: currentActions.map((action) => action.id) } },
              data: {
                status: 'expired',
                executedAt: now,
                result: {
                  details: 'Skipped because the workflow branch condition was not satisfied.',
                } satisfies Prisma.JsonObject,
              },
            })
          }
        })
        continue
      }

      if (currentStep.kind === 'wait' && currentStep.status !== 'completed') {
        if (!currentStep.waitUntil || currentStep.waitUntil.getTime() <= now.getTime()) {
          await prisma.actionPlanStep.update({
            where: { id: currentStep.id },
            data: {
              status: 'completed',
              completedAt: now,
            },
          })
          continue
        }

        nextStatus = 'waiting'
        nextResumeAt = currentStep.waitUntil
      } else if (currentActions.some((action) => action.status === 'waiting')) {
        const hasFutureWait = currentStep.waitUntil && currentStep.waitUntil.getTime() > now.getTime()
        if (hasFutureWait) {
          nextStatus = 'waiting'
          nextResumeAt = currentStep.waitUntil
        } else {
          await promoteWaitingActions(currentActions.filter((action) => action.status === 'waiting').map((action) => action.id))
          nextStatus = plan.executionMode === 'auto' ? 'waiting' : 'pending_review'
          nextResumeAt = plan.executionMode === 'auto' ? now : null
        }
      } else if (currentActions.some((action) => action.status === 'executing')) {
        nextStatus = 'executing'
        nextResumeAt = null
      } else if (currentActions.length > 0 && currentActions.every((action) => isTerminalActionStatus(action.status))) {
        const laterStep = plan.steps.find((step) => step.stepIndex === currentStep.stepIndex + 1)
        if (laterStep) {
          const laterActions = getActionsForStep(plan, laterStep.stepIndex)
          if (laterActions.some((action) => action.status === 'waiting')) {
            const due = !laterStep.waitUntil || laterStep.waitUntil.getTime() <= now.getTime()
            if (due) {
              await promoteWaitingActions(laterActions.filter((action) => action.status === 'waiting').map((action) => action.id))
              nextStatus = plan.executionMode === 'auto' ? 'waiting' : 'pending_review'
              nextResumeAt = plan.executionMode === 'auto' ? now : null
            } else {
              nextStatus = 'waiting'
              nextResumeAt = laterStep.waitUntil
            }
          } else {
            nextStatus = laterStep.status === 'completed' ? 'completed' : plan.status
          }
        } else if (currentActions.every((action) => action.status === 'completed' || action.status === 'compensated')) {
          nextStatus = 'completed'
          nextResumeAt = null
          nextError = null
        }
      }
    }

    await prisma.actionPlan.update({
      where: { id: plan.id },
      data: {
        currentStepIndex,
        status: nextStatus,
        nextResumeAt,
        lastError: nextError,
      },
    })
  }
}

export async function syncActionPlanWorkflowsForActionIds(params: {
  actionIds: string[]
  now?: Date
}) {
  const actionIds = Array.from(new Set(params.actionIds.filter(Boolean)))
  if (actionIds.length === 0) {
    return
  }

  const rows = await prisma.action.findMany({
    where: {
      id: {
        in: actionIds,
      },
      planId: {
        not: null,
      },
    },
    select: {
      planId: true,
    },
  })

  const planIds = rows
    .map((row) => row.planId)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)

  await syncActionPlanWorkflowStates({
    planIds,
    now: params.now,
  })
}

export async function activateReadyWorkflowSteps(params: {
  planId: string
  now?: Date
}) {
  const now = params.now || new Date()
  const plan = await prisma.actionPlan.findUnique({
    where: { id: params.planId },
    include: {
      steps: {
        orderBy: { stepIndex: 'asc' },
      },
      actions: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!plan) {
    return { activatedActionIds: [] as string[], executionMode: 'ask' as const }
  }

  const currentStep = plan.steps.find((step) => step.stepIndex === plan.currentStepIndex)
  if (!currentStep) {
    return { activatedActionIds: [] as string[], executionMode: plan.executionMode === 'auto' ? 'auto' : 'ask' }
  }

  if (currentStep.waitUntil && currentStep.waitUntil.getTime() > now.getTime()) {
    return { activatedActionIds: [] as string[], executionMode: plan.executionMode === 'auto' ? 'auto' : 'ask' }
  }

  const waitingActionIds = plan.actions
    .filter((action) => action.planStepIndex === currentStep.stepIndex && action.status === 'waiting')
    .map((action) => action.id)

  if (waitingActionIds.length === 0) {
    return { activatedActionIds: [] as string[], executionMode: plan.executionMode === 'auto' ? 'auto' : 'ask' }
  }

  await prisma.$transaction(async (tx) => {
    await tx.action.updateMany({
      where: {
        id: {
          in: waitingActionIds,
        },
      },
      data: {
        status: 'pending',
      },
    })

    await tx.actionPlan.update({
      where: { id: plan.id },
      data: {
        status: plan.executionMode === 'auto' ? 'executing' : 'pending_review',
        nextResumeAt: null,
        lastResumedAt: now,
      },
    })

    await tx.actionPlanStep.update({
      where: { id: currentStep.id },
      data: {
        status: plan.executionMode === 'auto' ? 'executing' : 'pending_review',
        startedAt: currentStep.startedAt || now,
      },
    })
  })

  return {
    activatedActionIds: waitingActionIds,
    executionMode: plan.executionMode === 'auto' ? 'auto' : 'ask',
  }
}

export async function findDueWorkflowPlans(params?: {
  limit?: number
  now?: Date
}) {
  const now = params?.now || new Date()
  return prisma.actionPlan.findMany({
    where: {
      status: {
        in: ['waiting', 'retry_scheduled'],
      },
      nextResumeAt: {
        lte: now,
      },
    },
    orderBy: { nextResumeAt: 'asc' },
    take: params?.limit || 20,
    select: {
      id: true,
      executionMode: true,
    },
  })
}
