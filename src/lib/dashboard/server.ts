import { prisma } from '@/lib/db/prisma'
import { getAppContext } from '@/lib/app-context'
import { inferRiskLevel } from '@/lib/agent/execution-governance'
import type { DashboardAction, DashboardIntegration } from '@/lib/dashboard-data'
import { buildDashboardScopeWhere } from '@/lib/dashboard/query'
import { getGoogleIntegrationCapabilityState } from '@/lib/integrations/google'

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return {}
}

function mapActionStatus(status: string): DashboardAction['status'] {
  if (
    status === 'pending' ||
    status === 'approved' ||
    status === 'rejected' ||
    status === 'executing' ||
    status === 'completed' ||
    status === 'failed'
  ) {
    return status
  }

  return 'pending'
}

function targetAppForType(type: DashboardAction['type']): DashboardAction['targetApp'] {
  if (type === 'send_email' || type === 'reply_to_email') return 'Gmail'
  if (type === 'create_calendar_event' || type === 'update_calendar_event' || type === 'delete_calendar_event') {
    return 'Google Calendar'
  }
  if (type === 'create_google_doc' || type === 'update_google_doc') return 'Google Docs'
  if (type === 'create_google_drive_file' || type === 'delete_google_drive_file') return 'Google Drive'
  return 'Notion'
}

function mapIntegrationStatus(status: string): DashboardIntegration['status'] {
  if (status === 'connected' || status === 'disconnected' || status === 'error') {
    return status
  }

  return 'disconnected'
}

function mapIntegration(record: {
  id: string
  type: string
  status: string
  metadata: unknown
  lastSyncAt: Date | null
}): DashboardIntegration {
  const metadata = asRecord(record.metadata)
  const appName =
    record.type === 'gmail'
      ? 'Gmail'
      : record.type === 'calendar'
        ? 'Google Calendar'
        : record.type === 'notion'
          ? 'Notion'
          : record.type === 'google_docs'
            ? 'Google Docs'
            : record.type === 'google_drive'
              ? 'Google Drive'
            : 'Slack'

  const descriptionMap: Record<string, string> = {
    gmail: 'Send emails, draft follow-ups, and label inbox conversations.',
    calendar: 'Create events, coordinate meetings, and resolve schedule conflicts.',
    notion: 'Update pages, maintain databases, and publish workspace summaries.',
    google_docs: 'Create briefs, execution summaries, and structured documents from agent output.',
    google_drive: 'Create folders and save generated files to Drive for later sharing and reuse.',
    slack: 'Route notifications and post approvals back to operating channels.',
  }

  const shortDescriptionMap: Record<string, string> = {
    gmail: 'Mail operations and outbound actions.',
    calendar: 'Scheduling and calendar execution.',
    notion: 'Knowledge base and docs automation.',
    google_docs: 'Docs generation and updates.',
    google_drive: 'Drive storage and file delivery.',
    slack: 'Team notifications and approvals.',
  }

  const colorMap: Record<string, string> = {
    gmail: '#EA4335',
    calendar: '#4285F4',
    notion: '#FFFFFF',
    google_docs: '#34A853',
    google_drive: '#0F9D58',
    slack: '#4A154B',
  }

  const iconMap: Record<string, string> = {
    gmail: '✉',
    calendar: '◔',
    notion: 'N',
    google_docs: 'G',
    google_drive: 'D',
    slack: 'S',
  }

  const googleCapabilityState =
    record.type === 'gmail' ||
    record.type === 'calendar' ||
    record.type === 'google_docs' ||
    record.type === 'google_drive'
      ? getGoogleIntegrationCapabilityState(record.type, record.metadata)
      : null

  const warnings =
    googleCapabilityState?.needsReconnect
      ? ['Reconnect Google to grant the latest read and write permissions for this surface.']
      : []

  return {
    id: record.type as DashboardIntegration['id'],
    name: appName,
    description: descriptionMap[record.type] || `${appName} integration.`,
    shortDescription: shortDescriptionMap[record.type] || `${appName} integration.`,
    color: colorMap[record.type] || '#71717A',
    icon: iconMap[record.type] || appName.slice(0, 1).toUpperCase(),
    status: mapIntegrationStatus(record.status),
    connectedAccount: typeof metadata.connectedAccount === 'string' ? metadata.connectedAccount : null,
    lastSync: record.lastSyncAt?.toISOString() || null,
    health:
      record.status === 'error'
        ? 'attention'
        : googleCapabilityState?.needsReconnect
          ? 'warning'
        : record.lastSyncAt && Date.now() - record.lastSyncAt.getTime() < 1000 * 60 * 60 * 24
          ? 'healthy'
          : 'warning',
    warnings,
    needsReconnect: googleCapabilityState?.needsReconnect || false,
  }
}

