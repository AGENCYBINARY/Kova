import { Badge, Button, Card } from '@/components/ui'
import { getDashboardBundle } from '@/lib/dashboard/server'
import styles from './page.module.css'

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

export default async function ActionsPage() {
  const data = await getDashboardBundle()
  const { pendingActions } = data
  const highRiskCount = pendingActions.filter((action) => action.riskLevel === 'high').length
  const averageConfidence =
    pendingActions.length > 0
      ? Math.round((pendingActions.reduce((sum, action) => sum + action.confidenceScore, 0) / pendingActions.length) * 100)
      : 0

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>Approval Workflow</p>
          <h1 className={styles.title}>Actions Queue</h1>
          <p className={styles.subtitle}>
            Review every proposed action before CODEX touches an external system.
          </p>
        </div>
        <div className={styles.headerStats}>
          <Badge variant="warning">{pendingActions.length} pending</Badge>
          <Badge variant={highRiskCount > 0 ? 'danger' : 'success'}>{highRiskCount} high risk</Badge>
          <Badge variant={data.source === 'database' ? 'success' : 'warning'}>{data.source}</Badge>
        </div>
      </header>

      <div className={styles.content}>
        <div className={styles.summary}>
          <Card variant="bordered" className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Queue pressure</span>
            <strong className={styles.summaryValue}>{pendingActions.length}</strong>
            <p className={styles.summaryHint}>Pending actions waiting for a human decision.</p>
          </Card>
          <Card variant="bordered" className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Average confidence</span>
            <strong className={styles.summaryValue}>
              {averageConfidence}%
            </strong>
            <p className={styles.summaryHint}>Model confidence across currently queued proposals.</p>
          </Card>
        </div>

        {pendingActions.length === 0 ? (
          <div className={styles.empty}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            <h3>No pending actions</h3>
            <p>All caught up! New action proposals will appear here.</p>
          </div>
        ) : (
          <div className={styles.list}>
            {pendingActions.map((action) => (
              <Card key={action.id} variant="bordered" className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.iconWrapper}>
                    {actionIcons[action.type] || actionIcons.send_email}
                  </div>
                  <div className={styles.cardInfo}>
                    <h3 className={styles.cardTitle}>{action.title}</h3>
                    <p className={styles.cardDescription}>{action.description}</p>
                    <div className={styles.meta}>
                      <span className={styles.cardTime}>
                        Proposed {new Date(action.createdAt).toLocaleString()}
                      </span>
                      <span className={styles.metaDivider} />
                      <span className={styles.metaText}>{action.targetApp}</span>
                      <span className={styles.metaDivider} />
                      <span className={styles.metaText}>
                        Confidence {Math.round(action.confidenceScore * 100)}%
                      </span>
                    </div>
                  </div>
                  <div className={styles.badges}>
                    <Badge variant="warning">Pending</Badge>
                    <Badge variant={action.riskLevel === 'high' ? 'danger' : action.riskLevel === 'medium' ? 'warning' : 'success'}>
                      {action.riskLevel} risk
                    </Badge>
                  </div>
                </div>
                {action.details && <p className={styles.details}>{action.details}</p>}
                <div className={styles.parameters}>
                  <pre>{JSON.stringify(action.parameters, null, 2)}</pre>
                </div>
                <div className={styles.cardActions}>
                  <Button variant="ghost" size="sm">
                    Modify
                  </Button>
                  <Button variant="danger" size="sm">
                    Reject
                  </Button>
                  <Button variant="primary" size="sm">
                    Approve
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
