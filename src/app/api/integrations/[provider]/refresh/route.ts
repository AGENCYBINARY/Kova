import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getAppContext } from '@/lib/app-context'
import { getValidGoogleAccessToken } from '@/lib/integrations/google'
import { getValidNotionAccessToken } from '@/lib/integrations/notion'

export async function POST(
  _request: Request,
  { params }: { params: { provider: string } }
) {
  const { dbUserId, workspaceId } = await getAppContext()
  const type = params.provider === 'google' ? 'gmail' : params.provider
  const integration = await prisma.integration.findFirst({
    where: {
      type,
      userId: dbUserId,
      workspaceId,
    },
  })

  if (!integration) {
    return NextResponse.json({ error: 'Integration not found.' }, { status: 404 })
  }

  if (params.provider === 'google') {
    await getValidGoogleAccessToken(integration)
  } else if (params.provider === 'notion') {
    getValidNotionAccessToken(integration)
  }

  await prisma.integration.updateMany({
    where: {
      userId: dbUserId,
      workspaceId,
      type: params.provider === 'google' ? { in: ['gmail', 'calendar', 'google_docs'] } : type,
    } as never,
    data: {
      lastSyncAt: new Date(),
      status: 'connected',
    },
  })

  return NextResponse.json({ ok: true })
}
