import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { getAppContext } from '@/lib/app-context'
import { asActionParameters } from '@/lib/actions/parameter-resolution'
import { createAuditLog } from '@/lib/audit/service'
import { expirePendingActions } from '@/lib/actions/pending-expiration'
import { getErrorStatus } from '@/lib/http/errors'
import { buildIdempotencyFingerprint, executeIdempotentJsonRequest } from '@/lib/http/idempotency'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { dbUserId, workspaceId } = await getAppContext()
    await expirePendingActions({
      userId: dbUserId,
      workspaceId,
    })

    return await executeIdempotentJsonRequest({
      request,
      namespace: 'action-reject',
      workspaceId,
      userId: dbUserId,
      fingerprint: buildIdempotencyFingerprint({ actionId: params.id }),
      execute: async () => {
        const action = await prisma.action.findFirst({
          where: {
            id: params.id,
            userId: dbUserId,
            workspaceId,
          },
        })

        if (!action) {
          return {
            body: { error: 'Action not found.' },
            status: 404,
          }
        }

        if (action.status === 'expired') {
          return {
            body: { error: 'Action expired.' },
            status: 409,
          }
        }

        if (action.status !== 'pending') {
          return {
            body: { error: 'Action is no longer pending.' },
            status: 409,
          }
        }

        const actionParameters = asActionParameters(action.parameters)
        const requestGroupId =
          typeof actionParameters.requestGroupId === 'string' ? actionParameters.requestGroupId : null

        const groupedActions = requestGroupId
          ? await prisma.action.findMany({
              where: {
                status: 'pending',
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

        const actionsToReject = groupedActions.length > 0 ? groupedActions : [action]

        await prisma.action.updateMany({
          where: {
            id: { in: actionsToReject.map((item) => item.id) },
          },
          data: {
            status: 'rejected',
            executedAt: new Date(),
            result: {
              details: 'Rejected by user before execution.',
            } as Prisma.JsonObject,
          },
        })

        await Promise.all(
          actionsToReject.map((item) =>
            createAuditLog({
              actionType: item.type,
              status: 'rejected',
              actionId: item.id,
              workspaceId,
              userId: dbUserId,
              error: 'User rejected action',
              executionTrigger: 'review',
              details: {
                reason: 'Rejected before execution',
                actionCount: actionsToReject.length,
              },
            })
          )
        )

        const assistantMessage = await prisma.message.create({
          data: {
            content:
              actionsToReject.length > 1
                ? `Rejected ${actionsToReject.length} linked actions. No external action was executed.`
                : `Rejected: "${action.title}". No external action was executed.`,
            role: 'assistant',
            metadata: {
              actionId: action.id,
              actionStatus: 'rejected',
              actionCount: actionsToReject.length,
            },
            workspaceId,
            userId: dbUserId,
          },
        })

        return {
          body: {
            actions: actionsToReject,
            assistantMessage,
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