function mapAction(record: {
  id: string
  type: string
  title: string
  description: string
  parameters: unknown
  status: string
  createdAt: Date
  executedAt: Date | null
  result: unknown
}): DashboardAction {
  const type = record.type as DashboardAction['type']
  const parameters = asRecord(record.parameters)
  const result = asRecord(record.result)

  return {
    id: record.id,
    type,
    title: record.title,
    description: record.description,
    parameters,
    status: mapActionStatus(record.status),
    riskLevel: inferRiskLevel(type, parameters),
    targetApp: targetAppForType(type),
    createdAt: record.createdAt.toISOString(),
    executedAt: record.executedAt?.toISOString(),
    confidenceScore:
      typeof result.confidenceScore === 'number'
        ? result.confidenceScore
        : typeof parameters.confidenceScore === 'number'
          ? parameters.confidenceScore
          : 0.84,
    details: typeof result.details === 'string' ? result.details : undefined,
    error: typeof result.error === 'string' ? result.error : undefined,
  }
}

export interface DashboardBundle {
  pendingActions: DashboardAction[]
  executionHistory: DashboardAction[]
  integrations: DashboardIntegration[]
  approvalActivity: Array<{
    id: string
    label: string
    description: string
    at: string
  }>
  metrics: {
    pending: number
    connectedIntegrations: number
    completedToday: number
    failureRate: number
  }
  source: 'database'
}

export async function getDashboardBundle(): Promise<DashboardBundle> {
  const { dbUserId, workspaceId } = await getAppContext()
  const scopeWhere = buildDashboardScopeWhere({
    workspaceId,
    userId: dbUserId,
  })
  const [actions, integrations] = await Promise.all([
    prisma.action.findMany({
      where: scopeWhere,
      orderBy: [{ createdAt: 'desc' }],
      take: 50,
    }),
    prisma.integration.findMany({
      where: scopeWhere,
      orderBy: [{ updatedAt: 'desc' }],
      take: 20,
    }),
  ])

  const mappedActions = actions.map(mapAction)
  const mappedIntegrations = integrations.map(mapIntegration)
  const pendingActions = mappedActions.filter((action) => action.status === 'pending')
  const executionHistory = mappedActions.filter((action) => action.status !== 'pending')
  const completedToday = mappedActions.filter((action) => {
    if (action.status !== 'completed' || !action.executedAt) return false
    const executed = new Date(action.executedAt)
    const now = new Date()
    return executed.toDateString() === now.toDateString()
  }).length

  const approvalActivity = [
    ...pendingActions.slice(0, 2).map((action) => ({
      id: `pending-${action.id}`,
      label: 'Approval queue updated',
      description: `${action.title} is waiting for review.`,
      at: action.createdAt,
    })),
    ...executionHistory.slice(0, 3).map((action) => ({
      id: `history-${action.id}`,
      label:
        action.status === 'completed'
          ? 'Action completed'
          : action.status === 'failed'
            ? 'Action failed'
            : 'Action reviewed',
      description: action.details || action.title,
      at: action.executedAt || action.createdAt,
    })),
  ]
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
    .slice(0, 5)

  return {
    pendingActions,
    executionHistory,
    integrations: mappedIntegrations,
    approvalActivity,
    metrics: {
      pending: pendingActions.length,
      connectedIntegrations: mappedIntegrations.filter((integration) => integration.status === 'connected').length,
      completedToday,
      failureRate:
        mappedActions.length > 0
          ? Math.round((mappedActions.filter((action) => action.status === 'failed').length / mappedActions.length) * 100)
          : 0,
    },
    source: 'database',
  }
}
