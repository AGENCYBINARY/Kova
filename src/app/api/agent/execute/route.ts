import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { getAppContext } from '@/lib/app-context'
import { getAssistantProfile } from '@/lib/assistant/store'
import { executePersistedActionBatch } from '@/lib/actions/execute-persisted-batch'
import type { DashboardAction } from '@/lib/dashboard-data'
import { assertActionAllowed, getWorkspaceGovernance } from '@/lib/agent/governance'
import { buildAgentManifest } from '@/lib/agent/manifest'
import { inferRiskLevel, resolveExecutionDecision } from '@/lib/agent/policy'
import { getToolByActionType, listMcpTools } from '@/lib/mcp/registry'
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
    const [governance, assistantProfile] = await Promise.all([
      getWorkspaceGovernance({
        workspaceId,
        userId: dbUserId,
      }),
      getAssistantProfile(workspaceId),
    ])
    const tool = getToolByActionType(body.actionType)

    if (!tool) {
      return NextResponse.json({ error: 'Tool not found.' }, { status: 404 })
    }

    assertActionAllowed({
      role: governance.role,
      allowedActionTypes: governance.allowedActionTypes,
      actionType: body.actionType,
    })

    const executionDecision = resolveExecutionDecision({
      requestedMode: body.requireApproval ? 'ask' : 'auto',
      proposals: [
        {
          type: body.actionType,
          confidenceScore:
            typeof body.parameters.confidenceScore === 'number' ? body.parameters.confidenceScore : assistantProfile.confidenceThreshold,
          parameters: body.parameters,
        },
      ],
      assistantProfile,
    })

    const action = await prisma.action.create({
      data: {
        type: body.actionType,
        title: tool.title,
        description: tool.description,
        parameters: body.parameters as Prisma.JsonObject,
        status: 'pending',
        workspaceId,
        userId: dbUserId,
      },
    })

    if (executionDecision.effectiveMode === 'ask') {
      return NextResponse.json({
        action,
        mode: 'pending_review',
        governance: {
          toolName: tool.name,
          workspaceRole: governance.role,
          riskLevel: inferRiskLevel(body.actionType as DashboardAction['type'], body.parameters),
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

    const completedAction = await prisma.action.findUnique({
      where: { id: action.id },
    })

    if (!completedAction || batchResult.failed || batchResult.completed.length === 0) {
      throw new Error(batchResult.failed?.error || 'Action execution requires manual review.')
    }

    const execution = batchResult.completed[0].execution

    return NextResponse.json({
      action: completedAction,
      execution,
      governance: {
        toolName: tool.name,
        toolVersion: tool.version,
        workspaceRole: governance.role,
        riskLevel: inferRiskLevel(body.actionType as DashboardAction['type'], body.parameters),
        deterministic: tool.deterministic,
        zeroDataMovement: tool.zeroDataMovement,
        executionReason: executionDecision.reason,
      },
    })
  } catch (error) {
    const { status, message } = getErrorStatus(error)
    return NextResponse.json({ error: message }, { status })
  }
}
