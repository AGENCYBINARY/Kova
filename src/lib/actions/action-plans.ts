import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type { AgentProposal } from '@/lib/agent/v1'
import type { AgentPlanStep } from '@/lib/agent/planning'

type PlanWriter = PrismaClient | Prisma.TransactionClient

export type ActionPlanLifecycleStatus =
  | 'pending_review'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'partial_failure'
  | 'rejected'
  | 'expired'

function deriveStepFromProposal(proposal: AgentProposal): AgentPlanStep {
  return {
    title: proposal.title,
    detail: proposal.description,
    app: proposal.type,
  }
}

function normalizePlanSteps(plan: AgentPlanStep[], proposals: AgentProposal[]) {
  const count = Math.max(plan.length, proposals.length)
  return Array.from({ length: count }, (_, stepIndex) => {
    const explicitStep = plan[stepIndex]
    if (explicitStep) {
      return explicitStep
    }

    return deriveStepFromProposal(proposals[stepIndex])
  }).filter((step): step is AgentPlanStep => Boolean(step?.title?.trim()))
}

function buildPlanSummary(params: {
  assistantPlanContent?: string
  plan: AgentPlanStep[]
  proposals: AgentProposal[]
  language: 'fr' | 'en'
}) {
  const content = params.assistantPlanContent?.trim()
  if (content) {
    return content.slice(0, 500)
  }

  const explicitTitles = params.plan
    .map((step) => step.title.trim())
    .filter(Boolean)
    .slice(0, 4)

  if (explicitTitles.length > 0) {
    return explicitTitles.join(' -> ').slice(0, 500)
  }

  const proposalTitles = params.proposals
    .map((proposal) => proposal.title.trim())
    .filter(Boolean)
    .slice(0, 4)

  if (proposalTitles.length > 0) {
    return proposalTitles.join(' -> ').slice(0, 500)
  }

  return params.language === 'en' ? 'Operational plan' : 'Plan opérationnel'
}

function mapActionStatusesByStepIndex(
  actions: Array<{ status: string; planStepIndex: number | null }>
) {
  const grouped = new Map<number, string[]>()

  for (const action of actions) {
    if (typeof action.planStepIndex !== 'number') {
      continue
    }

    const existing = grouped.get(action.planStepIndex) || []
    existing.push(action.status)
    grouped.set(action.planStepIndex, existing)
  }

  return grouped
}

export function deriveActionPlanStepStatus(actionStatuses: string[]): ActionPlanLifecycleStatus | 'pending' {
  if (actionStatuses.length === 0) {
    return 'pending'
  }

  if (actionStatuses.some((status) => status === 'executing')) {
    return 'executing'
  }

  if (actionStatuses.every((status) => status === 'completed' || status === 'compensated')) {
    return 'completed'
  }

  if (actionStatuses.every((status) => status === 'rejected')) {
    return 'rejected'
  }

  if (actionStatuses.every((status) => status === 'expired')) {
    return 'expired'
  }

  if (actionStatuses.some((status) => status === 'failed')) {
    return actionStatuses.some((status) => status === 'completed' || status === 'compensated')
      ? 'partial_failure'
      : 'failed'
  }

  if (actionStatuses.some((status) => status === 'pending')) {
    return 'pending_review'
  }

  return 'partial_failure'
}

export function deriveActionPlanStatus(actionStatuses: string[]): ActionPlanLifecycleStatus {
  if (actionStatuses.length === 0) {
    return 'pending_review'
  }

  if (actionStatuses.some((status) => status === 'executing')) {
    return 'executing'
  }

  if (actionStatuses.every((status) => status === 'completed' || status === 'compensated')) {
    return 'completed'
  }

  if (actionStatuses.every((status) => status === 'rejected')) {
    return 'rejected'
  }

  if (actionStatuses.every((status) => status === 'expired')) {
    return 'expired'
  }

  if (actionStatuses.some((status) => status === 'failed')) {
    return actionStatuses.some((status) => status === 'completed' || status === 'compensated')
      ? 'partial_failure'
      : 'failed'
  }

  if (actionStatuses.some((status) => status === 'pending')) {
    return 'pending_review'
  }

  return 'partial_failure'
}

export async function createActionPlanForTurn(
  db: PlanWriter,
  params: {
    workspaceId: string
    userId: string
    messageId: string
    proposals: AgentProposal[]
    plan: AgentPlanStep[]
    assistantPlanContent?: string
    language: 'fr' | 'en'
  }
) {
  if (params.proposals.length === 0) {
    return null
  }

  if (params.plan.length === 0 && params.proposals.length < 2) {
    return null
  }

  const steps = normalizePlanSteps(params.plan, params.proposals)
  if (steps.length === 0) {
    return null
  }

  return db.actionPlan.create({
    data: {
      summary: buildPlanSummary({
        assistantPlanContent: params.assistantPlanContent,
        plan: params.plan,
        proposals: params.proposals,
        language: params.language,
      }),
      status: 'pending_review',
      metadata: {
        source: 'agent_turn',
        proposalTypes: params.proposals.map((proposal) => proposal.type),
      } satisfies Prisma.JsonObject,
      messageId: params.messageId,
      workspaceId: params.workspaceId,
      userId: params.userId,
      steps: {
        create: steps.map((step, stepIndex) => ({
          title: step.title,
          detail: step.detail,
          app: step.app || null,
          stepIndex,
          status: 'pending',
        })),
      },
    },
    include: {
      steps: {
        orderBy: { stepIndex: 'asc' },
      },
    },
  })
}

export async function syncActionPlans(params: { planIds: string[] }) {
  const uniquePlanIds = Array.from(new Set(params.planIds.filter(Boolean)))
  if (uniquePlanIds.length === 0) {
    return
  }

  const plans = await prisma.actionPlan.findMany({
    where: {
      id: {
        in: uniquePlanIds,
      },
    },
    include: {
      actions: {
        select: {
          status: true,
          planStepIndex: true,
        },
      },
      steps: {
        orderBy: { stepIndex: 'asc' },
        select: {
          id: true,
          stepIndex: true,
          status: true,
        },
      },
    },
  })

  await Promise.all(
    plans.map(async (plan) => {
      const stepStatusesByIndex = mapActionStatusesByStepIndex(plan.actions)
      const overallStatus = deriveActionPlanStatus(plan.actions.map((action) => action.status))
      const stepUpdates = plan.steps
        .map((step) => {
          const nextStatus = deriveActionPlanStepStatus(stepStatusesByIndex.get(step.stepIndex) || [])
          if (nextStatus === step.status) {
            return null
          }

          return prisma.actionPlanStep.update({
            where: { id: step.id },
            data: { status: nextStatus },
          })
        })
        .filter((value): value is ReturnType<typeof prisma.actionPlanStep.update> => Boolean(value))

      const planUpdate =
        overallStatus === plan.status
          ? null
          : prisma.actionPlan.update({
              where: { id: plan.id },
              data: { status: overallStatus },
            })

      await Promise.all([...stepUpdates, ...(planUpdate ? [planUpdate] : [])])
    })
  )
}

export async function syncActionPlansForActionIds(params: { actionIds: string[] }) {
  const uniqueActionIds = Array.from(new Set(params.actionIds.filter(Boolean)))
  if (uniqueActionIds.length === 0) {
    return
  }

  const rows = await prisma.action.findMany({
    where: {
      id: {
        in: uniqueActionIds,
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
    .filter((planId): planId is string => typeof planId === 'string' && planId.length > 0)

  await syncActionPlans({ planIds })
}
