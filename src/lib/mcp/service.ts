import { z } from 'zod'
import { executeAgentToolRequest } from '@/lib/agent/tool-execution'
import { createToolVisibilityAuditLog } from '@/lib/audit/service'
import { getWorkspaceGovernance } from '@/lib/agent/governance'
import { buildAgentManifest } from '@/lib/agent/manifest'
import { getErrorStatus } from '@/lib/http/errors'
import { listMcpTools } from '@/lib/mcp/registry'
import { buildMcpError, buildMcpSuccess, mcpRequestSchema } from '@/lib/mcp/protocol'

const toolCallParamsSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.unknown()).default({}),
  requireApproval: z.boolean().optional(),
})

interface McpServiceContext {
  workspaceId: string
  userId: string
}

interface HandleMcpRequestParams {
  payload: unknown
  context: McpServiceContext
}

export async function handleMcpRequest(params: HandleMcpRequestParams) {
  try {
    const payload = mcpRequestSchema.parse(params.payload)
    const governance = await getWorkspaceGovernance({
      workspaceId: params.context.workspaceId,
      userId: params.context.userId,
    })

    if (payload.method === 'initialize') {
      return buildMcpSuccess(payload.id, {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'kova-mcp',
          version: '1.0.0',
        },
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
      })
    }

    if (payload.method === 'manifest/get' || payload.method === 'capabilities/get') {
      return buildMcpSuccess(payload.id, {
        manifest: buildAgentManifest(governance.allowedActionTypes),
        workspaceRole: governance.role,
      })
    }

    if (payload.method === 'tools/list') {
      await createToolVisibilityAuditLog({
        workspaceId: params.context.workspaceId,
        userId: params.context.userId,
        source: 'mcp',
        visibleTools: governance.allowedActionTypes,
        allowedActionTypes: governance.allowedActionTypes,
      })

      const tools = listMcpTools()
        .filter((tool) => governance.allowedActionTypes.includes(tool.actionType))
        .map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: {
            actionType: tool.actionType,
            provider: tool.provider,
            riskLevel: tool.riskLevel,
            deterministic: tool.deterministic,
            zeroDataMovement: tool.zeroDataMovement,
            version: tool.version,
          },
        }))

      return buildMcpSuccess(payload.id, {
        tools,
        manifest: buildAgentManifest(governance.allowedActionTypes),
        workspaceRole: governance.role,
      })
    }

    if (payload.method === 'tools/call') {
      const callParams = toolCallParamsSchema.parse(payload.params || {})
      const result = await executeAgentToolRequest({
        toolName: callParams.name,
        parameters: callParams.arguments,
        requireApproval: callParams.requireApproval,
        context: params.context,
        trigger: 'api',
        source: 'mcp',
      })

      if (result.mode === 'pending_review') {
        return buildMcpSuccess(payload.id, {
          content: [
            {
              type: 'text',
              text: `Action queued for approval: ${result.action.title}`,
            },
          ],
          actionId: result.action.id,
          governance: result.governance,
        })
      }

      return buildMcpSuccess(payload.id, {
        content: [
          {
            type: 'text',
            text: result.execution.details,
          },
        ],
        actionId: result.action.id,
        structuredContent: result.execution.output,
        governance: result.governance,
      })
    }

    return buildMcpError(payload.id, -32601, `Method "${payload.method}" not found.`)
  } catch (error) {
    const { message } = getErrorStatus(error)
    return buildMcpError(null, -32000, message)
  }
}
