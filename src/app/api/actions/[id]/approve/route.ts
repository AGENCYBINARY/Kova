import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { getAppContext } from '@/lib/app-context'
import { asActionParameters, injectExecutionOutputsIntoParameters } from '@/lib/actions/parameter-resolution'
import { extractNameBeforeEmail, rememberContact } from '@/lib/contacts'
import { executePersistedAction } from '@/lib/integrations/execute'

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { dbUserId, workspaceId } = await getAppContext()
    const action = await prisma.action.findFirst({
      where: {
        id: params.id,
        userId: dbUserId,
        workspaceId,
      },
    })

    if (!action) {
      return NextResponse.json({ error: 'Action not found.' }, { status: 404 })
    }

    const actionParameters = asActionParameters(action.parameters)
    const requestGroupId =
      typeof actionParameters.requestGroupId === 'string' ? actionParameters.requestGroupId : null

    const groupedActions = requestGroupId
      ? await prisma.action.findMany({
          where: {
            userId: dbUserId,
            workspaceId,
            parameters: {
              path: ['requestGroupId'],
              equals: requestGroupId,
            },
          },
          orderBy: { createdAt: 'asc' },
        })
      : [action]

    const actionsToExecute = groupedActions.length > 0 ? groupedActions : [action]

    await prisma.action.updateMany({
      where: {
        id: { in: actionsToExecute.map((item) => item.id) },
      },
      data: { status: 'approved' },
    })
    const priorOutputs: Array<Record<string, unknown>> = []
    const completedActions = []

    for (const pendingAction of actionsToExecute) {
      const pendingParameters = asActionParameters(pendingAction.parameters)
      const confidenceScore =
        typeof pendingParameters.confidenceScore === 'number' ? pendingParameters.confidenceScore : 0.85
      const effectiveParameters = injectExecutionOutputsIntoParameters(pendingAction.parameters, priorOutputs)

      const execution = await executePersistedAction({
        action: {
          id: pendingAction.id,
          type: pendingAction.type as Parameters<typeof executePersistedAction>[0]['action']['type'],
          title: pendingAction.title,
          description: pendingAction.description,
          parameters: effectiveParameters as Prisma.JsonObject,
          workspaceId,
          userId: dbUserId,
        },
      })

      priorOutputs.push(execution.output)

      const completedAction = await prisma.action.update({
        where: { id: pendingAction.id },
        data: {
          status: 'completed',
          executedAt: new Date(),
          parameters: effectiveParameters as Prisma.JsonObject,
          result: {
            confidenceScore,
            details: execution.details,
            output: execution.output as Prisma.JsonObject,
          } as Prisma.JsonObject,
        },
      })

      await prisma.executionLog.create({
        data: {
          actionType: completedAction.type,
          status: 'success',
          details: execution.output as Prisma.JsonObject,
          actionId: completedAction.id,
          workspaceId,
          userId: dbUserId,
        },
      })

      if (completedAction.type === 'send_email') {
        const recipients =
          Array.isArray(effectiveParameters.to)
            ? effectiveParameters.to.filter((value): value is string => typeof value === 'string')
            : []

        for (const recipient of recipients) {
          if (!recipient.includes('@')) continue
          await rememberContact({
            userId: dbUserId,
            workspaceId,
            email: recipient,
            name:
              typeof effectiveParameters.resolvedContactName === 'string'
                ? effectiveParameters.resolvedContactName
                : extractNameBeforeEmail(completedAction.description, recipient),
          })
        }
      }

      completedActions.push({
        action: completedAction,
        details: execution.details,
      })
    }

    const assistantMessage = await prisma.message.create({
      data: {
        content:
          completedActions.length > 1
            ? `Approved and executed ${completedActions.length} actions successfully.`
            : `Approved and executed: "${completedActions[0].action.title}". ${completedActions[0].details}`,
        role: 'assistant',
        metadata: {
          actionId: action.id,
          actionStatus: 'completed',
          actionCount: completedActions.length,
        },
        workspaceId,
        userId: dbUserId,
      },
    })

    return NextResponse.json({
      actions: completedActions.map((item) => item.action),
      assistantMessage,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
