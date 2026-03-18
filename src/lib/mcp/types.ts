import type { z } from 'zod'
import type { DashboardAction } from '@/lib/dashboard-data'
import type { IntegrationExecutionResult, IntegrationProvider } from '@/lib/integrations/types'

export interface McpExecutionContext {
  workspaceId: string
  userId: string
}

export interface McpToolDefinition<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string
  actionType: DashboardAction['type']
  provider: IntegrationProvider
  title: string
  description: string
  version: string
  riskLevel: 'low' | 'medium' | 'high'
  deterministic: boolean
  zeroDataMovement: boolean
  inputSchemaJson: Record<string, unknown>
  inputSchema: TSchema
  execute: (
    context: McpExecutionContext,
    input: z.infer<TSchema>
  ) => Promise<IntegrationExecutionResult>
}
