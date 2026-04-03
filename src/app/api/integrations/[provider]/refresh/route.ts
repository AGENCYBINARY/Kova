import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getAppContext } from '@/lib/app-context'
import { getGoogleIntegrationCapabilityState, getValidGoogleAccessToken } from '@/lib/integrations/google-auth'
import {
  createGooglePhotosPickerSession,
  deleteGooglePhotosPickerSession,
  listGoogleCalendarEvents,
  listRecentGoogleDocs,
  listTodayGmailMessages,
  searchGoogleDriveFiles,
  withGooglePhotosPickerSessionMetadata,
} from '@/lib/integrations/google'
import { getValidNotionAccessToken, probeNotionAccess } from '@/lib/integrations/notion'

const GOOGLE_TYPES = ['gmail', 'calendar', 'google_docs', 'google_drive', 'google_photos'] as const

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return {}
}

function withProviderHealthMetadata(
  metadata: unknown,
  params: {
    providerError?: string | null
    healthCheckAt: string
    extra?: Record<string, unknown>
  }
) {
  return {
    ...asRecord(metadata),
    ...(params.extra || {}),
    providerError: params.providerError ?? null,
    healthCheckAt: params.healthCheckAt,
  }
}

async function probeGoogleIntegration(record: {
  id: string
  type: (typeof GOOGLE_TYPES)[number]
  metadata: unknown
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
}) {
  const accessToken = await getValidGoogleAccessToken(record)
  const now = new Date()
  const healthCheckAt = now.toISOString()

  switch (record.type) {
    case 'gmail': {
      await listTodayGmailMessages(accessToken, { maxResults: 1 })
      return {
        status: 'connected' as const,
        lastSyncAt: now,
        metadata: withProviderHealthMetadata(record.metadata, { healthCheckAt }),
      }
    }
    case 'calendar': {
      const later = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      await listGoogleCalendarEvents(accessToken, {
        timeMin: now.toISOString(),
        timeMax: later.toISOString(),
        maxResults: 1,
      })
      return {
        status: 'connected' as const,
        lastSyncAt: now,
        metadata: withProviderHealthMetadata(record.metadata, { healthCheckAt }),
      }
    }
    case 'google_docs': {
      await listRecentGoogleDocs(accessToken, { maxResults: 1 })
      return {
        status: 'connected' as const,
        lastSyncAt: now,
        metadata: withProviderHealthMetadata(record.metadata, { healthCheckAt }),
      }
    }
    case 'google_drive': {
      await searchGoogleDriveFiles(accessToken, { maxResults: 1 })
      return {
        status: 'connected' as const,
        lastSyncAt: now,
        metadata: withProviderHealthMetadata(record.metadata, { healthCheckAt }),
      }
    }
    case 'google_photos': {
      const session = await createGooglePhotosPickerSession(accessToken)
      await deleteGooglePhotosPickerSession(accessToken, session.sessionId)
      return {
        status: 'connected' as const,
        lastSyncAt: now,
        metadata: withGooglePhotosPickerSessionMetadata(
          withProviderHealthMetadata(record.metadata, { healthCheckAt }),
          session
        ),
      }
    }
  }
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

    const failures: Array<{ provider: string; error: string }> = []
    for (const googleIntegration of googleIntegrations) {
      const now = new Date()
      const capabilityState = getGoogleIntegrationCapabilityState(
        googleIntegration.type as typeof GOOGLE_TYPES[number],
        googleIntegration.metadata
      )

      if (capabilityState.needsReconnect) {
        const error = `Reconnect Google pour autoriser ${googleIntegration.type}.`
        failures.push({ provider: googleIntegration.type, error })
        await prisma.integration.update({
          where: { id: googleIntegration.id },
          data: {
            lastSyncAt: now,
            status: 'error',
            metadata: withProviderHealthMetadata(googleIntegration.metadata, {
              providerError: error,
              healthCheckAt: now.toISOString(),
            }),
          },
        })
        continue
      }

      try {
        const probeResult = await probeGoogleIntegration({
          ...googleIntegration,
          type: googleIntegration.type as typeof GOOGLE_TYPES[number],
        })
        await prisma.integration.update({
          where: { id: googleIntegration.id },
          data: {
            lastSyncAt: probeResult.lastSyncAt,
            status: probeResult.status,
            metadata: probeResult.metadata,
          },
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : `${googleIntegration.type} refresh failed.`
        failures.push({ provider: googleIntegration.type, error: message })

        await prisma.integration.update({
          where: { id: googleIntegration.id },
          data: {
            lastSyncAt: now,
            status: 'error',
            metadata: withProviderHealthMetadata(googleIntegration.metadata, {
              providerError: message,
              healthCheckAt: now.toISOString(),
            }),
          },
        })
      }
    }

    if (failures.length > 0) {
      return NextResponse.json({ error: 'Google integration refresh failed.', failures }, { status: 424 })
    }
  } else if (params.provider === 'notion') {
    const now = new Date()
    const accessToken = getValidNotionAccessToken(integration)
    try {
      await probeNotionAccess(accessToken)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Notion refresh failed.'
      await prisma.integration.update({
        where: { id: integration.id },
        data: {
          lastSyncAt: now,
          status: 'error',
          metadata: withProviderHealthMetadata(integration.metadata, {
            providerError: message,
            healthCheckAt: now.toISOString(),
          }),
        },
      })
      return NextResponse.json({ error: message }, { status: 424 })
    }

    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        lastSyncAt: now,
        status: 'connected',
        metadata: withProviderHealthMetadata(integration.metadata, {
          healthCheckAt: now.toISOString(),
        }),
      },
    })
  }

  return NextResponse.json({ ok: true })
}
