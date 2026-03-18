import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type { DashboardAction } from '@/lib/dashboard-data'
import { getAssistantProfile } from '@/lib/assistant/store'
import { createAuditLog } from '@/lib/audit/service'
import { assertActionAllowed, getWorkspaceGovernance } from '@/lib/agent/governance'
import { inferRiskLevel, resolveExecutionDecision } from '@/lib/agent/policy'
import { executePersistedActionBatch } from '@/lib/actions/execute-persisted-batch'
import {
  prepareAndValidateToolInputByActionType,
  prepareAndValidateToolInputByName,
} from '@/lib/mcp/registry'

interface ExecutionContext {
  workspaceId: string
  userId: string
}

type ExecutionTrigger = 'api' | 'review'

interface ToolExecutionRequestByActionType {
  actionType: DashboardAction['type']
  parameters: Record<string, unknown>
  requireApproval?: boolean
  context: ExecutionContext
  trigger?: ExecutionTrigger
}

interface ToolExecutionRequestByName {
  toolName: string
  parameters: Record<string, unknown>
  requireApproval?: boolean
  context: ExecutionContext
  trigger?: ExecutionTrigger
}

export type ToolExecutionRequest = ToolExecutionRequestByActionType | ToolExecutionRequestByName

export type ToolExecutionResult =
  | {
      mode: 'pending_review'
      action: Awaited<ReturnType<typeof prisma.action.create>>
      governance: {
        toolName: string
        toolVersion: string
        workspaceRole: string
        riskLevel: 'low' | 'medium' | 'high'
        deterministic: boolean
        zeroDataMovement: boolean
        executionReason: string
      }
    }
  | {
      mode: 'executed'
      action: NonNullable<Awaited<ReturnType<typeof prisma.action.findUnique>>>
      execution: Awaited<ReturnType<typeof executePersistedActionBatch>>['completed'][number]['execution']
      governance: {
        toolName: string
        toolVersion: string
        workspaceRole: string
        riskLevel: 'low' | 'medium' | 'high'
        deterministic: boolean
        zeroDataMovement: boolean
        executionReason: string
      }
    }

function buildGovernanceSummary(params: {
  toolName: string
  toolVersion: string
  workspaceRole: string
  riskLevel: 'low' | 'medium' | 'high'
  deterministic: boolean
  zeroDataMovement: boolean
  executionReason: string
}) {
  return {
    toolName: params.toolName,
    toolVersion: params.toolVersion,
    workspaceRole: params.workspaceRole,
    riskLevel: params.riskLevel,
    deterministic: params.deterministic,
    zeroDataMovement: params.zeroDataMovement,
    executionReason: params.executionReason,
  }
}

export async function executeAgentToolRequest(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
  const { workspaceId, userId } = request.context
  const [governance, assistantProfile] = await Promise.all([
    getWorkspaceGovernance({
      workspaceId,
      userId,
    }),
    getAssistantProfile(workspaceId),
  ])

  const resolved =
    'actionType' in request
      ? prepareAndValidateToolInputByActionType(request.actionType, request.parameters)
      : prepareAndValidateToolInputByName(request.toolName, request.parameters)

  const actionType = resolved.tool.actionType
  const tool = resolved.tool

  assertActionAllowed({
    role: governance.role,
    allowedActionTypes: governance.allowedActionTypes,
    actionType,
  })

  const riskLevel = inferRiskLevel(actionType, resolved.validated)
  const executionDecision = resolveExecutionDecision({
    requestedMode: request.requireApproval ? 'ask' : 'auto',
    proposals: [
      {
        type: actionType,
        confidenceScore:
          typeof (resolved.validated as Record<string, unknown>).confidenceScore === 'number'
            ? ((resolved.validated as Record<string, unknown>).confidenceScore as number)
            : assistantProfile.confidenceThreshold,
        parameters: resolved.validated,
      },
    ],
    assistantProfile,
  })

  const action = await prisma.action.create({
    data: {
      type: actionType,
      title: tool.title,
      description: tool.description,
      parameters: resolved.validated as Prisma.JsonObject,
      status: 'pending',
      workspaceId,
      userId,
    },
  })

  const governanceSummary = buildGovernanceSummary({
    toolName: tool.name,
    toolVersion: tool.version,
    workspaceRole: governance.role,
    riskLevel,
    deterministic: tool.deterministic,
    zeroDataMovement: tool.zeroDataMovement,
    executionReason: executionDecision.reason,
  })

  if (executionDecision.effectiveMode === 'ask') {
    await createAuditLog({
      actionType,
      status: 'review_required',
      actionId: action.id,
      workspaceId,
      userId,
      provider: tool.provider,
      toolName: tool.name,
      toolVersion: tool.version,
      riskLevel,
      deterministic: tool.deterministic,
      zeroDataMovement: tool.zeroDataMovement,
      executionReason: executionDecision.reason,
      executionTrigger: request.trigger || 'api',
      details: {
        mode: 'pending_review',
      },
    })

    return {
      mode: 'pending_review',
      action,
      governance: governanceSummary,
    }
  }

  const batchResult = await executePersistedActionBatch({
    actions: [
      {
        id: action.id,
        type: action.type,
        title: action.title,
        description: action.description,
        parameters: action.parameters,
        workspaceId,
        userId,
      },
    ],
    trigger: 'api',
  })

  const completedAction = await prisma.action.findUnique({
    where: { id: action.id },
  })

  if (!completedAction || batchResult.failed || batchResult.completed.length === 0) {
    throw new Error(batchResult.failed?.error || 'Action execution requires manual review.')
  }

  return {
    mode: 'executed',
    action: completedAction,
    execution: batchResult.completed[0].execution,
    governance: governanceSummary,
  }
}
