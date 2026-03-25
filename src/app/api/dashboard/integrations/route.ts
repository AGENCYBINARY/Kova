import { NextResponse } from 'next/server'
import { getIntegrationsPageData } from '@/lib/dashboard/server'

export async function GET() {
  const data = await getIntegrationsPageData()
  return NextResponse.json({
    source: data.source,
    items: data.integrations,
  })
}
