import Link from 'next/link'
import { Badge, Card } from '@/components/ui'
import { getLang, getT } from '@/lib/lang-server'
import type { DashboardBundle } from '@/lib/dashboard/server'
import styles from '@/app/(dashboard)/dashboard/page.module.css'

function formatDate(date: string, locale: string) {
  if (!date || typeof date !== 'string') {
    return '—'
  }
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) {
    return '—'
  }
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d)
  } catch {
    return '—'
  }
}

function safeText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return String(value)
  } catch {
    return ''
  }
}

export function DashboardOverviewGrid({ data }: { data: DashboardBundle }) {
  const t = getT()
  const lang = getLang()
  const locale = lang === 'fr' ? 'fr-FR' : 'en-US'
  const executionHistory = Array.isArray(data.executionHistory) ? data.executionHistory : []
  const pendingActionsRaw = Array.isArray(data.pendingActions) ? data.pendingActions : []
  const integrations = Array.isArray(data.integrations) ? data.integrations : []
  const approvalActivity = Array.isArray(data.approvalActivity) ? data.approvalActivity : []

  const latestHistory = executionHistory.slice(0, 4)
  const pendingActions = pendingActionsRaw.slice(0, 6)
  const integrationRows = integrations.slice(0, 6)

  return (
    <section className={styles.grid}>
      <Card variant="bordered" className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>{t.dashboard.approvalQueue}</h2>
            <p className={styles.panelSubtitle}>{t.dashboard.approvalQueueSub}</p>
          </div>
          <Link href="/actions" className={styles.inlineLink}>
            {t.dashboard.viewQueue}
          </Link>
        </div>
        <div className={styles.stack}>
          {pendingActions.length > 0 ? (
            pendingActions.map((action) => (
              <div key={action.id} className={styles.row}>
                <div>
                  <p className={styles.rowTitle}>{safeText(action.title)}</p>
                  <p className={styles.rowMeta}>
                    {action.targetApp} · {t.dashboard.confidence}{' '}
                    {typeof action.confidenceScore === 'number' && !Number.isNaN(action.confidenceScore)
                      ? Math.round(action.confidenceScore * 100)
                      : 0}
                    %
                  </p>
                </div>
                <Badge variant={action.riskLevel === 'high' ? 'danger' : action.riskLevel === 'medium' ? 'warning' : 'success'}>
                  {action.riskLevel} {t.dashboard.risk}
                </Badge>
              </div>
            ))
          ) : (
            <p className={styles.emptyNote}>
              {lang === 'fr' ? 'Aucune action en attente. La file est propre.' : 'No action is waiting for review. The queue is clear.'}
            </p>
          )}
        </div>
      </Card>
      <Card variant="bordered" className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>{t.dashboard.integrationHealth}</h2>
            <p className={styles.panelSubtitle}>{t.dashboard.integrationHealthSub}</p>
          </div>
          <Link href="/integrations" className={styles.inlineLink}>
            {t.dashboard.manageApps}
          </Link>
        </div>
        <div className={styles.stack}>
          {integrationRows.map((integration) => (
            <div key={integration.id} className={styles.row}>
              <div>
                <p className={styles.rowTitle}>{integration.name}</p>
                <p className={styles.rowMeta}>{integration.shortDescription}</p>
              </div>
              <Badge variant={integration.status === 'connected' ? integration.health === 'warning' ? 'warning' : 'success' : 'default'}>
                {integration.status}
              </Badge>
            </div>
          ))}
        </div>
      </Card>
      <Card variant="bordered" className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>{t.dashboard.recentLog}</h2>
            <p className={styles.panelSubtitle}>{t.dashboard.recentLogSub}</p>
          </div>
          <Link href="/history" className={styles.inlineLink}>
            {t.dashboard.openHistory}
          </Link>
        </div>
        <div className={styles.stack}>
          {latestHistory.length > 0 ? (
            latestHistory.map((item) => (
              <div key={item.id} className={styles.row}>
                <div>
                  <p className={styles.rowTitle}>{safeText(item.title)}</p>
                  <p className={styles.rowMeta}>{safeText(item.details)}</p>
                </div>
                <Badge
                  variant={
                    item.status === 'completed'
                      ? 'success'
                      : item.status === 'compensated'
                        ? 'info'
                        : item.status === 'failed'
                          ? 'danger'
                          : 'warning'
                  }
                >
                  {item.status}
                </Badge>
              </div>
            ))
          ) : (
            <p className={styles.emptyNote}>
              {lang === 'fr' ? 'Aucune exécution récente à afficher.' : 'No recent execution to display.'}
            </p>
          )}
        </div>
      </Card>
      <Card variant="bordered" className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>{t.dashboard.operatorFeed}</h2>
            <p className={styles.panelSubtitle}>{t.dashboard.operatorFeedSub}</p>
          </div>
        </div>
        <div className={styles.activityList}>
          {approvalActivity.map((item) => (
            <div key={item.id} className={styles.activityItem}>
              <span className={styles.activityDot} />
              <div>
                <p className={styles.rowTitle}>{safeText(item.label)}</p>
                <p className={styles.rowMeta}>{safeText(item.description)}</p>
                <span className={styles.timestamp}>{formatDate(item.at, locale)}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </section>
  )
}
