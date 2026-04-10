import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { createAuditLog } from '@/lib/audit/service'
import { asActionParameters } from '@/lib/actions/parameter-resolution'
import { extractNameBeforeEmail, rememberContact } from '@/lib/contacts'
import { executePersistedAction } from '@/lib/integrations/execute'
import { syncActionPlansForActionIds } from '@/lib/actions/action-plans'
import { syncActionPlanWorkflowsForActionIds } from '@/lib/actions/workflow-state'

function getConfidenceScore(parameters: Prisma.JsonValue) {
  const actionParameters = asActionParameters(parameters)
  return typeof actionParameters.confidenceScore === 'number' ? actionParameters.confidenceScore : 0.85
}

/**
 * Picks due `send_email` actions (status scheduled, scheduledFor <= now) and sends them via Gmail.
 * Intended to run from a secured cron route.
 */
export async function processDueScheduledSends(params: { limit?: number; now?: Date } = {}) {
  const now = params.now ?? new Date()
  const limit = params.limit ?? 25

  const due = await prisma.action.findMany({
    where: {
      type: 'send_email',
      status: 'scheduled',
      scheduledFor: { lte: now },
    },
    orderBy: { scheduledFor: 'asc' },
    take: limit,
  })

  const results: Array<{ id: string; ok: boolean; error?: string }> = []

  for (const row of due) {
    const claimed = await prisma.action.updateMany({
      where: { id: row.id, status: 'scheduled' },
      data: { status: 'executing' },
    })

    if (claimed.count === 0) {
      continue
    }

    try {
      const execution = await executePersistedAction({
        action: {
          id: row.id,
          type: 'send_email',
          title: row.title,
          description: row.description,
          parameters: row.parameters as Prisma.JsonObject,
          workspaceId: row.workspaceId,
          userId: row.userId,
        },
      })

      await prisma.action.update({
        where: { id: row.id },
        data: {
          status: 'completed',
          executedAt: new Date(),
          scheduledFor: null,
          parameters: row.parameters as Prisma.JsonObject,
          result: {
            confidenceScore: getConfidenceScore(row.parameters),
            details: execution.details,
            output: execution.output as Prisma.JsonObject,
            executionTrigger: 'api',
            fromScheduledSend: true,
          } as Prisma.JsonObject,
        },
      })

      const paramsObj = asActionParameters(row.parameters)
      const recipients =
        Array.isArray(paramsObj.to)
          ? paramsObj.to.filter((value): value is string => typeof value === 'string')
          : []
      for (const recipient of recipients) {
        if (!recipient.includes('@')) continue
        await rememberContact({
          userId: row.userId,
          workspaceId: row.workspaceId,
          email: recipient,
          name:
            typeof paramsObj.resolvedContactName === 'string'
              ? paramsObj.resolvedContactName
              : extractNameBeforeEmail(row.description, recipient),
        })
      }

      await createAuditLog({
        actionType: row.type,
        status: 'success',
        actionId: row.id,
        workspaceId: row.workspaceId,
        userId: row.userId,
        details: execution.output,
        provider: 'gmail',
        toolName: 'send_email',
        executionTrigger: 'api',
      })

      results.push({ id: row.id, ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Scheduled send failed.'
      await prisma.action.update({
        where: { id: row.id },
        data: {
          status: 'failed',
          executedAt: new Date(),
          result: {
            details: 'Scheduled email send failed.',
            error: message,
            executionTrigger: 'api',
          } as Prisma.JsonObject,
        },
      })

      await createAuditLog({
        actionType: row.type,
        status: 'failure',
        actionId: row.id,
        workspaceId: row.workspaceId,
        userId: row.userId,
        error: message,
        executionTrigger: 'api',
      })

      results.push({ id: row.id, ok: false, error: message })
    }
  }

  await syncActionPlansForActionIds({ actionIds: due.map((r) => r.id) })
  await syncActionPlanWorkflowsForActionIds({ actionIds: due.map((r) => r.id) })

  return { processed: results.length, results }
}
