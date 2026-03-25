import { NextResponse } from 'next/server'
import { getAppContext } from '@/lib/app-context'
import { getErrorStatus } from '@/lib/http/errors'
import { checkRequestRateLimit } from '@/lib/http/request-rate-limit'
import { handleMcpRequest } from '@/lib/mcp/service'

export async function POST(request: Request) {
  try {
    const payload = await request.json()
    const { dbUserId, workspaceId } = await getAppContext()
    const rateLimit = checkRequestRateLimit({
      request,
      namespace: 'mcp',
      userId: dbUserId,
      limit: 60,
      windowMs: 60_000,
    })

    if (!rateLimit.allowed) {
      return NextResponse.json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32001,
          message: 'Rate limit exceeded.',
        },
      }, { status: 429 })
    }

    const response = await handleMcpRequest({
      payload,
      context: {
        workspaceId,
        userId: dbUserId,
      },
    })

    return NextResponse.json(response)
  } catch (error) {
    const { status, message } = getErrorStatus(error)
    return NextResponse.json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32000,
        message,
      },
    }, { status })
  }
}
