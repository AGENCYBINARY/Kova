import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getAppContext } from '@/lib/app-context'

const GOOGLE_TYPES = ['gmail', 'calendar', 'google_docs', 'google_drive', 'google_photos'] as const
const DISCONNECTABLE_TYPES = ['gmail', 'calendar', 'notion', 'google_docs', 'google_drive', 'google_photos', 'slack'] as const

function isDisconnectableType(value: unknown): value is (typeof DISCONNECTABLE_TYPES)[number] {
  return typeof value === 'string' && DISCONNECTABLE_TYPES.includes(value as (typeof DISCONNECTABLE_TYPES)[number])
}

export async function POST(
  request: Request,
  { params }: { params: { provider: string } }
) {
  const { dbUserId, workspaceId } = await getAppContext()
  const body = await request.json().catch(() => null) as { type?: unknown } | null
  const requestedType = isDisconnectableType(body?.type) ? body!.type : null

  const types =
    requestedType
      ? [requestedType]
      : params.provider === 'google'
        ? [...GOOGLE_TYPES]
        : params.provider === 'notion'
          ? ['notion']
          : [params.provider]

  await prisma.integration.updateMany({
    where: {
      type: { in: types },
      userId: dbUserId,
      workspaceId,
    },
    data: {
      accessToken: 'disconnected',
      refreshToken: null,
      expiresAt: null,
      status: 'disconnected',
      lastSyncAt: null,
      metadata: {
        connectedAccount: null,
        disconnectedAt: new Date().toISOString(),
      },
    },
  })

  return NextResponse.json({ ok: true })
}
