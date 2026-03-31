import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

interface CachedJsonResult {
  status: number
  body: unknown
  headers: Record<string, string>
}

const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000
const inMemoryStore = new Map<string, {
  fingerprint: string
  state: 'pending' | 'completed'
  expiresAt: number
  result?: CachedJsonResult
}>()

function shouldUseInMemoryStore() {
  return process.env.NODE_ENV === 'test'
}

function normalizeHeaders(headers?: Record<string, string>) {
  return headers ? { ...headers } : {}
}

function toExpirationDate(ttlMs: number, now = new Date()) {
  return new Date(now.getTime() + ttlMs)
}

function toMemoryKey(namespace: string, workspaceId: string, userId: string, key: string) {
  return `${namespace}:${workspaceId}:${userId}:${key}`
}

export function buildIdempotencyFingerprint(value: unknown) {
  return JSON.stringify(value)
}

export async function clearIdempotencyStore() {
  if (shouldUseInMemoryStore()) {
    inMemoryStore.clear()
    return
  }

  await prisma.idempotencyKey.deleteMany()
}

export async function executeIdempotentJsonRequest(params: {
  request: Request
  namespace: string
  workspaceId: string
  userId: string
  fingerprint: string
  ttlMs?: number
  execute: () => Promise<{
    body: unknown
    status?: number
    headers?: Record<string, string>
  }>
}) {
  const idempotencyKey = params.request.headers.get('Idempotency-Key')?.trim()
  if (!idempotencyKey) {
    const result = await params.execute()
    return NextResponse.json(result.body, {
      status: result.status ?? 200,
      headers: result.headers,
    })
  }

  const now = new Date()
  const ttlMs = params.ttlMs ?? IDEMPOTENCY_TTL_MS
  const expiresAt = toExpirationDate(ttlMs, now)

  if (shouldUseInMemoryStore()) {
    const memoryKey = toMemoryKey(params.namespace, params.workspaceId, params.userId, idempotencyKey)
    const existing = inMemoryStore.get(memoryKey)

    if (existing && existing.expiresAt > now.getTime()) {
      if (existing.fingerprint !== params.fingerprint) {
        return NextResponse.json(
          { error: 'Idempotency-Key already used with a different request.' },
          { status: 409 }
        )
      }

      if (existing.state === 'pending') {
        return NextResponse.json(
          { error: 'A request with this Idempotency-Key is already in progress.' },
          { status: 409, headers: { 'Retry-After': '1' } }
        )
      }

      return NextResponse.json(existing.result?.body ?? {}, {
        status: existing.result?.status ?? 200,
        headers: {
          ...normalizeHeaders(existing.result?.headers),
          'X-Idempotent-Replay': 'true',
        },
      })
    }

    inMemoryStore.set(memoryKey, {
      fingerprint: params.fingerprint,
      state: 'pending',
      expiresAt: expiresAt.getTime(),
    })

    try {
      const result = await params.execute()
      const status = result.status ?? 200
      const headers = normalizeHeaders(result.headers)

      if (status >= 200 && status < 300) {
        inMemoryStore.set(memoryKey, {
          fingerprint: params.fingerprint,
          state: 'completed',
          expiresAt: expiresAt.getTime(),
          result: {
            status,
            body: result.body,
            headers,
          },
        })
      } else {
        inMemoryStore.delete(memoryKey)
      }

      return NextResponse.json(result.body, {
        status,
        headers,
      })
    } catch (error) {
      inMemoryStore.delete(memoryKey)
      throw error
    }
  }

  await prisma.idempotencyKey.deleteMany({
    where: {
      namespace: params.namespace,
      workspaceId: params.workspaceId,
      userId: params.userId,
      key: idempotencyKey,
      expiresAt: {
        lte: now,
      },
    },
  })

  try {
    await prisma.idempotencyKey.create({
      data: {
        namespace: params.namespace,
        workspaceId: params.workspaceId,
        userId: params.userId,
        key: idempotencyKey,
        fingerprint: params.fingerprint,
        status: 'pending',
        expiresAt,
      },
    })
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error
    }

    const existing = await prisma.idempotencyKey.findUnique({
      where: {
        namespace_workspaceId_userId_key: {
          namespace: params.namespace,
          workspaceId: params.workspaceId,
          userId: params.userId,
          key: idempotencyKey,
        },
      },
    })

    if (!existing) {
      return executeIdempotentJsonRequest(params)
    }

    if (existing.expiresAt <= now) {
      await prisma.idempotencyKey.delete({
        where: {
          namespace_workspaceId_userId_key: {
            namespace: params.namespace,
            workspaceId: params.workspaceId,
            userId: params.userId,
            key: idempotencyKey,
          },
        },
      }).catch(() => null)

      return executeIdempotentJsonRequest(params)
    }

    if (existing.fingerprint !== params.fingerprint) {
      return NextResponse.json(
        { error: 'Idempotency-Key already used with a different request.' },
        { status: 409 }
      )
    }

    if (existing.status === 'pending') {
      return NextResponse.json(
        { error: 'A request with this Idempotency-Key is already in progress.' },
        { status: 409, headers: { 'Retry-After': '1' } }
      )
    }

    return NextResponse.json(existing.responseBody ?? {}, {
      status: existing.responseStatus ?? 200,
      headers: {
        ...normalizeHeaders(existing.responseHeaders as Record<string, string> | undefined),
        'X-Idempotent-Replay': 'true',
      },
    })
  }

  try {
    const result = await params.execute()
    const status = result.status ?? 200
    const headers = normalizeHeaders(result.headers)

    if (status >= 200 && status < 300) {
      await prisma.idempotencyKey.update({
        where: {
          namespace_workspaceId_userId_key: {
            namespace: params.namespace,
            workspaceId: params.workspaceId,
            userId: params.userId,
            key: idempotencyKey,
          },
        },
        data: {
          status: 'completed',
          responseStatus: status,
          responseBody: result.body as Prisma.InputJsonValue,
          responseHeaders: headers as Prisma.InputJsonValue,
          expiresAt,
        },
      })
    } else {
      await prisma.idempotencyKey.delete({
        where: {
          namespace_workspaceId_userId_key: {
            namespace: params.namespace,
            workspaceId: params.workspaceId,
            userId: params.userId,
            key: idempotencyKey,
          },
        },
      })
    }

    return NextResponse.json(result.body, {
      status,
      headers,
    })
  } catch (error) {
    await prisma.idempotencyKey.delete({
      where: {
        namespace_workspaceId_userId_key: {
          namespace: params.namespace,
          workspaceId: params.workspaceId,
          userId: params.userId,
          key: idempotencyKey,
        },
      },
    }).catch(() => null)

    throw error
  }
}
