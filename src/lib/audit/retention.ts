import { prisma } from '@/lib/db/prisma'

const DEFAULT_EXECUTION_LOG_RETENTION_DAYS = 90

export function getExecutionLogRetentionDays() {
  const raw = Number(process.env.KOVA_EXECUTION_LOG_RETENTION_DAYS || DEFAULT_EXECUTION_LOG_RETENTION_DAYS)
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_EXECUTION_LOG_RETENTION_DAYS
  }

  return raw
}

export function getExecutionLogRetentionCutoff(now = new Date()) {
  return new Date(now.getTime() - getExecutionLogRetentionDays() * 24 * 60 * 60 * 1000)
}

export async function pruneExecutionLogs(now = new Date()) {
  const cutoff = getExecutionLogRetentionCutoff(now)

  const deleted = await prisma.executionLog.deleteMany({
    where: {
      createdAt: {
        lt: cutoff,
      },
    },
  })

  return {
    deletedCount: deleted.count,
    cutoff: cutoff.toISOString(),
    retentionDays: getExecutionLogRetentionDays(),
  }
}
