import { NextResponse } from 'next/server'
import { getDashboardBundle } from '@/lib/dashboard/server'
import { getErrorStatus } from '@/lib/http/errors'

export async function GET() {
  try {
    const data = await getDashboardBundle()
    return NextResponse.json(data)
  } catch (error) {
    const { status, message } = getErrorStatus(error)
    return NextResponse.json({ error: message }, { status })
  }
}
