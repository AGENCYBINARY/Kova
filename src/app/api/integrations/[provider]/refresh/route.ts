import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getAppContext } from '@/lib/app-context'
import { getGoogleIntegrationCapabilityState, getValidGoogleAccessToken } from '@/lib/integrations/google'
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
    orderBy: [{ updatedAt: 'desc' }],
  })

  if (!integration) {
    return NextResponse.json({ error: 'Integration not found.' }, { status: 404 })
  }

  if (params.provider === 'google') {
    await getValidGoogleAccessToken(integration)

    const googleIntegrations = await prisma.integration.findMany({
      where: {
        userId: dbUserId,
        workspaceId,
        type: {
          in: ['gmail', 'calendar', 'google_docs', 'google_drive'],
        },
      },
      select: {
        id: true,
        type: true,
        metadata: true,
      },
    })

    await Promise.all(
      googleIntegrations.map((record) => {
        const capabilityState = getGoogleIntegrationCapabilityState(
          record.type as 'gmail' | 'calendar' | 'google_docs' | 'google_drive',
          record.metadata
        )

        return prisma.integration.update({
          where: { id: record.id },
          data: {
            lastSyncAt: new Date(),
            status: capabilityState.needsReconnect ? 'error' : 'connected',
          },
        })
      })
    )
  } else if (params.provider === 'notion') {
    getValidNotionAccessToken(integration)
    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        lastSyncAt: new Date(),
        status: 'connected',
      },
    })
  }

  return NextResponse.json({ ok: true })
}
