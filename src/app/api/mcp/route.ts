import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { getAppContext } from '@/lib/app-context'
import { getAssistantProfile } from '@/lib/assistant/store'
import { assertActionAllowed, getWorkspaceGovernance } from '@/lib/agent/governance'
import { buildAgentManifest } from '@/lib/agent/manifest'
import { inferRiskLevel, resolveExecutionDecision } from '@/lib/agent/policy'
import { executePersistedActionBatch } from '@/lib/actions/execute-persisted-batch'
import { getToolByName, listMcpTools } from '@/lib/mcp/registry'

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
    const [governance, assistantProfile] = await Promise.all([
      getWorkspaceGovernance({
        workspaceId,
        userId: dbUserId,
      }),
      getAssistantProfile(workspaceId),
    ])

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
            provider: tool.provider,
            riskLevel: tool.riskLevel,
            deterministic: tool.deterministic,
            zeroDataMovement: tool.zeroDataMovement,
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

      const tool = getToolByName(params.name)
      if (!tool) {
        return buildError(payload.id, -32602, `Unknown tool "${params.name}".`)
      }

      assertActionAllowed({
        role: governance.role,
        allowedActionTypes: governance.allowedActionTypes,
        actionType: tool.actionType,
      })

      const executionDecision = resolveExecutionDecision({
        requestedMode: params.requireApproval ? 'ask' : 'auto',
        proposals: [
          {
            type: tool.actionType,
            confidenceScore:
              typeof params.arguments.confidenceScore === 'number'
                ? params.arguments.confidenceScore
                : assistantProfile.confidenceThreshold,
            parameters: params.arguments,
          },
        ],
        assistantProfile,
      })

      const action = await prisma.action.create({
        data: {
          type: tool.actionType,
          title: tool.title,
          description: tool.description,
          parameters: params.arguments as Prisma.JsonObject,
          status: 'pending',
          workspaceId,
          userId: dbUserId,
        },
      })

      if (executionDecision.effectiveMode === 'ask') {
        return buildSuccess(payload.id, {
          content: [
            {
              type: 'text',
              text: `Action queued for approval: ${tool.title}`,
            },
          ],
          actionId: action.id,
          governance: {
            workspaceRole: governance.role,
            riskLevel: inferRiskLevel(tool.actionType, params.arguments),
            deterministic: tool.deterministic,
            zeroDataMovement: tool.zeroDataMovement,
            executionReason: executionDecision.reason,
          },
        })
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
            userId: dbUserId,
          },
        ],
        trigger: 'api',
      })

      if (batchResult.failed || batchResult.completed.length === 0) {
        return buildError(payload.id, -32000, batchResult.failed?.error || 'Action execution requires manual review.')
      }

      const execution = batchResult.completed[0].execution

      return buildSuccess(payload.id, {
        content: [
          {
            type: 'text',
            text: execution.details,
          },
        ],
        actionId: action.id,
        structuredContent: execution.output,
        governance: {
          workspaceRole: governance.role,
          riskLevel: inferRiskLevel(tool.actionType, params.arguments),
          deterministic: tool.deterministic,
          zeroDataMovement: tool.zeroDataMovement,
          executionReason: executionDecision.reason,
        },
      })
    }

    return buildError(payload.id, -32601, `Method "${payload.method}" not found.`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown MCP error.'
    return buildError(null, -32000, message)
  }
}
