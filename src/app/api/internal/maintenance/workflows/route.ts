import { NextResponse } from 'next/server'
import { resumeDueActionPlans } from '@/lib/actions/workflow-resume'

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

  const result = await resumeDueActionPlans({
    limit: 25,
  })

  return NextResponse.json({
    ok: true,
    ...result,
  })
}
