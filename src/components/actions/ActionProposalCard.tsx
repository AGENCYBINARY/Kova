'use client'
import { Badge, Button, Card } from '../ui'
import { useLang } from '@/lib/lang-context'
import type { Lang } from '@/lib/i18n'
import styles from './ActionProposalCard.module.css'

/** Matches server-side calendar default (Europe/Paris) so users see local wall time, not raw UTC. */
const CALENDAR_PREVIEW_TZ = 'Europe/Paris'

function formatCalendarDateTimeForPreview(iso: unknown, lang: Lang): string {
  if (typeof iso !== 'string' || !iso.trim()) {
    return '-'
  }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return String(iso)
  }
  const locale = lang === 'en' ? 'en-GB' : 'fr-FR'
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: CALENDAR_PREVIEW_TZ,
      timeZoneName: 'short',
    }).format(d)
  } catch {
    return iso
  }
}

interface ActionProposalCardProps {
  id: string
  type: string
  title: string
  description: string
  parameters: Record<string, unknown>
  onApprove: (id: string) => void
  onReject: (id: string) => void
  loading?: boolean
}

function renderEmailPreview(parameters: Record<string, unknown>, t: ReturnType<typeof useLang>['t']) {
  const recipients = Array.isArray(parameters.to) ? parameters.to.join(', ') : ''
  const subject = typeof parameters.subject === 'string' ? parameters.subject : ''
  const body = typeof parameters.body === 'string' ? parameters.body : ''
  const confidenceScore =
    typeof parameters.confidenceScore === 'number'
      ? `${Math.round(parameters.confidenceScore * 100)}% confidence`
      : null
  return (
    <div className={styles.previewBlock}>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{t.proposal.to}</span>
        <span className={styles.previewValue}>{recipients || t.proposal.noRecipient}</span>
      </div>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{t.proposal.subject}</span>
        <span className={styles.previewValue}>{subject || t.proposal.noSubject}</span>
      </div>
      {confidenceScore ? <div className={styles.previewMeta}>{confidenceScore}</div> : null}
      <div className={styles.previewBody}>{body || t.proposal.emptyBody}</div>
    </div>
  )
}

function renderCalendarPreview(
  parameters: Record<string, unknown>,
  t: ReturnType<typeof useLang>['t'],
  lang: Lang
) {
  const attendees = Array.isArray(parameters.attendees)
    ? parameters.attendees.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : []
  const hasMeet = Boolean(parameters.createMeetLink)
  const startLabel = formatCalendarDateTimeForPreview(parameters.startTime, lang)
  const endLabel = formatCalendarDateTimeForPreview(parameters.endTime, lang)
  return (
    <div className={styles.previewBlock}>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{t.proposal.title}</span>
        <span className={styles.previewValue}>{String(parameters.title || 'Meeting')}</span>
      </div>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{t.proposal.start}</span>
        <span className={styles.previewValue}>{startLabel}</span>
      </div>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{t.proposal.end}</span>
        <span className={styles.previewValue}>{endLabel}</span>
      </div>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{t.proposal.attendees}</span>
        <span className={styles.previewValue}>{attendees.length > 0 ? attendees.join(', ') : t.proposal.noAttendees}</span>
      </div>
      <div className={styles.previewMeta}>{hasMeet ? t.proposal.meetActive : t.proposal.noMeet}</div>
    </div>
  )
}

function renderDrivePreview(parameters: Record<string, unknown>, t: ReturnType<typeof useLang>['t']) {
  const name = typeof parameters.name === 'string' ? parameters.name : 'Untitled file'
  const folderName = typeof parameters.folderName === 'string' ? parameters.folderName : null
  const mimeType = typeof parameters.mimeType === 'string' ? parameters.mimeType : 'text/plain'
  const content = typeof parameters.content === 'string' ? parameters.content : ''
  const isFolder = mimeType === 'application/vnd.google-apps.folder'
  return (
    <div className={styles.previewBlock}>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{isFolder ? t.proposal.folder : t.proposal.name}</span>
        <span className={styles.previewValue}>{name}</span>
      </div>
      {!isFolder ? (
        <div className={styles.previewRow}>
          <span className={styles.previewLabel}>{t.proposal.format}</span>
          <span className={styles.previewValue}>{mimeType}</span>
        </div>
      ) : null}
      {folderName ? (
        <div className={styles.previewRow}>
          <span className={styles.previewLabel}>{t.proposal.location}</span>
          <span className={styles.previewValue}>{folderName}</span>
        </div>
      ) : null}
      {content ? <div className={styles.previewBody}>{content}</div> : null}
    </div>
  )
}

