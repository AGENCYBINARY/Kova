import { NextResponse } from 'next/server'
import { getSidebarBundle } from '@/lib/dashboard/server'
import { getErrorStatus } from '@/lib/http/errors'

export async function GET() {
  try {
    const data = await getSidebarBundle()
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
      },
    })
  } catch (error) {
    const { status, message } = getErrorStatus(error)
    return NextResponse.json({ error: message }, { status })
  }
}
