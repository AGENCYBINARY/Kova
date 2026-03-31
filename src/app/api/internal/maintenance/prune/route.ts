import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { pruneExecutionLogs } from '@/lib/audit/retention'

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return false
  }

  const authorization = request.headers.get('authorization')?.trim()
  return authorization === `Bearer ${secret}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const [logResult, idempotencyResult, rateLimitResult] = await Promise.all([
    pruneExecutionLogs(now),
    prisma.idempotencyKey.deleteMany({
      where: {
        expiresAt: {
          lte: now,
        },
      },
    }),
    prisma.rateLimitBucket.deleteMany({
      where: {
        expiresAt: {
          lte: now,
        },
      },
    }),
  ])

  return NextResponse.json({
    ok: true,
    executionLogsDeleted: logResult.deletedCount,
    idempotencyKeysDeleted: idempotencyResult.count,
    rateLimitBucketsDeleted: rateLimitResult.count,
    retentionDays: logResult.retentionDays,
  })
}
