import { checkRateLimit } from '@/lib/utils/rate-limit'

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown'
  }

  return request.headers.get('x-real-ip') || 'unknown'
}

export function checkRequestRateLimit(params: {
  request: Request
  namespace: string
  userId: string
  limit: number
  windowMs: number
}) {
  const key = [params.namespace, params.userId, getClientIp(params.request)].join(':')
  return checkRateLimit(key, params.limit, params.windowMs)
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
