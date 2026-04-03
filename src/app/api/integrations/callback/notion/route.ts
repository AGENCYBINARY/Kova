import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getAppContext } from '@/lib/app-context'
import { exchangeNotionCodeForTokens, persistNotionTokens } from '@/lib/integrations/notion'

function buildErrorRedirect(errorCode: string) {
  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/integrations?error=${errorCode}`)
}

function classifyNotionOAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (/credentials are missing/i.test(message)) return 'notion_oauth_config'
  if (/token exchange failed/i.test(message)) return 'notion_oauth_exchange'
  if (/app context/i.test(message)) return 'notion_oauth_context'
  if (/notion/i.test(message)) return 'notion_oauth_failed'
  return 'notion_oauth_persist'
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const cookieStore = cookies()
  const expectedState = cookieStore.get('oauth_state_notion')?.value

  if (!code || !state || !expectedState || state !== expectedState) {
    const response = buildErrorRedirect('notion_oauth_state')
    response.cookies.delete('oauth_state_notion')
    return response
  }

  try {
    const { dbUserId, workspaceId } = await getAppContext()
    const tokens = await exchangeNotionCodeForTokens(code)
    const connectedAccount = tokens.owner?.user?.person?.email || null

    await persistNotionTokens({
      userId: dbUserId,
      workspaceId,
      accessToken: tokens.access_token,
      connectedAccount,
      workspaceName: tokens.workspace_name || null,
    })

    const response = NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/integrations?connected=notion`)
    response.cookies.delete('oauth_state_notion')
    return response
  } catch (error) {
    const response = buildErrorRedirect(classifyNotionOAuthError(error))
    response.cookies.delete('oauth_state_notion')
    return response
  }
}
