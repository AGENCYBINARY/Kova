export type AssistantTone =
  | 'executive'
  | 'concise'
  | 'warm'
  | 'sales'
  | 'support'

export type AssistantExecutionPolicy =
  | 'always_ask'
  | 'auto_low_risk'
  | 'auto_when_confident'

export interface AssistantProfile {
  executiveMode: boolean
  assistantName: string
  roleDescription: string
  defaultLanguage: 'fr' | 'en'
  writingTone: AssistantTone
  writingDirectness: 'soft' | 'balanced' | 'direct'
  signatureName: string
  signatureBlock: string
  executionPolicy: AssistantExecutionPolicy
  confidenceThreshold: number
  autoResolveKnownContacts: boolean
  schedulingBufferMinutes: number
  meetingDefaultDurationMinutes: number
  enabledSkills: string[]
}

export const executiveAssistantSkills = [
  {
    id: 'professional_email_writer',
    title: 'Professional Email Writer',
    description: 'Writes polished, context-aware business emails with clear structure and tone.',
    instructions:
      'Prefer crisp subject lines, concise openings, strong action-oriented body copy, and clean closings. Use the sender signature when appropriate.',
  },
  {
    id: 'meeting_scheduler',
    title: 'Meeting Scheduler',
    description: 'Turns requests into well-formed meeting invitations with realistic defaults.',
    instructions:
      'Infer duration, attendees, and a practical agenda. Avoid ambiguous time proposals when confidence is low.',
  },
  {
    id: 'followup_manager',
    title: 'Follow-up Manager',
    description: 'Creates professional reminders, check-ins, and follow-up drafts.',
    instructions:
      'Write brief and courteous follow-ups. Make next steps explicit and maintain context from prior requests.',
  },
  {
    id: 'document_brief_writer',
    title: 'Document Brief Writer',
    description: 'Builds structured summaries, briefs, and executive notes for Google Docs and Notion.',
    instructions:
      'Use strong sectioning, executive summaries, and action items. Optimize for readability and decision making.',
  },
  {
    id: 'calendar_operator',
    title: 'Calendar Operator',
    description: 'Manages scheduling details like buffers, titles, and expected attendees.',
    instructions:
      'Add buffers and default durations from workspace preferences. Use specific titles over vague placeholders.',
  },
  {
    id: 'client_comms_secretary',
    title: 'Client Communications Secretary',
    description: 'Acts like a high-level executive assistant handling client-facing communication.',
    instructions:
      'Be professional, helpful, composed, and proactive. Clarify intent when needed, but do not sound robotic.',
  },
  {
    id: 'inbox_triage_operator',
    title: 'Inbox Triage Operator',
    description: 'Sorts incoming communication by urgency, owner, and next step.',
    instructions:
      'Prioritize executive communication, deadlines, approvals, and client-sensitive threads. Surface the next action clearly.',
  },
  {
    id: 'calendar_conflict_resolver',
    title: 'Calendar Conflict Resolver',
    description: 'Detects and handles scheduling conflicts with pragmatic alternatives.',
    instructions:
      'Prefer clean handoffs, avoid double-booking, and suggest realistic alternative slots when timing is ambiguous.',
  },
  {
    id: 'meeting_brief_creator',
    title: 'Meeting Brief Creator',
    description: 'Prepares agendas, participant context, and decision-oriented meeting notes.',
    instructions:
      'Use concise agendas, define desired outcomes, and capture owners, deadlines, and follow-ups.',
  },
  {
    id: 'notion_workspace_manager',
    title: 'Notion Workspace Manager',
    description: 'Keeps operational pages and knowledge bases structured and current.',
    instructions:
      'Write clearly structured Notion content with sections, operational context, and actionable summaries.',
  },
  {
    id: 'google_docs_formatter',
    title: 'Google Docs Formatter',
    description: 'Produces polished briefs, reports, and summaries in document form.',
    instructions:
      'Prefer executive summaries, strong headings, and decision-ready document structure over raw notes.',
  },
  {
    id: 'task_followthrough_manager',
    title: 'Task Follow-through Manager',
    description: 'Tracks commitments and turns loose requests into explicit next steps.',
    instructions:
      'Always make owners, due dates, dependencies, and expected outputs explicit when possible.',
  },
  {
    id: 'stakeholder_update_writer',
    title: 'Stakeholder Update Writer',
    description: 'Writes concise updates for leaders, clients, and internal stakeholders.',
    instructions:
      'Lead with status, risks, and next actions. Keep wording credible, restrained, and operationally precise.',
  },
  {
    id: 'sales_followup_closer',
    title: 'Sales Follow-up Closer',
    description: 'Handles polished follow-ups, reminders, and deal-progress communication.',
    instructions:
      'Be persuasive but controlled. Keep momentum without sounding pushy or generic.',
  },
  {
    id: 'support_escalation_handler',
    title: 'Support Escalation Handler',
    description: 'Responds to sensitive issues with calm, clear, and accountable language.',
    instructions:
      'Acknowledge the issue, clarify ownership, and propose concrete next steps without overpromising.',
  },
  {
    id: 'executive_briefing_mode',
    title: 'Executive Briefing Mode',
    description: 'Optimizes outputs for fast leadership review and decision making.',
    instructions:
      'Default to short, high-signal summaries with clear recommendations, risks, and unresolved items.',
  },
  {
    id: 'bilingual_operator',
    title: 'Bilingual Operator',
    description: 'Handles French and English communication with consistent quality.',
    instructions:
      'Match the user language by default, preserve professionalism, and avoid mixed-language outputs unless requested.',
  },
] as const

export const defaultAssistantProfile: AssistantProfile = {
  executiveMode: true,
  assistantName: 'CODEX',
  roleDescription: 'Executive AI operator and high-performance digital secretary',
  defaultLanguage: 'fr',
  writingTone: 'executive',
  writingDirectness: 'balanced',
  signatureName: 'AGENCY BINARY',
  signatureBlock: 'AGENCY BINARY\nExecutive Operations',
  executionPolicy: 'auto_low_risk',
  confidenceThreshold: 0.9,
  autoResolveKnownContacts: true,
  schedulingBufferMinutes: 15,
  meetingDefaultDurationMinutes: 30,
  enabledSkills: executiveAssistantSkills.map((skill) => skill.id),
}
