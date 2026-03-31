import type { DashboardAction } from '@/lib/dashboard-data'
import { prepareActionParameters } from '@/lib/agent/data-prep'
import type { IntegrationExecutionResult } from '@/lib/integrations/types'
import type { McpExecutionContext } from '@/lib/mcp/types'
import { tools } from '@/lib/mcp/registry-catalog'

export function listMcpTools() {
  return tools.map((tool) => ({
    name: tool.name,
    actionType: tool.actionType,
    provider: tool.provider,
    title: tool.title,
    description: tool.description,
    version: tool.version,
    riskLevel: tool.riskLevel,
    deterministic: tool.deterministic,
    zeroDataMovement: tool.zeroDataMovement,
    inputSchema: tool.inputSchemaJson,
  }))
}

export function getToolByActionType(actionType: DashboardAction['type']) {
  return tools.find((tool) => tool.actionType === actionType) || null
}

export function getToolByName(name: string) {
  return tools.find((tool) => tool.name === name) || null
}

export function prepareAndValidateToolInputByActionType(
  actionType: DashboardAction['type'],
  parameters: Record<string, unknown>
) {
  const tool = getToolByActionType(actionType)
  if (!tool) {
    throw new Error(`No MCP tool registered for action type "${actionType}".`)
  }

  const prepared = prepareActionParameters(actionType, parameters)
  const validated = tool.inputSchema.parse(prepared)

  return {
    tool,
    prepared,
    validated,
  }
}

export function prepareAndValidateToolInputByName(
  name: string,
  parameters: Record<string, unknown>
) {
  const tool = getToolByName(name)
  if (!tool) {
    throw new Error(`Unknown tool "${name}".`)
  }

  const prepared = prepareActionParameters(tool.actionType, parameters)
  const validated = tool.inputSchema.parse(prepared)

  return {
    tool,
    prepared,
    validated,
  }
}

export async function executeToolByActionType(params: {
  actionType: DashboardAction['type']
  parameters: Record<string, unknown>
  context: McpExecutionContext
}): Promise<IntegrationExecutionResult> {
  const { tool, validated } = prepareAndValidateToolInputByActionType(params.actionType, params.parameters)
  const execution = await tool.execute(params.context, validated)

  return {
    details: execution.details,
    output: {
      ...execution.output,
      toolName: tool.name,
      toolVersion: tool.version,
      deterministic: tool.deterministic,
      zeroDataMovement: tool.zeroDataMovement,
      provider: tool.provider,
    },
  }
}
