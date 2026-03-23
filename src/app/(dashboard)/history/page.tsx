import { Badge, Card } from '@/components/ui'
import { getDashboardBundle } from '@/lib/dashboard/server'
import { getT, getLang } from '@/lib/lang-server'
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
  create_google_doc: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  ),
}

export default async function HistoryPage() {
  const data = await getDashboardBundle()
  const t = getT()
  const lang = getLang()
  const { executionHistory } = data

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{t.history.eyebrow}</p>
          <h1 className={styles.title}>{t.history.title}</h1>
          <p className={styles.subtitle}>{t.history.subtitle}</p>
        </div>
        <div className={styles.headerBadges}>
          <Badge variant="info">{executionHistory.length} {t.history.records}</Badge>
          <Badge variant={data.source === 'database' ? 'success' : 'warning'}>{data.source}</Badge>
        </div>
      </header>
      <div className={styles.content}>
        <div className={styles.stats}>
          <Card className={styles.statCard}>
            <span className={styles.statValue}>{executionHistory.filter(e => e.status === 'completed').length}</span>
            <span className={styles.statLabel}>{t.history.completed}</span>
          </Card>
          <Card className={styles.statCard}>
            <span className={styles.statValue}>{executionHistory.filter(e => e.status === 'failed').length}</span>
            <span className={styles.statLabel}>{t.history.failed}</span>
          </Card>
          <Card className={styles.statCard}>
            <span className={styles.statValue}>{executionHistory.filter(e => e.status === 'rejected').length}</span>
            <span className={styles.statLabel}>{t.history.rejected}</span>
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
                    <span>{t.history.confidence} {Math.round(item.confidenceScore * 100)}%</span>
                  </div>
                  {item.error && <p className={styles.cardError}>{item.error}</p>}
                </div>
                <Badge variant={statusColors[item.status as keyof typeof statusColors] as 'success' | 'danger' | 'warning' | 'info'}>
                  {item.status}
                </Badge>
              </div>
              <div className={styles.cardFooter}>
                <span className={styles.timestamp}>
                  {new Date(item.executedAt || item.createdAt).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US')}
                </span>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
