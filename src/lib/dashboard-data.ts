export type ActionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'completed'
  | 'failed'

export type IntegrationStatus = 'connected' | 'disconnected' | 'error'

export interface DashboardAction {
  id: string
  type:
    | 'send_email'
    | 'reply_to_email'
    | 'create_calendar_event'
    | 'update_calendar_event'
    | 'delete_calendar_event'
    | 'update_notion_page'
    | 'create_notion_page'
    | 'create_google_doc'
    | 'update_google_doc'
    | 'create_google_drive_file'
    | 'delete_google_drive_file'
  title: string
  description: string
  parameters: Record<string, unknown>
  status: ActionStatus
  riskLevel: 'low' | 'medium' | 'high'
  targetApp: 'Gmail' | 'Google Calendar' | 'Notion' | 'Google Docs' | 'Google Drive'
  createdAt: string
  executedAt?: string
  confidenceScore: number
  details?: string
  error?: string
}

export interface DashboardIntegration {
  id: 'gmail' | 'calendar' | 'notion' | 'google_docs' | 'google_drive' | 'slack'
  name: string
  description: string
  shortDescription: string
  color: string
  icon: string
  status: IntegrationStatus
  connectedAccount: string | null
  lastSync: string | null
  health: 'healthy' | 'warning' | 'attention'
  warnings?: string[]
  needsReconnect?: boolean
}

export const dashboardActions: DashboardAction[] = [
  {
    id: 'action_1',
    type: 'create_calendar_event',
    title: 'Schedule product sync with Martin',
    description: 'Create a 30-minute calendar hold tomorrow at 14:00 with agenda and attendees.',
    parameters: {
      title: 'Product sync with Martin',
      startTime: '2026-03-17T14:00:00.000Z',
      endTime: '2026-03-17T14:30:00.000Z',
      attendees: ['martin@example.com', 'ops@kova.app'],
      description: 'Review launch readiness and owner handoffs.',
    },
    status: 'pending',
    riskLevel: 'low',
    targetApp: 'Google Calendar',
    createdAt: '2026-03-16T09:42:00.000Z',
    confidenceScore: 0.94,
    details: 'Waiting for user approval before event creation.',
  },
  {
    id: 'action_2',
    type: 'send_email',
    title: 'Send launch approval recap',
    description: 'Draft and send a recap email to the launch stakeholder group.',
    parameters: {
      to: ['leadership@kova.app', 'launch@kova.app'],
      subject: 'Launch approval recap',
      body: 'Sharing the final checklist, open blockers, and owner assignments.',
    },
    status: 'pending',
    riskLevel: 'medium',
    targetApp: 'Gmail',
    createdAt: '2026-03-16T09:31:00.000Z',
    confidenceScore: 0.88,
    details: 'Requires confirmation because it reaches an external distribution list.',
  },
  {
    id: 'action_3',
    type: 'create_google_doc',
    title: 'Generate board update document',
    description: 'Create a Google Doc with launch summary, blockers, and owner follow-up actions.',
    parameters: {
      title: 'Board update - Launch operations',
      folder: 'Leadership Updates',
      sections: ['Highlights', 'Risks', 'Owner follow-ups'],
    },
    status: 'completed',
    riskLevel: 'low',
    targetApp: 'Google Docs',
    createdAt: '2026-03-15T16:02:00.000Z',
    executedAt: '2026-03-15T16:04:00.000Z',
    confidenceScore: 0.91,
    details: 'Document created and shared with leadership.',
  },
  {
    id: 'action_4',
    type: 'update_notion_page',
    title: 'Refresh sprint command center',
    description: 'Update the Notion launch page with the latest risks and rollout milestones.',
    parameters: {
      pageId: 'notion-page-launch-control',
      fields: ['Risks', 'Dependencies', 'Owner status'],
    },
    status: 'completed',
    riskLevel: 'low',
    targetApp: 'Notion',
    createdAt: '2026-03-15T15:10:00.000Z',
    executedAt: '2026-03-15T15:12:00.000Z',
    confidenceScore: 0.92,
    details: '3 blocks updated and changelog entry appended.',
  },
  {
    id: 'action_5',
    type: 'send_email',
    title: 'Notify finance of vendor renewal',
    description: 'Send a reminder email about the renewal due this week.',
    parameters: {
      to: ['finance@kova.app'],
      subject: 'Vendor renewal due Friday',
      body: 'Reminder with contract summary, owner, and approval path.',
    },
    status: 'failed',
    riskLevel: 'medium',
    targetApp: 'Gmail',
    createdAt: '2026-03-15T11:05:00.000Z',
    executedAt: '2026-03-15T11:06:00.000Z',
    confidenceScore: 0.81,
    details: 'Execution failed during provider call.',
    error: 'Gmail returned 401: refresh token expired.',
  },
  {
    id: 'action_6',
    type: 'create_notion_page',
    title: 'Create customer interview summary',
    description: 'Generate a new Notion page with transcript summary and action items.',
    parameters: {
      title: 'Customer interview summary - Delta Foods',
      parentDatabaseId: 'research-db',
      sections: ['Summary', 'Quotes', 'Action items'],
    },
    status: 'rejected',
    riskLevel: 'high',
    targetApp: 'Notion',
    createdAt: '2026-03-14T17:22:00.000Z',
    executedAt: '2026-03-14T17:26:00.000Z',
    confidenceScore: 0.69,
    details: 'Rejected because the transcript source was incomplete.',
  },
]

