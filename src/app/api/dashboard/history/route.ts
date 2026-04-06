import { NextResponse } from 'next/server'
import { getHistoryPageData } from '@/lib/dashboard/server'
import { getErrorStatus } from '@/lib/http/errors'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q') || ''
    const data = await getHistoryPageData(query)
    return NextResponse.json({
      source: data.source,
      items: data.executionHistory,
      query: data.query || '',
    })
  } catch (error) {
    const { status, message } = getErrorStatus(error)
    return NextResponse.json({ error: message }, { status })
  }
}
