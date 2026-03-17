import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getAppContext } from '@/lib/app-context'
import { exchangeNotionCodeForTokens, persistNotionTokens } from '@/lib/integrations/notion'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const cookieStore = cookies()
  const expectedState = cookieStore.get('oauth_state_notion')?.value

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/integrations?error=notion_oauth_state`)
  }

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
}
