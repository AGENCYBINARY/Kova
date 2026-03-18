import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getAppContext } from '@/lib/app-context'
import {
  exchangeGoogleCodeForTokens,
  fetchGoogleAccountEmail,
  persistGoogleTokens,
} from '@/lib/integrations/google'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const cookieStore = cookies()
  const expectedState = cookieStore.get('oauth_state_google')?.value

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/integrations?error=google_oauth_state`)
  }

  const { dbUserId, workspaceId } = await getAppContext()
  const tokens = await exchangeGoogleCodeForTokens(code)
  const connectedAccount = await fetchGoogleAccountEmail(tokens.access_token)

  await persistGoogleTokens({
    userId: dbUserId,
    workspaceId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    connectedAccount,
    grantedScopes: tokens.scope.split(/\s+/).filter(Boolean),
  })

  const response = NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/integrations?connected=google`)
  response.cookies.delete('oauth_state_google')
  return response
}
