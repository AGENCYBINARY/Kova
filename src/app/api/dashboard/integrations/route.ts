import { NextResponse } from 'next/server'
import { getIntegrationsPageData } from '@/lib/dashboard/server'
import { getErrorStatus } from '@/lib/http/errors'

export async function GET() {
  try {
    const data = await getIntegrationsPageData()
    return NextResponse.json({
      source: data.source,
      items: data.integrations,
    })
  } catch (error) {
    const { status, message } = getErrorStatus(error)
    return NextResponse.json({ error: message }, { status })
  }
}
