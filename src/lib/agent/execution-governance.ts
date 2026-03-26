import type { AssistantProfile } from '../assistant/profile'
import type { DashboardAction } from '../dashboard-data'

export type ExecutionDecisionReason =
  | 'manual_review'
  | 'profile_requires_review'
  | 'missing_recipient'
  | 'confidence_below_threshold'
  | 'high_risk_requires_review'
  | 'medium_risk_requires_review'
  | 'auto_approved'

export interface ExecutionProposal {
  type: DashboardAction['type']
  confidenceScore: number
  parameters: Record<string, unknown>
}

function hasExternalShareRecipients(parameters: Record<string, unknown>) {
  const recipients = Array.isArray(parameters.emails) ? parameters.emails : []
  return recipients.some((value) => typeof value === 'string' && value.includes('@'))
}

function hasPlaceholderRecipient(parameters: Record<string, unknown>) {
  const recipients = Array.isArray(parameters.to) ? parameters.to : []
  return recipients.some((value) => {
    if (typeof value !== 'string') return false
    const normalized = value.trim().toLowerCase()
    return normalized === 'recipient@example.com' || normalized.endsWith('@example.com')
  })
}

function hasPlaceholderShareRecipient(parameters: Record<string, unknown>) {
  const recipients = Array.isArray(parameters.emails) ? parameters.emails : []
  return recipients.some((value) => {
    if (typeof value !== 'string') return false
    const normalized = value.trim().toLowerCase()
    return normalized === 'recipient@example.com' || normalized.endsWith('@example.com')
  })
}

export function inferRiskLevel(
  actionType: DashboardAction['type'],
  parameters: Record<string, unknown>
): 'low' | 'medium' | 'high' {
  if (
    actionType === 'delete_calendar_event' ||
    actionType === 'delete_google_drive_file' ||
    actionType === 'share_google_drive_file' ||
    actionType === 'trash_gmail_thread' ||
    actionType === 'unshare_google_drive_file'
  ) {
    if (actionType !== 'share_google_drive_file' || hasExternalShareRecipients(parameters)) {
      return 'high'
    }
  }

  if (
    actionType === 'label_gmail_thread' ||
    actionType === 'move_google_drive_file' ||
    actionType === 'forward_email' ||
    actionType === 'copy_google_drive_file' ||
    actionType === 'update_notion_page_properties'
  ) {
    return 'medium'
  }

  if (
    actionType === 'archive_gmail_thread' ||
    actionType === 'mark_gmail_thread_read' ||
    actionType === 'mark_gmail_thread_unread' ||
    actionType === 'star_gmail_thread' ||
    actionType === 'unstar_gmail_thread' ||
    actionType === 'create_gmail_draft'
  ) {
    return 'low'
  }

  if (actionType === 'rename_google_drive_file') {
    return 'medium'
  }

  if (actionType === 'send_email') {
    const recipients = Array.isArray(parameters.to) ? parameters.to : []
    return recipients.length > 1 ? 'medium' : 'low'
  }

  if (
    actionType === 'reply_to_email' ||
    actionType === 'update_calendar_event' ||
    actionType === 'update_google_doc' ||
    actionType === 'update_notion_page' ||
    actionType === 'create_notion_page'
  ) {
    return 'medium'
  }

  return 'low'
}

export function resolveExecutionDecision(params: {
  requestedMode: 'ask' | 'auto'
  proposals: ExecutionProposal[]
  assistantProfile: AssistantProfile
}) {
  if (params.requestedMode === 'ask') {
    return { effectiveMode: 'ask' as const, reason: 'manual_review' as ExecutionDecisionReason }
  }

  if (params.assistantProfile.executionPolicy === 'always_ask') {
    return { effectiveMode: 'ask' as const, reason: 'profile_requires_review' as ExecutionDecisionReason }
  }

  if (
    params.proposals.some((proposal) =>
      (proposal.type === 'send_email' || proposal.type === 'forward_email' || proposal.type === 'create_gmail_draft') &&
      hasPlaceholderRecipient(proposal.parameters)
    ) ||
    params.proposals.some((proposal) => proposal.type === 'share_google_drive_file' && hasPlaceholderShareRecipient(proposal.parameters))
  ) {
    return { effectiveMode: 'ask' as const, reason: 'missing_recipient' as ExecutionDecisionReason }
  }

  const highestRisk = params.proposals.reduce<'low' | 'medium' | 'high'>((current, proposal) => {
    const proposalRisk = inferRiskLevel(proposal.type, proposal.parameters)
    if (proposalRisk === 'high' || current === 'high') return 'high'
    if (proposalRisk === 'medium' || current === 'medium') return 'medium'
    return 'low'
  }, 'low')

  if (highestRisk === 'high') {
    return { effectiveMode: 'ask' as const, reason: 'high_risk_requires_review' as ExecutionDecisionReason }
  }

  if (params.assistantProfile.executionPolicy === 'auto_low_risk' && highestRisk === 'medium') {
    return { effectiveMode: 'ask' as const, reason: 'medium_risk_requires_review' as ExecutionDecisionReason }
  }

  // Only gate on confidence when policy is explicitly auto_when_confident.
  // When user explicitly chose auto mode with auto_low_risk, trust that choice.
  if (params.assistantProfile.executionPolicy === 'auto_when_confident') {
    const lowestConfidence = params.proposals.reduce((current, proposal) => Math.min(current, proposal.confidenceScore), 1)
    if (params.proposals.length > 0 && lowestConfidence < params.assistantProfile.confidenceThreshold) {
      return { effectiveMode: 'ask' as const, reason: 'confidence_below_threshold' as ExecutionDecisionReason }
    }
  }

  return { effectiveMode: 'auto' as const, reason: 'auto_approved' as ExecutionDecisionReason }
}
