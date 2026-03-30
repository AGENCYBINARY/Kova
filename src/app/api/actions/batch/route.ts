import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAppContext } from '@/lib/app-context'
import { expirePendingActions } from '@/lib/actions/pending-expiration'
import {
  approvePendingActionBatch,
  loadPendingActionsForReview,
  rejectPendingActionBatch,
} from '@/lib/actions/review-batch'
import { buildIdempotencyFingerprint, executeIdempotentJsonRequest } from '@/lib/http/idempotency'
import { getErrorStatus } from '@/lib/http/errors'

const requestSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  actionIds: z.array(z.string().min(1)).max(100).optional(),
})

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json())
    const { dbUserId, workspaceId } = await getAppContext()

    await expirePendingActions({
      userId: dbUserId,
      workspaceId,
    })

    return await executeIdempotentJsonRequest({
      request,
      namespace: `actions-batch-${body.decision}`,
      userId: dbUserId,
      fingerprint: buildIdempotencyFingerprint(body),
      execute: async () => {
        const actions = await loadPendingActionsForReview({
          workspaceId,
          userId: dbUserId,
          actionIds: body.actionIds,
        })

        if (actions.length === 0) {
          return {
            body: {
              error: 'No pending actions to review.',
            },
            status: 404,
          }
        }

        if (body.decision === 'approve') {
          const result = await approvePendingActionBatch({
            workspaceId,
            userId: dbUserId,
            actions,
          })

          return {
            body: result,
            status: 200,
          }
        }

        const result = await rejectPendingActionBatch({
          workspaceId,
          userId: dbUserId,
          actions,
        })

        return {
          body: result,
          status: 200,
        }
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid batch review request.' }, { status: 400 })
    }

    const { status, message } = getErrorStatus(error)
    return NextResponse.json({ error: message }, { status })
  }
}
