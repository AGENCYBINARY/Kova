import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAppContext } from '@/lib/app-context'
import { agentActionTypeSchema } from '@/lib/agent/v1'
import { executeAgentToolRequest } from '@/lib/agent/tool-execution'
import { getWorkspaceGovernance } from '@/lib/agent/governance'
import { buildAgentManifest } from '@/lib/agent/manifest'
import { executeIdempotentJsonRequest, buildIdempotencyFingerprint } from '@/lib/http/idempotency'
import { buildRateLimitHeaders, checkRequestRateLimit } from '@/lib/http/request-rate-limit'
import { listMcpTools } from '@/lib/mcp/registry'
import { getErrorStatus } from '@/lib/http/errors'

const executeRequestSchema = z.object({
  actionType: agentActionTypeSchema,
  parameters: z.record(z.unknown()),
  requireApproval: z.boolean().default(false),
})

export async function GET() {
  const { dbUserId, workspaceId } = await getAppContext()
  const governance = await getWorkspaceGovernance({
    workspaceId,
    userId: dbUserId,
  })

  return NextResponse.json({
    platform: buildAgentManifest(governance.allowedActionTypes),
    workspaceRole: governance.role,
    tools: listMcpTools().filter((tool) => governance.allowedActionTypes.includes(tool.actionType)),
  })
}

export async function POST(request: Request) {
  try {
    const body = executeRequestSchema.parse(await request.json())
    const { dbUserId, workspaceId } = await getAppContext()

    return await executeIdempotentJsonRequest({
      request,
      namespace: 'agent-execute',
      userId: dbUserId,
      fingerprint: buildIdempotencyFingerprint(body),
      execute: async () => {
        const rateLimit = checkRequestRateLimit({
          request,
          namespace: 'agent-execute',
          userId: dbUserId,
          limit: 30,
          windowMs: 60_000,
        })

        if (!rateLimit.allowed) {
          return {
            body: {
              error: 'rate_limit_exceeded',
              message: 'Trop de requêtes agent en peu de temps. Réessaie dans une minute.',
              rateLimit,
            },
            status: 429,
            headers: buildRateLimitHeaders(rateLimit),
          }
        }

        const result = await executeAgentToolRequest({
          actionType: body.actionType,
          parameters: body.parameters,
          requireApproval: body.requireApproval,
          context: {
            workspaceId,
            userId: dbUserId,
          },
          trigger: 'api',
          source: 'api',
        })

        if (result.mode === 'pending_review') {
          return {
            body: {
              action: result.action,
              mode: 'pending_review',
              governance: result.governance,
            },
            status: 200,
          }
        }

        return {
          body: {
            action: result.action,
            execution: result.execution,
            governance: result.governance,
          },
          status: 200,
        }
      },
    })
  } catch (error) {
    const { status, message } = getErrorStatus(error)
    return NextResponse.json({ error: message }, { status })
  }
}
