import { NextResponse } from 'next/server'
import { getActionsPageData } from '@/lib/dashboard/server'

export async function GET() {
  const data = await getActionsPageData()
  return NextResponse.json({
    source: data.source,
    items: data.pendingActions,
  })
}
