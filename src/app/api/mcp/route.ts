import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAppContext } from '@/lib/app-context'
import { executeAgentToolRequest } from '@/lib/agent/tool-execution'
import { getWorkspaceGovernance } from '@/lib/agent/governance'
import { buildAgentManifest } from '@/lib/agent/manifest'
import { listMcpTools } from '@/lib/mcp/registry'
import { getErrorStatus } from '@/lib/http/errors'

const mcpRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
})

function buildSuccess(id: string | number | null | undefined, result: unknown) {
  return NextResponse.json({
    jsonrpc: '2.0',
    id: id ?? null,
    result,
  })
}

function buildError(id: string | number | null | undefined, code: number, message: string) {
  return NextResponse.json({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message },
  })
}

export async function POST(request: Request) {
  try {
    const payload = mcpRequestSchema.parse(await request.json())
    const { dbUserId, workspaceId } = await getAppContext()
    const governance = await getWorkspaceGovernance({
      workspaceId,
      userId: dbUserId,
    })

    if (payload.method === 'initialize') {
      return buildSuccess(payload.id, {
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

    if (payload.method === 'tools/list') {
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

      return buildSuccess(payload.id, {
        tools,
        manifest: buildAgentManifest(governance.allowedActionTypes),
        workspaceRole: governance.role,
      })
    }

    if (payload.method === 'tools/call') {
      const params = z.object({
        name: z.string().min(1),
        arguments: z.record(z.unknown()).default({}),
        requireApproval: z.boolean().optional(),
      }).parse(payload.params || {})
      const result = await executeAgentToolRequest({
        toolName: params.name,
        parameters: params.arguments,
        requireApproval: params.requireApproval,
        context: {
          workspaceId,
          userId: dbUserId,
        },
        trigger: 'api',
      })

      if (result.mode === 'pending_review') {
        return buildSuccess(payload.id, {
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

      return buildSuccess(payload.id, {
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

    return buildError(payload.id, -32601, `Method "${payload.method}" not found.`)
  } catch (error) {
    const { message } = getErrorStatus(error)
    return buildError(null, -32000, message)
  }
}
