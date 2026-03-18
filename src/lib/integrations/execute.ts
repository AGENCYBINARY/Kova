import type { Prisma } from '@prisma/client'
import type { DashboardAction } from '@/lib/dashboard-data'
import type { IntegrationExecutionResult } from '@/lib/integrations/types'
import { asActionParameters } from '@/lib/actions/parameter-resolution'
import { executeToolByActionType } from '@/lib/mcp/registry'

export async function executePersistedAction(params: {
  action: {
    id: string
    type: DashboardAction['type']
    title: string
    description: string
    parameters: Prisma.JsonValue
    workspaceId: string
    userId: string
  }
}): Promise<IntegrationExecutionResult> {
  return executeToolByActionType({
    actionType: params.action.type as DashboardAction['type'],
    parameters: asActionParameters(params.action.parameters),
    context: {
      workspaceId: params.action.workspaceId,
      userId: params.action.userId,
    },
  })
}
