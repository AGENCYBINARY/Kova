import { NextResponse } from 'next/server'
import { getHistoryPageData } from '@/lib/dashboard/server'

export async function GET() {
  const data = await getHistoryPageData()
  return NextResponse.json({
    source: data.source,
    items: data.executionHistory,
  })
}
