import type { JSX } from 'react'

/** Icons for action types in approval queue, chat proposals, and dashboard lists. */
export const actionTypeIcons: Record<string, JSX.Element> = {
  send_email: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  create_gmail_draft: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  create_calendar_event: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  create_notion_page: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  ),
  create_google_drive_file: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 3h6l5 9-5 9H9l-5-9 5-9z" />
      <path d="M9 3 4 12M15 3l5 9M7 16h10" />
    </svg>
  ),
  create_google_doc: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  ),
  create_google_photos_picker_session: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M19 5 21 3" />
    </svg>
  ),
}

export function iconForActionType(type: string): JSX.Element {
  if (actionTypeIcons[type]) {
    return actionTypeIcons[type]
  }
  if (type.includes('notion')) {
    return actionTypeIcons.create_notion_page
  }
  if (type.includes('calendar')) {
    return actionTypeIcons.create_calendar_event
  }
  if (type.includes('gmail') || type.includes('email') || type === 'reply_to_email' || type === 'forward_email') {
    return actionTypeIcons.send_email
  }
  if (type.includes('google_doc')) {
    return actionTypeIcons.create_google_doc
  }
  if (type.includes('google_drive') || type.includes('google_photos')) {
    return actionTypeIcons.create_google_drive_file
  }
  return actionTypeIcons.send_email
}
