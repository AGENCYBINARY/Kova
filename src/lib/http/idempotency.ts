import { NextResponse } from 'next/server'

interface CachedJsonResult {
  status: number
  body: unknown
  headers: Record<string, string>
}

interface IdempotencyEntry {
  fingerprint: string
  state: 'pending' | 'completed'
  expiresAt: number
  result?: CachedJsonResult
}

const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000
const store = new Map<string, IdempotencyEntry>()

const cleanupInterval = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of Array.from(store.entries())) {
    if (entry.expiresAt <= now) {
      store.delete(key)
    }
  }
}, 5 * 60 * 1000)

cleanupInterval.unref?.()

function toStoreKey(namespace: string, userId: string, key: string) {
  return `${namespace}:${userId}:${key}`
}

function normalizeHeaders(headers?: Record<string, string>) {
  return headers ? { ...headers } : {}
}

export function buildIdempotencyFingerprint(value: unknown) {
  return JSON.stringify(value)
}

export function clearIdempotencyStore() {
  store.clear()
}

export async function executeIdempotentJsonRequest(params: {
  request: Request
  namespace: string
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

  const now = Date.now()
  const ttlMs = params.ttlMs ?? IDEMPOTENCY_TTL_MS
  const key = toStoreKey(params.namespace, params.userId, idempotencyKey)
  const existing = store.get(key)

  if (existing && existing.expiresAt > now) {
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

  store.set(key, {
    fingerprint: params.fingerprint,
    state: 'pending',
    expiresAt: now + ttlMs,
  })

  try {
    const result = await params.execute()
    store.set(key, {
      fingerprint: params.fingerprint,
      state: 'completed',
      expiresAt: now + ttlMs,
      result: {
        status: result.status ?? 200,
        body: result.body,
        headers: normalizeHeaders(result.headers),
      },
    })

    return NextResponse.json(result.body, {
      status: result.status ?? 200,
      headers: result.headers,
    })
  } catch (error) {
    store.delete(key)
    throw error
  }
}
