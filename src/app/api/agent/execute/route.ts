import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAppContext } from '@/lib/app-context'
import { executeAgentToolRequest } from '@/lib/agent/tool-execution'
import { getWorkspaceGovernance } from '@/lib/agent/governance'
import { buildAgentManifest } from '@/lib/agent/manifest'
import { listMcpTools } from '@/lib/mcp/registry'
import { getErrorStatus } from '@/lib/http/errors'

const executeRequestSchema = z.object({
  actionType: z.enum([
    'send_email',
    'create_calendar_event',
    'create_google_doc',
    'update_google_doc',
    'create_google_drive_file',
    'create_notion_page',
    'update_notion_page',
  ]),
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
    const result = await executeAgentToolRequest({
      actionType: body.actionType,
      parameters: body.parameters,
      requireApproval: body.requireApproval,
      context: {
        workspaceId,
        userId: dbUserId,
      },
      trigger: 'api',
    })

    if (result.mode === 'pending_review') {
      return NextResponse.json({
        action: result.action,
        mode: 'pending_review',
        governance: result.governance,
      })
    }

    return NextResponse.json({
      action: result.action,
      execution: result.execution,
      governance: result.governance,
    })
  } catch (error) {
    const { status, message } = getErrorStatus(error)
    return NextResponse.json({ error: message }, { status })
  }
}
