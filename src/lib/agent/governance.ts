import { prisma } from '@/lib/db/prisma'
import type { DashboardAction } from '@/lib/dashboard-data'

export type WorkspaceRole = 'owner' | 'admin' | 'operator' | 'viewer'

type GovernancePreferences = {
  memberRoles?: Record<string, WorkspaceRole>
  toolPermissions?: Partial<Record<WorkspaceRole, DashboardAction['type'][]>>
}

const defaultRolePermissions: Record<WorkspaceRole, DashboardAction['type'][]> = {
  owner: [
    'send_email',
    'reply_to_email',
    'create_gmail_draft',
    'forward_email',
    'archive_gmail_thread',
    'label_gmail_thread',
    'mark_gmail_thread_read',
    'mark_gmail_thread_unread',
    'star_gmail_thread',
    'unstar_gmail_thread',
    'trash_gmail_thread',
    'create_calendar_event',
    'update_calendar_event',
    'delete_calendar_event',
    'create_google_doc',
    'update_google_doc',
    'create_google_drive_file',
    'delete_google_drive_file',
    'move_google_drive_file',
    'rename_google_drive_file',
    'share_google_drive_file',
    'copy_google_drive_file',
    'unshare_google_drive_file',
    'create_notion_page',
    'update_notion_page',
    'update_notion_page_properties',
  ],
  admin: [
    'send_email',
    'reply_to_email',
    'create_gmail_draft',
    'forward_email',
    'archive_gmail_thread',
    'label_gmail_thread',
    'mark_gmail_thread_read',
    'mark_gmail_thread_unread',
    'star_gmail_thread',
    'unstar_gmail_thread',
    'trash_gmail_thread',
    'create_calendar_event',
    'update_calendar_event',
    'delete_calendar_event',
    'create_google_doc',
    'update_google_doc',
    'create_google_drive_file',
    'delete_google_drive_file',
    'move_google_drive_file',
    'rename_google_drive_file',
    'share_google_drive_file',
    'copy_google_drive_file',
    'unshare_google_drive_file',
    'create_notion_page',
    'update_notion_page',
    'update_notion_page_properties',
  ],
  operator: [
    'send_email',
    'reply_to_email',
    'create_gmail_draft',
    'forward_email',
    'archive_gmail_thread',
    'label_gmail_thread',
    'mark_gmail_thread_read',
    'mark_gmail_thread_unread',
    'star_gmail_thread',
    'unstar_gmail_thread',
    'trash_gmail_thread',
    'create_calendar_event',
    'update_calendar_event',
    'create_google_doc',
    'update_google_doc',
    'create_google_drive_file',
    'move_google_drive_file',
    'rename_google_drive_file',
    'share_google_drive_file',
    'copy_google_drive_file',
    'unshare_google_drive_file',
    'create_notion_page',
    'update_notion_page',
    'update_notion_page_properties',
  ],
  viewer: [],
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function normalizeRole(value: unknown): WorkspaceRole | null {
  return value === 'owner' || value === 'admin' || value === 'operator' || value === 'viewer'
    ? value
    : null
}

function parseGovernancePreferences(value: unknown): GovernancePreferences {
  const preferences = asObject(value)
  const rawGovernance = asObject(preferences.agentGovernance)
  const rawMemberRoles = asObject(rawGovernance.memberRoles)
  const rawToolPermissions = asObject(rawGovernance.toolPermissions)

  const memberRoles = Object.fromEntries(
    Object.entries(rawMemberRoles)
      .map(([userId, role]) => [userId, normalizeRole(role)])
      .filter((entry): entry is [string, WorkspaceRole] => entry[1] !== null)
  )

  const toolPermissions = Object.fromEntries(
    Object.entries(rawToolPermissions)
      .map(([role, permissions]) => {
        const normalizedRole = normalizeRole(role)
        if (!normalizedRole || !Array.isArray(permissions)) return null
        const allowed = permissions.filter((permission): permission is DashboardAction['type'] =>
          permission === 'send_email' ||
          permission === 'reply_to_email' ||
          permission === 'create_gmail_draft' ||
          permission === 'forward_email' ||
          permission === 'archive_gmail_thread' ||
          permission === 'label_gmail_thread' ||
          permission === 'mark_gmail_thread_read' ||
          permission === 'mark_gmail_thread_unread' ||
          permission === 'star_gmail_thread' ||
          permission === 'unstar_gmail_thread' ||
          permission === 'trash_gmail_thread' ||
          permission === 'create_calendar_event' ||
          permission === 'update_calendar_event' ||
          permission === 'delete_calendar_event' ||
          permission === 'create_google_doc' ||
          permission === 'update_google_doc' ||
          permission === 'create_google_drive_file' ||
          permission === 'delete_google_drive_file' ||
          permission === 'move_google_drive_file' ||
          permission === 'rename_google_drive_file' ||
          permission === 'share_google_drive_file' ||
          permission === 'copy_google_drive_file' ||
          permission === 'unshare_google_drive_file' ||
          permission === 'create_notion_page' ||
          permission === 'update_notion_page' ||
          permission === 'update_notion_page_properties'
        )
        return [normalizedRole, allowed] as const
      })
      .filter((entry): entry is readonly [WorkspaceRole, DashboardAction['type'][]] => entry !== null)
  ) as Partial<Record<WorkspaceRole, DashboardAction['type'][]>>

  return {
    memberRoles,
    toolPermissions,
  }
}

function uniqueActionTypes(actionTypes: DashboardAction['type'][]) {
  return Array.from(new Set(actionTypes))
}

export async function getWorkspaceGovernance(params: {
  workspaceId: string
  userId: string
}) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: params.workspaceId },
    select: {
      ownerId: true,
      preferences: true,
    },
  })

  if (!workspace) {
    throw new Error('Workspace not found.')
  }

  const governance = parseGovernancePreferences(workspace.preferences)
  const role =
    workspace.ownerId === params.userId
      ? 'owner'
      : governance.memberRoles?.[params.userId] || 'viewer'

  const allowedActionTypes = uniqueActionTypes(
    governance.toolPermissions?.[role] || defaultRolePermissions[role]
  )

  return {
    role,
    allowedActionTypes,
  }
}

export function canRoleExecuteAction(role: WorkspaceRole, actionType: DashboardAction['type']) {
  return defaultRolePermissions[role].includes(actionType)
}

export function assertActionAllowed(params: {
  role: WorkspaceRole
  allowedActionTypes: DashboardAction['type'][]
  actionType: DashboardAction['type']
}) {
  if (!params.allowedActionTypes.includes(params.actionType)) {
    throw new Error(`Role "${params.role}" is not allowed to execute "${params.actionType}".`)
  }
}
