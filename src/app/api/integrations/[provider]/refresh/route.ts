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

    const now = new Date()
    const groupedStatuses = googleIntegrations.reduce(
      (groups, record) => {
        const capabilityState = getGoogleIntegrationCapabilityState(
          record.type as 'gmail' | 'calendar' | 'google_docs' | 'google_drive',
          record.metadata
        )

        groups[capabilityState.needsReconnect ? 'error' : 'connected'].push(record.id)
        return groups
      },
      { connected: [] as string[], error: [] as string[] }
    )

    await Promise.all([
      groupedStatuses.connected.length > 0
        ? prisma.integration.updateMany({
            where: { id: { in: groupedStatuses.connected } },
            data: {
              lastSyncAt: now,
              status: 'connected',
            },
          })
        : Promise.resolve(),
      groupedStatuses.error.length > 0
        ? prisma.integration.updateMany({
            where: { id: { in: groupedStatuses.error } },
            data: {
              lastSyncAt: now,
              status: 'error',
            },
          })
        : Promise.resolve(),
    ])
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
