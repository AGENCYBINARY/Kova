import { NextResponse } from 'next/server'
import { processDueScheduledSends } from '@/lib/actions/process-scheduled-sends'

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return false
  }

  const authorization = request.headers.get('authorization')?.trim()
  return authorization === `Bearer ${secret}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await processDueScheduledSends({ limit: 40 })

  return NextResponse.json({
    ok: true,
    ...result,
  })
}
