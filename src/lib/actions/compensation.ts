import type { DashboardAction } from '@/lib/dashboard-data'
import { createAuditLog } from '@/lib/audit/service'
import { executeToolByActionType } from '@/lib/mcp/registry'

export interface CompletedBatchCompensationInput {
  action: {
    id: string
    type: string
    title: string
  }
  effectiveParameters: Record<string, unknown>
  execution: {
    output: Record<string, unknown>
  }
}

export interface CompensationExecutionRecord {
  sourceActionId: string
  sourceActionType: string
  compensationActionType: DashboardAction['type']
  parameters: Record<string, unknown>
}

export interface CompensationAttemptResult {
  sourceActionId: string
  sourceActionType: string
  compensationActionType?: DashboardAction['type']
  status: 'compensated' | 'skipped' | 'failed'
  reason?: string
}

function isEmailList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function buildCompensationExecution(
  completed: CompletedBatchCompensationInput
): CompensationExecutionRecord | null {
  const output = completed.execution.output

  switch (completed.action.type) {
    case 'create_calendar_event':
      return typeof output.eventId === 'string' && output.eventId
        ? {
            sourceActionId: completed.action.id,
            sourceActionType: completed.action.type,
            compensationActionType: 'delete_calendar_event',
            parameters: {
              eventId: output.eventId,
            },
          }
        : null
    case 'create_notion_page':
      return typeof output.pageId === 'string' && output.pageId
        ? {
            sourceActionId: completed.action.id,
            sourceActionType: completed.action.type,
            compensationActionType: 'archive_notion_page',
            parameters: {
              pageId: output.pageId,
            },
          }
        : null
    case 'create_google_drive_file':
    case 'create_google_drive_folder':
    case 'copy_google_drive_file':
      return typeof output.fileId === 'string' && output.fileId
        ? {
            sourceActionId: completed.action.id,
            sourceActionType: completed.action.type,
            compensationActionType: 'delete_google_drive_file',
            parameters: {
              fileId: output.fileId,
            },
          }
        : null
    case 'create_google_drive_appdata_file':
      return typeof output.fileId === 'string' && output.fileId
        ? {
            sourceActionId: completed.action.id,
            sourceActionType: completed.action.type,
            compensationActionType: 'delete_google_drive_appdata_file',
            parameters: {
              fileId: output.fileId,
            },
          }
        : null
    case 'share_google_drive_file': {
      const fileId = typeof output.fileId === 'string' ? output.fileId : ''
      const emails = isEmailList(output.emails)
        ? output.emails
        : isEmailList(completed.effectiveParameters.emails)
          ? completed.effectiveParameters.emails
          : []
      return fileId && emails.length > 0
        ? {
            sourceActionId: completed.action.id,
            sourceActionType: completed.action.type,
            compensationActionType: 'unshare_google_drive_file',
            parameters: {
              fileId,
              emails,
            },
          }
        : null
    }
    case 'label_gmail_thread': {
      const threadId = typeof output.threadId === 'string' ? output.threadId : ''
      const labelNames = isEmailList(output.labels)
        ? output.labels
        : Array.isArray(completed.effectiveParameters.labelNames)
          ? completed.effectiveParameters.labelNames.filter((item): item is string => typeof item === 'string')
          : []
      return threadId && labelNames.length > 0
        ? {
            sourceActionId: completed.action.id,
            sourceActionType: completed.action.type,
            compensationActionType: 'remove_gmail_thread_labels',
            parameters: {
              threadId,
              labelNames,
            },
          }
        : null
    }
    case 'archive_gmail_thread':
      return typeof output.threadId === 'string' && output.threadId
        ? {
            sourceActionId: completed.action.id,
            sourceActionType: completed.action.type,
            compensationActionType: 'unarchive_gmail_thread',
            parameters: {
              threadId: output.threadId,
            },
          }
        : null
    default:
      return null
  }
}

export async function compensateCompletedActions(params: {
  completed: CompletedBatchCompensationInput[]
  workspaceId: string
  userId: string
  trigger: 'auto' | 'approval' | 'api'
  failedActionId: string
}) {
  const attempts: CompensationAttemptResult[] = []

  for (const completedAction of [...params.completed].reverse()) {
    const compensation = buildCompensationExecution(completedAction)
    if (!compensation) {
      attempts.push({
        sourceActionId: completedAction.action.id,
        sourceActionType: completedAction.action.type,
        status: 'skipped',
        reason: 'No safe compensating action is defined for this action type.',
      })
      continue
    }

    try {
      await executeToolByActionType({
        actionType: compensation.compensationActionType,
        parameters: compensation.parameters,
        context: {
          workspaceId: params.workspaceId,
          userId: params.userId,
        },
      })

      await createAuditLog({
        actionType: 'batch.compensation',
        status: 'success',
        workspaceId: params.workspaceId,
        userId: params.userId,
        actionId: completedAction.action.id,
        executionTrigger: params.trigger,
        details: {
          sourceActionId: completedAction.action.id,
          sourceActionType: completedAction.action.type,
          failedActionId: params.failedActionId,
          compensationActionType: compensation.compensationActionType,
          compensationParameters: compensation.parameters,
        },
      })

      attempts.push({
        sourceActionId: completedAction.action.id,
        sourceActionType: completedAction.action.type,
        compensationActionType: compensation.compensationActionType,
        status: 'compensated',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown compensation failure.'
      await createAuditLog({
        actionType: 'batch.compensation',
        status: 'failure',
        workspaceId: params.workspaceId,
        userId: params.userId,
        actionId: completedAction.action.id,
        executionTrigger: params.trigger,
        error: message,
        details: {
          sourceActionId: completedAction.action.id,
          sourceActionType: completedAction.action.type,
          failedActionId: params.failedActionId,
          compensationActionType: compensation.compensationActionType,
          compensationParameters: compensation.parameters,
        },
      })

      attempts.push({
        sourceActionId: completedAction.action.id,
        sourceActionType: completedAction.action.type,
        compensationActionType: compensation.compensationActionType,
        status: 'failed',
        reason: message,
      })
    }
  }

  return {
    attempts,
    compensatedCount: attempts.filter((attempt) => attempt.status === 'compensated').length,
    failedCount: attempts.filter((attempt) => attempt.status === 'failed').length,
    skippedCount: attempts.filter((attempt) => attempt.status === 'skipped').length,
  }
}
