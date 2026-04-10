import Link from 'next/link'
import { Badge, Card } from '@/components/ui'
import { buttonClassNames } from '@/components/ui/button-classes'
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

/**
 * Single server module for /dashboard (hero + panels). Avoids split boundaries and duplicate data shaping.
 */
export function DashboardOverview({ data }: { data: DashboardBundle }) {
  const t = getT()
  const lang = getLang()
  const locale = lang === 'fr' ? 'fr-FR' : 'en-US'

  const metrics = data.metrics ?? {
    pending: 0,
    connectedIntegrations: 0,
    completedToday: 0,
    failureRate: 0,
  }
  const integrations = Array.isArray(data.integrations) ? data.integrations : []
  const pendingActions = Array.isArray(data.pendingActions) ? data.pendingActions : []
  const executionHistory = Array.isArray(data.executionHistory) ? data.executionHistory : []
  const approvalActivity = Array.isArray(data.approvalActivity) ? data.approvalActivity : []

  const healthyIntegrations = integrations.filter((i) => i.health === 'healthy').length
  const attentionCount = integrations.filter((i) => i.health !== 'healthy').length
  const topPending = pendingActions.slice(0, 2)
  const latestHistory = executionHistory.slice(0, 4)

  const latestHistoryPreview = latestHistory.slice(0, 2)
  const latestHistoryGrid = executionHistory.slice(0, 4)
  const pendingGrid = pendingActions.slice(0, 6)
  const integrationRows = integrations.slice(0, 6)

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.heroBlock}>
          <div className={styles.heroMeta}>
            <p className={styles.eyebrow}>{t.dashboard.eyebrow}</p>
            <Badge variant={data.source === 'database' ? 'success' : 'warning'}>
              {data.source === 'database' ? t.dashboard.liveData : t.dashboard.mockData}
            </Badge>
          </div>
          <h1 className={styles.title}>{t.dashboard.title}</h1>
          <p className={styles.subtitle}>{t.dashboard.subtitle}</p>
          <div className={styles.heroPreview}>
            <div className={styles.previewColumn}>
              <span className={styles.previewLabel}>{t.dashboard.queuedNow}</span>
              {topPending.length > 0 ? (
                topPending.map((action) => (
                  <div key={action.id} className={styles.previewItem}>
                    <strong>{safeText(action.title)}</strong>
                    <span>{safeText(action.targetApp)}</span>
                  </div>
                ))
              ) : (
                <div className={styles.previewEmpty}>
                  {lang === 'fr' ? 'Aucune action en attente immédiate.' : 'No immediate action waiting for review.'}
                </div>
              )}
            </div>
            <div className={styles.previewColumn}>
              <span className={styles.previewLabel}>{t.dashboard.latestResult}</span>
              {latestHistoryPreview.length > 0 ? (
                latestHistoryPreview.map((action) => (
                  <div key={action.id} className={styles.previewItem}>
                    <strong>{safeText(action.title)}</strong>
                    <span>{safeText(action.status)}</span>
                  </div>
                ))
              ) : (
                <div className={styles.previewEmpty}>
                  {lang === 'fr' ? 'Aucun résultat récent disponible.' : 'No recent execution yet.'}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className={styles.headerActions}>
          <Link href="/actions" className={buttonClassNames({ variant: 'secondary', size: 'sm' })}>
            {t.dashboard.reviewQueue}
          </Link>
          <Link href="/chat" className={buttonClassNames({ variant: 'primary', size: 'sm' })}>
            {t.dashboard.openChat}
          </Link>
        </div>
      </header>
      <section className={styles.metrics}>
        <Card variant="bordered" className={styles.metricCard}>
          <span className={styles.metricLabel}>{t.dashboard.pendingApprovals}</span>
          <strong className={styles.metricValue}>{metrics.pending}</strong>
          <span className={styles.metricHint}>{t.dashboard.pendingHint}</span>
        </Card>
        <Card variant="bordered" className={styles.metricCard}>
          <span className={styles.metricLabel}>{t.dashboard.connectedApps}</span>
          <strong className={styles.metricValue}>{metrics.connectedIntegrations}</strong>
          <span className={styles.metricHint}>
            {healthyIntegrations} {lang === 'fr' ? 'saines' : 'healthy'}, {attentionCount}{' '}
            {lang === 'fr' ? (attentionCount > 1 ? 'nécessitent attention' : 'nécessite attention') : attentionCount === 1 ? 'needs attention' : 'need attention'}
          </span>
        </Card>
        <Card variant="bordered" className={styles.metricCard}>
          <span className={styles.metricLabel}>{t.dashboard.completedToday}</span>
          <strong className={styles.metricValue}>{metrics.completedToday}</strong>
          <span className={styles.metricHint}>{t.dashboard.completedHint}</span>
        </Card>
        <Card variant="bordered" className={styles.metricCard}>
          <span className={styles.metricLabel}>{t.dashboard.failureRate}</span>
          <strong className={styles.metricValue}>{metrics.failureRate}%</strong>
          <span className={styles.metricHint}>{t.dashboard.failureHint}</span>
        </Card>
      </section>

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
            {pendingGrid.length > 0 ? (
              pendingGrid.map((action) => (
                <div key={action.id} className={styles.row}>
                  <div>
                    <p className={styles.rowTitle}>{safeText(action.title)}</p>
                    <p className={styles.rowMeta}>
                      {safeText(action.targetApp)} · {t.dashboard.confidence}{' '}
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
                  <p className={styles.rowTitle}>{safeText(integration.name)}</p>
                  <p className={styles.rowMeta}>{safeText(integration.shortDescription)}</p>
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
            {latestHistoryGrid.length > 0 ? (
              latestHistoryGrid.map((item) => (
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
    </div>
  )
}
