import { prisma } from '@/lib/db/prisma'
import { createAuditLog } from '@/lib/audit/service'

const DEFAULT_PENDING_ACTION_TTL_HOURS = 72
const MIN_PENDING_ACTION_TIMEOUT_SECONDS = 30
const MAX_PENDING_ACTION_TIMEOUT_SECONDS = 60 * 60 * 24 * 30

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function getDefaultPendingActionTimeoutSeconds() {
  const raw = Number(process.env.KOVA_PENDING_ACTION_TTL_HOURS || DEFAULT_PENDING_ACTION_TTL_HOURS)
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_PENDING_ACTION_TTL_HOURS * 60 * 60
  }

  return raw * 60 * 60
}

export function resolvePendingActionTimeoutSeconds(
  preferences: unknown,
  fallback = getDefaultPendingActionTimeoutSeconds()
) {
  const rawValue = asObject(preferences).actionTimeoutSeconds
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
    return fallback
  }

  return Math.max(MIN_PENDING_ACTION_TIMEOUT_SECONDS, Math.min(rawValue, MAX_PENDING_ACTION_TIMEOUT_SECONDS))
}

export function getPendingActionExpiryCutoff(
  now = new Date(),
  timeoutSeconds = getDefaultPendingActionTimeoutSeconds()
) {
  return new Date(now.getTime() - timeoutSeconds * 1000)
}

export function isPendingActionExpired(
  createdAt: Date,
  now = new Date(),
  timeoutSeconds = getDefaultPendingActionTimeoutSeconds()
) {
  return createdAt.getTime() < getPendingActionExpiryCutoff(now, timeoutSeconds).getTime()
}

export async function expirePendingActions(params: {
  workspaceId: string
  userId: string
  now?: Date
}) {
  const now = params.now || new Date()
  const workspace = await prisma.workspace.findUnique({
    where: { id: params.workspaceId },
    select: { preferences: true },
  })
  const timeoutSeconds = resolvePendingActionTimeoutSeconds(workspace?.preferences)
  const cutoff = getPendingActionExpiryCutoff(now, timeoutSeconds)

  const expiredActionIds: string[] = []

  while (true) {
    const staleActions = await prisma.action.findMany({
      where: {
        workspaceId: params.workspaceId,
        userId: params.userId,
        status: 'pending',
        createdAt: {
          lt: cutoff,
        },
      },
      select: {
        id: true,
        type: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })

    if (staleActions.length === 0) {
      break
    }

    const staleActionIds = staleActions.map((action) => action.id)
    expiredActionIds.push(...staleActionIds)

    await prisma.action.updateMany({
      where: {
        id: {
          in: staleActionIds,
        },
        status: 'pending',
      },
      data: {
        status: 'expired',
        executedAt: now,
        result: {
          details: 'Approval window expired before the action was reviewed.',
          expiredAt: now.toISOString(),
          timeoutSeconds,
        },
      },
    })

    await Promise.all(
      staleActions.map((action) =>
        createAuditLog({
          actionType: action.type,
          status: 'expired',
          actionId: action.id,
          workspaceId: params.workspaceId,
          userId: params.userId,
          error: 'Pending action expired before review.',
          executionTrigger: 'review',
          details: {
            staleSince: action.createdAt.toISOString(),
            timeoutSeconds,
          },
        })
      )
    )
  }

  return expiredActionIds
}
