import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { getAppContext } from '@/lib/app-context'
import { buildGoogleOAuthUrl } from '@/lib/integrations/google'
import { buildNotionOAuthUrl } from '@/lib/integrations/notion'

export async function GET(
  _request: Request,
  { params }: { params: { provider: string } }
) {
  await getAppContext()

  const state = crypto.randomUUID()
  let redirectUrl: string

  if (params.provider === 'google') {
    redirectUrl = buildGoogleOAuthUrl(state)
  } else if (params.provider === 'notion') {
    redirectUrl = buildNotionOAuthUrl(state)
  } else {
    return NextResponse.json({ error: 'Unsupported provider.' }, { status: 400 })
  }

  const response = NextResponse.redirect(redirectUrl)
  response.cookies.set(`oauth_state_${params.provider}`, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 10,
  })

  return response
}
