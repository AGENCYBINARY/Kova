import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAppContext } from '@/lib/app-context'
import { getErrorStatus } from '@/lib/http/errors'
import { getChatPageData, orchestrateChatTurn } from '@/lib/agent/orchestrator'

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
  try {
    const body = requestSchema.parse(await request.json())
    const { dbUserId, workspaceId } = await getAppContext()

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
    return NextResponse.json({ error: message }, { status })
  }
}