export const dashboardIntegrations: DashboardIntegration[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Send emails, draft follow-ups, and label inbox conversations.',
    shortDescription: 'Mail operations and outbound actions.',
    color: '#EA4335',
    icon: '✉',
    status: 'disconnected',
    connectedAccount: null,
    lastSync: null,
    health: 'attention',
  },
  {
    id: 'calendar',
    name: 'Google Calendar',
    description: 'Create events, coordinate meetings, and resolve schedule conflicts.',
    shortDescription: 'Scheduling and calendar execution.',
    color: '#4285F4',
    icon: '◔',
    status: 'disconnected',
    connectedAccount: null,
    lastSync: null,
    health: 'attention',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Update pages, maintain databases, and publish workspace summaries.',
    shortDescription: 'Knowledge base and docs automation.',
    color: '#FFFFFF',
    icon: 'N',
    status: 'disconnected',
    connectedAccount: null,
    lastSync: null,
    health: 'attention',
  },
  {
    id: 'google_docs',
    name: 'Google Docs',
    description: 'Create briefs, execution summaries, and structured documents from agent output.',
    shortDescription: 'Docs generation and updates.',
    color: '#34A853',
    icon: 'G',
    status: 'disconnected',
    connectedAccount: null,
    lastSync: null,
    health: 'attention',
  },
  {
    id: 'google_drive',
    name: 'Google Drive',
    description: 'Create folders and save generated files to Drive for later sharing and reuse.',
    shortDescription: 'Drive storage and file delivery.',
    color: '#0F9D58',
    icon: 'D',
    status: 'disconnected',
    connectedAccount: null,
    lastSync: null,
    health: 'attention',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Route notifications and post approvals back to operating channels.',
    shortDescription: 'Team notifications and approvals.',
    color: '#4A154B',
    icon: 'S',
    status: 'disconnected',
    connectedAccount: null,
    lastSync: null,
    health: 'attention',
  },
]

export const pendingActions = dashboardActions.filter((action) => action.status === 'pending')

export const executionHistory = dashboardActions.filter((action) => action.status !== 'pending')

export const dashboardMetrics = {
  pending: pendingActions.length,
  connectedIntegrations: dashboardIntegrations.filter((integration) => integration.status === 'connected').length,
  completedToday: dashboardActions.filter(
    (action) => action.status === 'completed' && action.executedAt?.startsWith('2026-03-15')
  ).length,
  failureRate: Math.round(
    (dashboardActions.filter((action) => action.status === 'failed').length / dashboardActions.length) * 100
  ),
}

export const approvalActivity = [
  {
    id: 'activity_1',
    label: 'Approval queue updated',
    description: '2 new proposals need review before external execution.',
    at: '2026-03-16T09:45:00.000Z',
  },
  {
    id: 'activity_2',
    label: 'Notion sync drift detected',
    description: 'One workspace token will need re-authentication soon.',
    at: '2026-03-16T09:14:00.000Z',
  },
  {
    id: 'activity_3',
    label: 'Calendar action completed',
    description: 'Sprint retrospective event created and attendees notified.',
    at: '2026-03-15T15:12:00.000Z',
  },
]
