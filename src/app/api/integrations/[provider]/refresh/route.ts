import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getAppContext } from '@/lib/app-context'
import { getGoogleIntegrationCapabilityState, getValidGoogleAccessToken } from '@/lib/integrations/google-auth'
import { listGooglePhotosMedia } from '@/lib/integrations/google'
import { getValidNotionAccessToken } from '@/lib/integrations/notion'

const GOOGLE_TYPES = ['gmail', 'calendar', 'google_docs', 'google_drive', 'google_photos'] as const

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return {}
}

export async function POST(
  _request: Request,
  { params }: { params: { provider: string } }
) {
  const { dbUserId, workspaceId } = await getAppContext()
  const type = params.provider === 'google' ? 'gmail' : params.provider
  const integration = await prisma.integration.findUnique({
    where: {
      workspaceId_userId_type: {
        workspaceId,
        userId: dbUserId,
        type,
      },
    },
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
          in: [...GOOGLE_TYPES],
        },
      },
      select: {
        id: true,
        type: true,
        metadata: true,
        accessToken: true,
        refreshToken: true,
        expiresAt: true,
      },
    })

    const now = new Date()
    const groupedStatuses = googleIntegrations.reduce(
      (groups, record) => {
        const capabilityState = getGoogleIntegrationCapabilityState(
          record.type as typeof GOOGLE_TYPES[number],
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

    const googlePhotosIntegration = googleIntegrations.find((item) => item.type === 'google_photos')
    const googlePhotosCapabilityState =
      googlePhotosIntegration
        ? getGoogleIntegrationCapabilityState('google_photos', googlePhotosIntegration.metadata)
        : null

    if (googlePhotosIntegration && !googlePhotosCapabilityState?.needsReconnect) {
      try {
        const accessToken = await getValidGoogleAccessToken(googlePhotosIntegration)
        await listGooglePhotosMedia(accessToken, { maxResults: 1 })

        await prisma.integration.update({
          where: { id: googlePhotosIntegration.id },
          data: {
            lastSyncAt: now,
            status: 'connected',
            metadata: {
              ...asRecord(googlePhotosIntegration.metadata),
              providerError: null,
              healthCheckAt: now.toISOString(),
            },
          },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Google Photos refresh failed.'

        await prisma.integration.update({
          where: { id: googlePhotosIntegration.id },
          data: {
            lastSyncAt: now,
            status: 'error',
            metadata: {
              ...asRecord(googlePhotosIntegration.metadata),
              providerError: message,
              healthCheckAt: now.toISOString(),
            },
          },
        })

        return NextResponse.json({ error: message }, { status: 424 })
      }
    }
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
