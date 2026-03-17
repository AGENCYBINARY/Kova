import { Badge, Card } from '@/components/ui'
import { getDashboardBundle } from '@/lib/dashboard/server'
import styles from './page.module.css'

const statusColors = {
  completed: 'success',
  failed: 'danger',
  rejected: 'warning',
  pending: 'info',
}

const actionIcons: Record<string, JSX.Element> = {
  send_email: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  create_calendar_event: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  update_notion_page: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  create_google_doc: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  ),
  update_google_doc: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 16h6" />
      <path d="M9 12h4" />
    </svg>
  ),
}

export default async function HistoryPage() {
  const data = await getDashboardBundle()
  const { executionHistory } = data

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Audit Trail</p>
          <h1 className={styles.title}>Execution History</h1>
          <p className={styles.subtitle}>
            Chronological log of every approved, rejected, completed, and failed action.
          </p>
        </div>
        <div className={styles.headerBadges}>
          <Badge variant="info">{executionHistory.length} records</Badge>
          <Badge variant={data.source === 'database' ? 'success' : 'warning'}>{data.source}</Badge>
        </div>
      </header>

      <div className={styles.content}>
        <div className={styles.stats}>
          <Card className={styles.statCard}>
            <span className={styles.statValue}>{executionHistory.filter(e => e.status === 'completed').length}</span>
            <span className={styles.statLabel}>Completed</span>
          </Card>
          <Card className={styles.statCard}>
            <span className={styles.statValue}>{executionHistory.filter(e => e.status === 'failed').length}</span>
            <span className={styles.statLabel}>Failed</span>
          </Card>
          <Card className={styles.statCard}>
            <span className={styles.statValue}>{executionHistory.filter(e => e.status === 'rejected').length}</span>
            <span className={styles.statLabel}>Rejected</span>
          </Card>
        </div>

        <div className={styles.list}>
          {executionHistory.map((item) => (
            <Card key={item.id} variant="bordered" className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.iconWrapper} data-status={item.status}>
                  {actionIcons[item.type] || actionIcons.send_email}
                </div>
                <div className={styles.cardInfo}>
                  <h3 className={styles.cardTitle}>{item.title}</h3>
                  <p className={styles.cardDetails}>{item.details}</p>
                  <div className={styles.meta}>
                    <span>{item.targetApp}</span>
                    <span className={styles.metaDivider} />
                    <span>Confidence {Math.round(item.confidenceScore * 100)}%</span>
                  </div>
                  {item.error && (
                    <p className={styles.cardError}>{item.error}</p>
                  )}
                </div>
                <Badge variant={statusColors[item.status as keyof typeof statusColors] as any}>
                  {item.status}
                </Badge>
              </div>
              <div className={styles.cardFooter}>
                <span className={styles.timestamp}>
                  {new Date(item.executedAt || item.createdAt).toLocaleString()}
                </span>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
