import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAppContext } from '@/lib/app-context'
import { getErrorStatus } from '@/lib/http/errors'
import { checkRequestRateLimit } from '@/lib/http/request-rate-limit'
import { getChatPageData, orchestrateChatTurn } from '@/lib/agent/orchestrator'
import { consumeQuota, refundQuota } from '@/lib/subscription'

const requestSchema = z.object({
  content: z.string().min(1).max(4000),
  executionMode: z.enum(['ask', 'auto']).default('ask'),
})

export async function GET() {
  try {
    const { dbUserId, workspaceId } = await getAppContext()
    const data = await getChatPageData({
      userId: dbUserId,
      workspaceId,
    })
    return NextResponse.json(data)
  } catch (error) {
    const { status, message } = getErrorStatus(error)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(request: Request) {
  let consumedQuotaForUserId: string | null = null
  try {
    const body = requestSchema.parse(await request.json())
    const { dbUserId, workspaceId } = await getAppContext()

    const rateLimit = checkRequestRateLimit({
      request,
      namespace: 'chat',
      userId: dbUserId,
      limit: 20,
      windowMs: 60_000,
    })

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: 'rate_limit_exceeded',
          message: 'Trop de requêtes en peu de temps. Réessaie dans une minute.',
          rateLimit,
        },
        { status: 429 }
      )
    }

    const quota = await consumeQuota(dbUserId)
    if (!quota.allowed) {
      return NextResponse.json(
        {
          error: 'quota_exceeded',
          message: `Limite mensuelle atteinte (${quota.used}/${quota.limit} requêtes).`,
          quota,
        },
        { status: 429 }
      )
    }
    consumedQuotaForUserId = dbUserId

    const result = await orchestrateChatTurn({
      content: body.content,
      executionMode: body.executionMode,
      context: {
        userId: dbUserId,
        workspaceId,
      },
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }
    const { status, message } = getErrorStatus(error)

    if (consumedQuotaForUserId && status >= 500) {
      await refundQuota(consumedQuotaForUserId)
    }

    return NextResponse.json({ error: message }, { status })
  }
}
