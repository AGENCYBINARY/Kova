'use client'

import Link from 'next/link'
import { Badge, Card } from '@/components/ui'
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

export function DashboardOverviewGrid({ data }: { data: DashboardBundle }) {
  const { t, lang } = useLang()
  const locale = lang === 'fr' ? 'fr-FR' : 'en-US'
  const latestHistory = data.executionHistory.slice(0, 4)

  return (
    <section className={styles.grid}>
      <Card variant="bordered" className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>{t.dashboard.approvalQueue}</h2>
            <p className={styles.panelSubtitle}>{t.dashboard.approvalQueueSub}</p>
          </div>
          <Link href="/actions" className={styles.inlineLink} prefetch={false}>
            {t.dashboard.viewQueue}
          </Link>
        </div>
        <div className={styles.stack}>
          {data.pendingActions.length > 0 ? (
            data.pendingActions.map((action) => (
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
          <Link href="/integrations" className={styles.inlineLink} prefetch={false}>
            {t.dashboard.manageApps}
          </Link>
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
          <Link href="/history" className={styles.inlineLink} prefetch={false}>
            {t.dashboard.openHistory}
          </Link>
        </div>
        <div className={styles.stack}>
          {latestHistory.length > 0 ? (
            latestHistory.map((item) => (
              <div key={item.id} className={styles.row}>
                <div>
                  <p className={styles.rowTitle}>{item.title}</p>
                  <p className={styles.rowMeta}>{item.details}</p>
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
  )
}
