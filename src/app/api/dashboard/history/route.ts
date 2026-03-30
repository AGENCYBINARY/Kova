import { NextResponse } from 'next/server'
import { getHistoryPageData } from '@/lib/dashboard/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q') || ''
  const data = await getHistoryPageData(query)
  return NextResponse.json({
    source: data.source,
    items: data.executionHistory,
    query: data.query || '',
  })
}
