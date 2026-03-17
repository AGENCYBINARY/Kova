import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getAppContext } from '@/lib/app-context'

const GOOGLE_TYPES = ['gmail', 'calendar', 'google_docs']

export async function POST(
  _request: Request,
  { params }: { params: { provider: string } }
) {
  const { dbUserId, workspaceId } = await getAppContext()

  const types =
    params.provider === 'google'
      ? GOOGLE_TYPES
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
