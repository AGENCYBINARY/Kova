import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getAppContext } from '@/lib/app-context'
import {
  exchangeGoogleCodeForTokens,
  fetchGoogleAccountEmail,
  persistGoogleTokens,
} from '@/lib/integrations/google-auth'

function buildErrorRedirect(errorCode: string) {
  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/integrations?error=${errorCode}`)
}

function classifyGoogleOAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (/credentials are missing/i.test(message)) return 'google_oauth_config'
  if (/token exchange failed/i.test(message)) return 'google_oauth_exchange'
  if (/userinfo fetch failed/i.test(message)) return 'google_oauth_account'
  return 'google_oauth_failed'
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const cookieStore = cookies()
  const expectedState = cookieStore.get('oauth_state_google')?.value

  if (!code || !state || !expectedState || state !== expectedState) {
    const response = buildErrorRedirect('google_oauth_state')
    response.cookies.delete('oauth_state_google')
    return response
  }

  try {
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
  } catch (error) {
    const response = buildErrorRedirect(classifyGoogleOAuthError(error))
    response.cookies.delete('oauth_state_google')
    return response
  }
}
