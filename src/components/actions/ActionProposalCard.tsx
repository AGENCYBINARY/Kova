'use client'
import { Badge, Button, Card } from '../ui'
import { useLang } from '@/lib/lang-context'
import styles from './ActionProposalCard.module.css'

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

function renderCalendarPreview(parameters: Record<string, unknown>, t: ReturnType<typeof useLang>['t']) {
  const attendees = Array.isArray(parameters.attendees)
    ? parameters.attendees.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : []
  const hasMeet = Boolean(parameters.createMeetLink)
  return (
    <div className={styles.previewBlock}>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{t.proposal.title}</span>
        <span className={styles.previewValue}>{String(parameters.title || 'Meeting')}</span>
      </div>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{t.proposal.start}</span>
        <span className={styles.previewValue}>{String(parameters.startTime || '-')}</span>
      </div>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{t.proposal.end}</span>
        <span className={styles.previewValue}>{String(parameters.endTime || '-')}</span>
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
}

export function ActionProposalCard({ id, type, title, description, parameters, onApprove, onReject, loading }: ActionProposalCardProps) {
  const { t } = useLang()

  const renderPreview = () => {
    if (type === 'send_email') return renderEmailPreview(parameters, t)
    if (type === 'create_calendar_event') return renderCalendarPreview(parameters, t)
    if (type === 'create_google_drive_file') return renderDrivePreview(parameters, t)
    return (
      <div className={styles.parametersCompact}>
        <pre className={styles.paramsJson}>{JSON.stringify(parameters, null, 2)}</pre>
      </div>
    )
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
