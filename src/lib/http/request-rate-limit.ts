import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

const inMemoryStore = new Map<string, { count: number; resetAt: number }>()

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown'
  }

  return request.headers.get('x-real-ip') || 'unknown'
}

function getWindowStart(now: Date, windowMs: number) {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs)
}

function shouldUseInMemoryStore() {
  return process.env.NODE_ENV === 'test'
}

export async function checkRequestRateLimit(params: {
  request: Request
  namespace: string
  workspaceId: string
  userId: string
  limit: number
  windowMs: number
}) {
  const now = new Date()
  const clientKey = getClientIp(params.request)
  const windowStart = getWindowStart(now, params.windowMs)
  const resetAt = windowStart.getTime() + params.windowMs
  const expiresAt = new Date(resetAt)

  if (shouldUseInMemoryStore()) {
    const key = `${params.namespace}:${params.workspaceId}:${params.userId}:${clientKey}`
    const existing = inMemoryStore.get(key)

    if (!existing || existing.resetAt <= now.getTime()) {
      inMemoryStore.set(key, { count: 1, resetAt })
      return {
        allowed: true,
        remaining: Math.max(0, params.limit - 1),
        resetAt,
      }
    }

    if (existing.count >= params.limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: existing.resetAt,
      }
    }

    existing.count += 1
    return {
      allowed: true,
      remaining: Math.max(0, params.limit - existing.count),
      resetAt: existing.resetAt,
    }
  }

  await prisma.rateLimitBucket.deleteMany({
    where: {
      namespace: params.namespace,
      workspaceId: params.workspaceId,
      userId: params.userId,
      expiresAt: {
        lte: now,
      },
    },
  })

  try {
    await prisma.rateLimitBucket.create({
      data: {
        namespace: params.namespace,
        workspaceId: params.workspaceId,
        userId: params.userId,
        clientKey,
        windowStart,
        limit: params.limit,
        count: 1,
        expiresAt,
      },
    })

    return {
      allowed: true,
      remaining: Math.max(0, params.limit - 1),
      resetAt,
    }
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error
    }
  }

  const updated = await prisma.rateLimitBucket.updateMany({
    where: {
      namespace: params.namespace,
      workspaceId: params.workspaceId,
      userId: params.userId,
      clientKey,
      windowStart,
      count: {
        lt: params.limit,
      },
    },
    data: {
      count: {
        increment: 1,
      },
      expiresAt,
    },
  })

  const current = await prisma.rateLimitBucket.findUnique({
    where: {
      namespace_workspaceId_userId_clientKey_windowStart: {
        namespace: params.namespace,
        workspaceId: params.workspaceId,
        userId: params.userId,
        clientKey,
        windowStart,
      },
    },
    select: {
      count: true,
    },
  })

  const count = current?.count ?? params.limit
  return {
    allowed: updated.count > 0,
    remaining: Math.max(0, params.limit - count),
    resetAt,
  }
}

export function getRetryAfterSeconds(resetAt: number, now = Date.now()) {
  return Math.max(1, Math.ceil((resetAt - now) / 1000))
}

export function buildRateLimitHeaders(rateLimit: {
  remaining: number
  resetAt: number
}) {
  return {
    'Retry-After': String(getRetryAfterSeconds(rateLimit.resetAt)),
    'X-RateLimit-Remaining': String(Math.max(0, rateLimit.remaining)),
    'X-RateLimit-Reset': String(rateLimit.resetAt),
  }
}
