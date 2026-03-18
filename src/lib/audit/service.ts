import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type { DashboardAction } from '@/lib/dashboard-data'
import type { IntegrationProvider } from '@/lib/integrations/types'

export type AuditStatus =
  | 'review_required'
  | 'success'
  | 'failure'
  | 'rejected'
  | 'read'
  | 'decision'
  | 'fallback'
  | 'tool_visibility'
  | 'policy_denied'

export interface AuditLogInput {
  actionType: DashboardAction['type'] | string
  status: AuditStatus
  workspaceId: string
  userId: string
  actionId?: string | null
  integrationId?: string | null
  error?: string | null
  details?: Record<string, unknown>
  provider?: IntegrationProvider
  toolName?: string
  toolVersion?: string
  riskLevel?: 'low' | 'medium' | 'high'
  deterministic?: boolean
  zeroDataMovement?: boolean
  executionReason?: string
  executionTrigger?: 'auto' | 'approval' | 'api' | 'review'
}

function toJsonObject(value: Record<string, unknown> | undefined) {
  return (value || {}) as Prisma.JsonObject
}

export function buildAuditDetails(input: AuditLogInput) {
  return {
    platform: 'kova-agent',
    status: input.status,
    provider: input.provider || null,
    toolName: input.toolName || null,
    toolVersion: input.toolVersion || null,
    riskLevel: input.riskLevel || null,
    deterministic: input.deterministic ?? null,
    zeroDataMovement: input.zeroDataMovement ?? null,
    executionReason: input.executionReason || null,
    executionTrigger: input.executionTrigger || null,
    ...(input.details || {}),
  } satisfies Record<string, unknown>
}

export async function createAuditLog(input: AuditLogInput) {
  return prisma.executionLog.create({
    data: {
      actionType: input.actionType,
      status: input.status,
      details: toJsonObject(buildAuditDetails(input)),
      error: input.error || null,
      actionId: input.actionId || null,
      integrationId: input.integrationId || null,
      workspaceId: input.workspaceId,
      userId: input.userId,
    },
  })
}

export async function createToolVisibilityAuditLog(params: {
  workspaceId: string
  userId: string
  visibleTools: string[]
  allowedActionTypes: string[]
  source: 'chat' | 'api' | 'mcp'
}) {
  return createAuditLog({
    actionType: 'agent.tool_visibility',
    status: 'tool_visibility',
    workspaceId: params.workspaceId,
    userId: params.userId,
    details: {
      source: params.source,
      visibleTools: params.visibleTools,
      allowedActionTypes: params.allowedActionTypes,
    },
  })
}

export async function createDecisionAuditLog(params: {
  workspaceId: string
  userId: string
  actionType?: string
  actionId?: string | null
  executionMode: 'ask' | 'auto'
  executionReason: string
  source: 'chat' | 'api' | 'mcp'
  proposalCount: number
  riskLevel?: 'low' | 'medium' | 'high'
  details?: Record<string, unknown>
}) {
  return createAuditLog({
    actionType: params.actionType || 'agent.decision',
    status: 'decision',
    workspaceId: params.workspaceId,
    userId: params.userId,
    actionId: params.actionId,
    riskLevel: params.riskLevel,
    executionReason: params.executionReason,
    details: {
      source: params.source,
      executionMode: params.executionMode,
      proposalCount: params.proposalCount,
      ...(params.details || {}),
    },
  })
}

export async function createConnectedReadAuditLog(params: {
  workspaceId: string
  userId: string
  sources: string[]
  timeframe: string
  strategy: 'model' | 'deterministic' | 'fallback'
  details?: Record<string, unknown>
}) {
  return createAuditLog({
    actionType: 'agent.connected_read',
    status: 'read',
    workspaceId: params.workspaceId,
    userId: params.userId,
    details: {
      sources: params.sources,
      timeframe: params.timeframe,
      strategy: params.strategy,
      ...(params.details || {}),
    },
  })
}

export async function createFallbackAuditLog(params: {
  workspaceId: string
  userId: string
  source: 'chat' | 'api' | 'mcp'
  fallbackKind: 'deterministic' | 'connected_context_fallback' | 'model_error' | 'low_value_response'
  details?: Record<string, unknown>
}) {
  return createAuditLog({
    actionType: 'agent.fallback',
    status: 'fallback',
    workspaceId: params.workspaceId,
    userId: params.userId,
    details: {
      source: params.source,
      fallbackKind: params.fallbackKind,
      ...(params.details || {}),
    },
  })
}

export async function createPolicyDeniedAuditLog(params: {
  workspaceId: string
  userId: string
  actionType: string
  source: 'chat' | 'api' | 'mcp'
  executionReason: string
  details?: Record<string, unknown>
}) {
  return createAuditLog({
    actionType: params.actionType,
    status: 'policy_denied',
    workspaceId: params.workspaceId,
    userId: params.userId,
    executionReason: params.executionReason,
    details: {
      source: params.source,
      ...(params.details || {}),
    },
  })
}
