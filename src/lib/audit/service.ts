import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type { DashboardAction } from '@/lib/dashboard-data'
import type { IntegrationProvider } from '@/lib/integrations/types'

export type AuditStatus = 'review_required' | 'success' | 'failure' | 'rejected'

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