function renderDriveFolderPreview(parameters: Record<string, unknown>, t: ReturnType<typeof useLang>['t']) {
  const folderName =
    typeof parameters.name === 'string'
      ? parameters.name
      : typeof parameters.folderName === 'string'
        ? parameters.folderName
        : 'Untitled folder'
  const parentLabel =
    typeof parameters.parentFolderName === 'string'
      ? parameters.parentFolderName
      : typeof parameters.folderPath === 'string'
        ? parameters.folderPath
        : ''

  return (
    <div className={styles.previewBlock}>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{t.proposal.folder}</span>
        <span className={styles.previewValue}>{folderName}</span>
      </div>
      {parentLabel ? (
        <div className={styles.previewRow}>
          <span className={styles.previewLabel}>{t.proposal.location}</span>
          <span className={styles.previewValue}>{parentLabel}</span>
        </div>
      ) : null}
    </div>
  )
}

function renderDocPreview(parameters: Record<string, unknown>, docLabel: string) {
  const title =
    typeof parameters.title === 'string'
      ? parameters.title
      : typeof parameters.name === 'string'
        ? parameters.name
        : docLabel
  const content =
    typeof parameters.content === 'string'
      ? parameters.content
      : typeof parameters.body === 'string'
        ? parameters.body
        : typeof parameters.prompt === 'string'
          ? parameters.prompt
          : ''

  return (
    <div className={styles.previewBlock}>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>Titre</span>
        <span className={styles.previewValue}>{title}</span>
      </div>
      {content ? <div className={styles.previewBody}>{content}</div> : null}
    </div>
  )
}

function renderNotionPreview(parameters: Record<string, unknown>) {
  const title =
    typeof parameters.title === 'string'
      ? parameters.title
      : typeof parameters.pageTitle === 'string'
        ? parameters.pageTitle
        : typeof parameters.databaseTitle === 'string'
          ? parameters.databaseTitle
          : 'Page Notion'
  const body =
    typeof parameters.content === 'string'
      ? parameters.content
      : typeof parameters.body === 'string'
        ? parameters.body
        : typeof parameters.summary === 'string'
          ? parameters.summary
          : ''

  return (
    <div className={styles.previewBlock}>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>Notion</span>
        <span className={styles.previewValue}>{title}</span>
      </div>
      {body ? <div className={styles.previewBody}>{body}</div> : null}
    </div>
  )
}

function renderGenericActionSummary(parameters: Record<string, unknown>) {
  const visibleEntries = Object.entries(parameters)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 5)

  return (
    <div className={styles.previewBlock}>
      {visibleEntries.map(([key, value]) => (
        <div key={key} className={styles.previewRow}>
          <span className={styles.previewLabel}>{key}</span>
          <span className={styles.previewValue}>
            {Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value)}
          </span>
        </div>
      ))}
    </div>
  )
}

function renderGooglePhotosPickerPreview() {
  return (
    <div className={styles.previewBlock}>
      <div className={styles.previewBody}>
        Open a secure Google Photos picker session so the user can choose the exact media to use.
      </div>
    </div>
  )
}

const actionIcons: Record<string, JSX.Element> = {
  send_email: (
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
  create_google_photos_picker_session: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M19 5 21 3" />
    </svg>
  ),
}

export function ActionProposalCard({ id, type, title, description, parameters, onApprove, onReject, loading }: ActionProposalCardProps) {
  const { t, lang } = useLang()

  const renderPreview = () => {
    if (type === 'send_email' || type === 'create_gmail_draft' || type === 'update_gmail_draft' || type === 'reply_to_email' || type === 'forward_email') {
      return renderEmailPreview(parameters, t)
    }
    if (type === 'create_calendar_event' || type === 'update_calendar_event') return renderCalendarPreview(parameters, t, lang)
    if (type === 'create_google_drive_file') return renderDrivePreview(parameters, t)
    if (type === 'create_google_drive_folder') return renderDriveFolderPreview(parameters, t)
    if (type === 'create_google_doc' || type === 'update_google_doc') return renderDocPreview(parameters, 'Google Doc')
    if (type === 'create_notion_page' || type === 'update_notion_page' || type === 'update_notion_page_properties' || type === 'archive_notion_page') {
      return renderNotionPreview(parameters)
    }
    if (type === 'create_google_photos_picker_session') return renderGooglePhotosPickerPreview()
    return renderGenericActionSummary(parameters)
  }

  return (
    <Card variant="bordered" className={styles.card}>
      <div className={styles.header}>
        <div className={styles.iconWrapper}>
          {actionIcons[type] || actionIcons.send_email}
        </div>
        <div className={styles.headerContent}>
          <h3 className={styles.title}>{title}</h3>
          <Badge variant="warning" size="sm">{t.proposal.pendingApproval}</Badge>
        </div>
      </div>
      <p className={styles.description}>{description}</p>
      {renderPreview()}
      <div className={styles.actions}>
        <Button variant="danger" size="sm" onClick={() => onReject(id)} disabled={loading}>
          {t.proposal.reject}
        </Button>
        <Button variant="primary" size="sm" onClick={() => onApprove(id)} disabled={loading} loading={loading}>
          {t.proposal.approve}
        </Button>
      </div>
    </Card>
  )
}
