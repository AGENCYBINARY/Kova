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
  {
    id: 'gmail_thread_responder',
    title: 'Gmail Thread Responder',
    description: 'Handles Gmail replies with thread awareness, answer discipline, and next-step clarity.',
    instructions:
      'When replying to Gmail threads, preserve the actual thread intent, answer open questions explicitly, keep the reply shorter than the inbound email unless detail is required, and do not invent context that is not present in the thread.',
  },
  {
    id: 'gmail_followup_detector',
    title: 'Gmail Follow-up Detector',
    description: 'Finds unanswered threads, stale outreach, and follow-up opportunities in inbox workflows.',
    instructions:
      'Surface overdue replies, detect unanswered outbound messages, and suggest concise follow-ups with a clear requested next step instead of vague nudges.',
  },
  {
    id: 'calendar_rescheduler',
    title: 'Calendar Rescheduler',
    description: 'Updates or moves events cleanly when timing, attendees, or meeting intent changes.',
    instructions:
      'When an event must move, keep the title professional, preserve the attendee list unless the user says otherwise, and avoid partial changes that would leave the meeting in an inconsistent state.',
  },
  {
    id: 'calendar_agenda_planner',
    title: 'Calendar Agenda Planner',
    description: 'Turns meeting requests into events with clear purpose, structure, and prep notes.',
    instructions:
      'When preparing a meeting, infer a concrete outcome, add a short decision-oriented description, and keep titles specific enough to be scannable in a crowded calendar.',
  },
  {
    id: 'google_drive_filing_operator',
    title: 'Google Drive Filing Operator',
    description: 'Creates and stores files in Drive with clean naming and predictable organization.',
    instructions:
      'Prefer durable file names, create structure that is easy to find later, and mention the intended folder or parent context whenever the request implies storage rather than just document creation.',
  },
  {
    id: 'google_docs_revision_editor',
    title: 'Google Docs Revision Editor',
    description: 'Updates Google Docs with structured edits instead of dumping raw text into documents.',
    instructions:
      'When editing a doc, rewrite for readability, preserve document intent, and prefer crisp sections, headings, and summaries over note-like text blocks.',
  },
  {
    id: 'notion_operations_writer',
    title: 'Notion Operations Writer',
    description: 'Creates and updates Notion pages with operational structure that works for teams.',
    instructions:
      'Use actionable headings, status-oriented writing, concise summaries, and explicit owners or next steps when the request is operational, planning, or project related.',
  },
  {
    id: 'cross_app_execution_planner',
    title: 'Cross-app Execution Planner',
    description: 'Coordinates work that spans email, calendar, docs, Drive, and Notion without dropping context.',
    instructions:
      'When a request spans multiple apps, sequence actions in a sensible order, reuse context across proposals, and avoid duplicated work or mismatched titles between the tools involved.',
  },
  {
    id: 'approval_safety_reviewer',
    title: 'Approval Safety Reviewer',
    description: 'Distinguishes low-risk execution from actions that should stay behind review.',
    instructions:
      'Treat outbound external communication, destructive changes, and ambiguous edits as review-sensitive. Keep proposals precise enough that the user can approve them quickly and safely.',
  },
  {
    id: 'integration_connection_diagnostician',
    title: 'Integration Connection Diagnostician',
    description: 'Explains plainly when a connected app is missing, expired, or unable to execute the requested work.',
    instructions:
      'If a requested app action cannot run because the integration is disconnected, missing, or expired, say so directly, identify the specific app, and do not pretend the action is executable.',
  },
] as const

export const executiveAssistantSkillIds: string[] = executiveAssistantSkills.map((skill) => skill.id)

export function resolveEnabledAssistantSkills(input: unknown): string[] {
  const allowed = new Set(executiveAssistantSkillIds)
  const selected =
    Array.isArray(input)
      ? input.filter((skillId): skillId is string => typeof skillId === 'string' && allowed.has(skillId))
      : []

  return selected.length > 0 ? selected : [...executiveAssistantSkillIds]
}

export const defaultAssistantProfile: AssistantProfile = {
  executiveMode: true,
  assistantName: 'Kova',
  roleDescription: 'Executive AI operator across Gmail, Calendar, Docs, Drive, and Notion',
  defaultLanguage: 'fr',
  writingTone: 'executive',
  writingDirectness: 'balanced',
  signatureName: 'AGENCY BINARY',
  signatureBlock: 'AGENCY BINARY\nExecutive Operations',
  executionPolicy: 'auto_low_risk',
  confidenceThreshold: 0.75,
  autoResolveKnownContacts: true,
  schedulingBufferMinutes: 15,
  meetingDefaultDurationMinutes: 30,
  enabledSkills: [...executiveAssistantSkillIds],
}
