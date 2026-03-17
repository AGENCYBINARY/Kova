'use client'

import { Badge, Button, Card } from '../ui'
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

function renderEmailPreview(parameters: Record<string, unknown>) {
  const recipients = Array.isArray(parameters.to) ? parameters.to.join(', ') : ''
  const subject = typeof parameters.subject === 'string' ? parameters.subject : ''
  const body = typeof parameters.body === 'string' ? parameters.body : ''
  const confidenceScore =
    typeof parameters.confidenceScore === 'number' ? `${Math.round(parameters.confidenceScore * 100)}% confidence` : null

  return (
    <div className={styles.previewBlock}>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>A</span>
        <span className={styles.previewValue}>{recipients || 'Destinataire manquant'}</span>
      </div>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>Objet</span>
        <span className={styles.previewValue}>{subject || 'Sans objet'}</span>
      </div>
      {confidenceScore ? (
        <div className={styles.previewMeta}>{confidenceScore}</div>
      ) : null}
      <div className={styles.previewBody}>{body || 'Contenu vide'}</div>
    </div>
  )
}

function renderCalendarPreview(parameters: Record<string, unknown>) {
  const attendees = Array.isArray(parameters.attendees)
    ? parameters.attendees.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : []
  const hasMeet = Boolean(parameters.createMeetLink)

  return (
    <div className={styles.previewBlock}>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>Titre</span>
        <span className={styles.previewValue}>{String(parameters.title || 'Meeting')}</span>
      </div>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>Début</span>
        <span className={styles.previewValue}>{String(parameters.startTime || '-')}</span>
      </div>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>Fin</span>
        <span className={styles.previewValue}>{String(parameters.endTime || '-')}</span>
      </div>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>Invités</span>
        <span className={styles.previewValue}>{attendees.length > 0 ? attendees.join(', ') : 'Aucun invité résolu'}</span>
      </div>
      <div className={styles.previewMeta}>{hasMeet ? 'Google Meet actif' : 'Sans lien de visio'}</div>
    </div>
  )
}

function renderProposalPreview(type: string, parameters: Record<string, unknown>) {
  if (type === 'send_email') {
    return renderEmailPreview(parameters)
  }

  if (type === 'create_calendar_event') {
    return renderCalendarPreview(parameters)
  }

  return (
    <div className={styles.parametersCompact}>
      <pre className={styles.paramsJson}>{JSON.stringify(parameters, null, 2)}</pre>
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
  update_notion_page: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
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
  update_google_doc: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 16h6" />
      <path d="M9 12h4" />
    </svg>
  ),
}

export function ActionProposalCard({
  id,
  type,
  title,
  description,
  parameters,
  onApprove,
  onReject,
  loading,
}: ActionProposalCardProps) {
  return (
    <Card variant="bordered" className={styles.card}>
      <div className={styles.header}>
        <div className={styles.iconWrapper}>
          {actionIcons[type] || actionIcons.send_email}
        </div>
        <div className={styles.headerContent}>
          <h3 className={styles.title}>{title}</h3>
          <Badge variant="warning" size="sm">
            Pending Approval
          </Badge>
        </div>
      </div>

      <p className={styles.description}>{description}</p>

      {renderProposalPreview(type, parameters)}

      <div className={styles.actions}>
        <Button
          variant="danger"
          size="sm"
          onClick={() => onReject(id)}
          disabled={loading}
        >
          Non
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => onApprove(id)}
          disabled={loading}
          loading={loading}
        >
          Oui, exécuter
        </Button>
      </div>
    </Card>
  )
}
