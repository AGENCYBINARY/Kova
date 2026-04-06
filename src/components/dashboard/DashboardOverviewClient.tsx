'use client'

import Link from 'next/link'
import { Badge, Button, Card } from '@/components/ui'
import { DashboardOverviewGrid } from '@/components/dashboard/DashboardOverviewGrid'
import { useLang } from '@/lib/lang-context'
import type { DashboardBundle } from '@/lib/dashboard/server'
import styles from '@/app/(dashboard)/dashboard/page.module.css'

export function DashboardOverviewClient({ data }: { data: DashboardBundle }) {
  const { t, lang } = useLang()
  const healthyIntegrations = data.integrations.filter((integration) => integration.health === 'healthy').length
  const attentionCount = data.integrations.filter((integration) => integration.health !== 'healthy').length
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
              {topPending.length > 0 ? (
                topPending.map((action) => (
                  <div key={action.id} className={styles.previewItem}>
                    <strong>{action.title}</strong>
                    <span>{action.targetApp}</span>
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
              {latestHistory.slice(0, 2).length > 0 ? (
                latestHistory.slice(0, 2).map((action) => (
                  <div key={action.id} className={styles.previewItem}>
                    <strong>{action.title}</strong>
                    <span>{action.status}</span>
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
          <Link href="/actions" prefetch={false}>
            <Button variant="secondary" size="sm">
              {t.dashboard.reviewQueue}
            </Button>
          </Link>
          <Link href="/chat" prefetch={false}>
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
            {healthyIntegrations} {lang === 'fr' ? 'saines' : 'healthy'}, {attentionCount}{' '}
            {lang === 'fr' ? (attentionCount > 1 ? 'nécessitent attention' : 'nécessite attention') : attentionCount === 1 ? 'needs attention' : 'need attention'}
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
      <DashboardOverviewGrid data={data} />
    </div>
  )
}
