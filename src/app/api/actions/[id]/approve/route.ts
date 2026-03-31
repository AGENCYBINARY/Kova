import { NextResponse } from 'next/server'
import { getAppContext } from '@/lib/app-context'
import { approvePendingActionById } from '@/lib/actions/approve-pending'
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
      namespace: 'action-approve',
      workspaceId,
      userId: dbUserId,
      fingerprint: buildIdempotencyFingerprint({ actionId: params.id }),
      execute: async () => {
        const result = await approvePendingActionById({
          actionId: params.id,
          workspaceId,
          userId: dbUserId,
        })

        return {
          body: result,
          status: 200,
        }
      },
    })
  } catch (error) {
    const { status, message } = getErrorStatus(error)
    return NextResponse.json({ error: message }, { status })
  }
}
