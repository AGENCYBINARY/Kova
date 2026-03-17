import { NextResponse } from 'next/server'
import { getDashboardBundle } from '@/lib/dashboard/server'

export async function GET() {
  const data = await getDashboardBundle()
  return NextResponse.json(data)
}
