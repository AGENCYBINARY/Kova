import { prisma } from '@/lib/db/prisma'
import {
  approvalActivity,
  dashboardIntegrations as fallbackIntegrations,
  dashboardMetrics as fallbackMetrics,
  executionHistory as fallbackHistory,
  pendingActions as fallbackPendingActions,
  type DashboardAction,
  type DashboardIntegration,
} from '@/lib/dashboard-data'

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

function inferRiskLevel(parameters: Record<string, unknown>, type: DashboardAction['type']): DashboardAction['riskLevel'] {
  if (type === 'send_email' && Array.isArray(parameters.to) && parameters.to.length > 1) {
    return 'medium'
  }

  if (type === 'create_notion_page') {
    return 'high'
  }

  return 'low'
}

function targetAppForType(type: DashboardAction['type']): DashboardAction['targetApp'] {
  if (type === 'send_email') return 'Gmail'
  if (type === 'create_calendar_event') return 'Google Calendar'
  if (type === 'create_google_doc' || type === 'update_google_doc') return 'Google Docs'
  if (type === 'create_google_drive_file') return 'Google Drive'
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
        : record.lastSyncAt && Date.now() - record.lastSyncAt.getTime() < 1000 * 60 * 60 * 24
          ? 'healthy'
          : 'warning',
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
    riskLevel: inferRiskLevel(parameters, type),
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
  approvalActivity: typeof approvalActivity
  metrics: {
    pending: number
    connectedIntegrations: number
    completedToday: number
    failureRate: number
  }
  source: 'database' | 'mock'
}

export async function getDashboardBundle(): Promise<DashboardBundle> {
  try {
    const [actions, integrations] = await Promise.all([
      prisma.action.findMany({
        orderBy: [{ createdAt: 'desc' }],
        take: 50,
      }),
      prisma.integration.findMany({
        orderBy: [{ updatedAt: 'desc' }],
        take: 20,
      }),
    ])

    if (actions.length === 0 && integrations.length === 0) {
      return {
        pendingActions: fallbackPendingActions,
        executionHistory: fallbackHistory,
        integrations: fallbackIntegrations,
        approvalActivity,
        metrics: fallbackMetrics,
        source: 'mock',
      }
    }

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

    const visibleIntegrations = mappedIntegrations.length > 0 ? mappedIntegrations : fallbackIntegrations

    return {
      pendingActions,
      executionHistory,
      integrations: visibleIntegrations,
      approvalActivity,
      metrics: {
        pending: pendingActions.length,
        connectedIntegrations: visibleIntegrations.filter((integration) => integration.status === 'connected').length,
        completedToday,
        failureRate:
          mappedActions.length > 0
            ? Math.round((mappedActions.filter((action) => action.status === 'failed').length / mappedActions.length) * 100)
            : 0,
      },
      source: 'database',
    }
  } catch {
    return {
      pendingActions: fallbackPendingActions,
      executionHistory: fallbackHistory,
      integrations: fallbackIntegrations,
      approvalActivity,
      metrics: fallbackMetrics,
      source: 'mock',
    }
  }
}
