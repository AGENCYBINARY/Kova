'use client'

import Link from 'next/link'
import { Badge, Button, Card } from '@/components/ui'
import { useLang } from '@/lib/lang-context'
import type { DashboardBundle } from '@/lib/dashboard/server'
import styles from '@/app/(dashboard)/dashboard/page.module.css'

function formatDate(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date))
}

export function DashboardOverviewClient({ data }: { data: DashboardBundle }) {
  const { t, lang } = useLang()
  const locale = lang === 'fr' ? 'fr-FR' : 'en-US'
  const healthyIntegrations = data.integrations.filter((integration) => integration.health === 'healthy').length
  const topPending = data.pendingActions.slice(0, 2)
  const latestHistory = data.executionHistory.slice(0, 4)

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
              {topPending.map((action) => (
                <div key={action.id} className={styles.previewItem}>
                  <strong>{action.title}</strong>
                  <span>{action.targetApp}</span>
                </div>
              ))}
            </div>
            <div className={styles.previewColumn}>
              <span className={styles.previewLabel}>{t.dashboard.latestResult}</span>
              {latestHistory.slice(0, 2).map((action) => (
                <div key={action.id} className={styles.previewItem}>
                  <strong>{action.title}</strong>
                  <span>{action.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className={styles.headerActions}>
          <Link href="/actions">
            <Button variant="secondary" size="sm">{t.dashboard.reviewQueue}</Button>
          </Link>
          <Link href="/chat">
            <Button size="sm">{t.dashboard.openChat}</Button>
          </Link>
        </div>
      </header>
      <section className={styles.metrics}>
        <Card variant="bordered" className={styles.metricCard}>
          <span className={styles.metricLabel}>{t.dashboard.pendingApprovals}</span>
          <strong className={styles.metricValue}>{data.metrics.pending}</strong>
          <span className={styles.metricHint}>{t.dashboard.pendingHint}</span>
        </Card>
        <Card variant="bordered" className={styles.metricCard}>
          <span className={styles.metricLabel}>{t.dashboard.connectedApps}</span>
          <strong className={styles.metricValue}>{data.metrics.connectedIntegrations}</strong>
          <span className={styles.metricHint}>
            {healthyIntegrations} {lang === 'fr' ? 'saines' : 'healthy'}, 1 {lang === 'fr' ? 'nécessite attention' : 'needs attention'}
          </span>
        </Card>
        <Card variant="bordered" className={styles.metricCard}>
          <span className={styles.metricLabel}>{t.dashboard.completedToday}</span>
          <strong className={styles.metricValue}>{data.metrics.completedToday}</strong>
          <span className={styles.metricHint}>{t.dashboard.completedHint}</span>
        </Card>
        <Card variant="bordered" className={styles.metricCard}>
          <span className={styles.metricLabel}>{t.dashboard.failureRate}</span>
          <strong className={styles.metricValue}>{data.metrics.failureRate}%</strong>
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
            <Link href="/actions" className={styles.inlineLink}>{t.dashboard.viewQueue}</Link>
          </div>
          <div className={styles.stack}>
            {data.pendingActions.map((action) => (
              <div key={action.id} className={styles.row}>
                <div>
                  <p className={styles.rowTitle}>{action.title}</p>
                  <p className={styles.rowMeta}>
                    {action.targetApp} · {t.dashboard.confidence} {Math.round(action.confidenceScore * 100)}%
                  </p>
                </div>
                <Badge variant={action.riskLevel === 'high' ? 'danger' : action.riskLevel === 'medium' ? 'warning' : 'success'}>
                  {action.riskLevel} {t.dashboard.risk}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
        <Card variant="bordered" className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2 className={styles.panelTitle}>{t.dashboard.integrationHealth}</h2>
              <p className={styles.panelSubtitle}>{t.dashboard.integrationHealthSub}</p>
            </div>
            <Link href="/integrations" className={styles.inlineLink}>{t.dashboard.manageApps}</Link>
          </div>
          <div className={styles.stack}>
            {data.integrations.map((integration) => (
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
            <Link href="/history" className={styles.inlineLink}>{t.dashboard.openHistory}</Link>
          </div>
          <div className={styles.stack}>
            {latestHistory.map((item) => (
              <div key={item.id} className={styles.row}>
                <div>
                  <p className={styles.rowTitle}>{item.title}</p>
                  <p className={styles.rowMeta}>{item.details}</p>
                </div>
                <Badge variant={item.status === 'completed' ? 'success' : item.status === 'failed' ? 'danger' : 'warning'}>
                  {item.status}
                </Badge>
              </div>
            ))}
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
            {data.approvalActivity.map((item) => (
              <div key={item.id} className={styles.activityItem}>
                <span className={styles.activityDot} />
                <div>
                  <p className={styles.rowTitle}>{item.label}</p>
                  <p className={styles.rowMeta}>{item.description}</p>
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
