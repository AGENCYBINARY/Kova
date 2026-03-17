import Link from 'next/link'
import { Badge, Button, Card } from '@/components/ui'
import { getDashboardBundle } from '@/lib/dashboard/server'
import styles from './page.module.css'

function formatDate(date: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date))
}

export default async function DashboardOverviewPage() {
  const data = await getDashboardBundle()
  const healthyIntegrations = data.integrations.filter((integration) => integration.health === 'healthy').length
  const topPending = data.pendingActions.slice(0, 2)
  const latestHistory = data.executionHistory.slice(0, 4)

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.heroBlock}>
          <div className={styles.heroMeta}>
            <p className={styles.eyebrow}>Workspace Overview</p>
            <Badge variant={data.source === 'database' ? 'success' : 'warning'}>
              {data.source === 'database' ? 'Live Prisma Data' : 'Mock Fallback'}
            </Badge>
          </div>
          <h1 className={styles.title}>Execution command center</h1>
          <p className={styles.subtitle}>
            Un seul écran pour piloter les approbations, surveiller la santé des intégrations et garder un audit propre.
          </p>
          <div className={styles.heroPreview}>
            <div className={styles.previewColumn}>
              <span className={styles.previewLabel}>Queued now</span>
              {topPending.map((action) => (
                <div key={action.id} className={styles.previewItem}>
                  <strong>{action.title}</strong>
                  <span>{action.targetApp}</span>
                </div>
              ))}
            </div>
            <div className={styles.previewColumn}>
              <span className={styles.previewLabel}>Latest result</span>
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
            <Button variant="secondary" size="sm">Review queue</Button>
          </Link>
          <Link href="/chat">
            <Button size="sm">Open chat</Button>
          </Link>
        </div>
      </header>

      <section className={styles.metrics}>
        <Card variant="bordered" className={styles.metricCard}>
          <span className={styles.metricLabel}>Pending approvals</span>
          <strong className={styles.metricValue}>{data.metrics.pending}</strong>
          <span className={styles.metricHint}>External actions waiting on review</span>
        </Card>
        <Card variant="bordered" className={styles.metricCard}>
          <span className={styles.metricLabel}>Connected apps</span>
          <strong className={styles.metricValue}>{data.metrics.connectedIntegrations}</strong>
          <span className={styles.metricHint}>{healthyIntegrations} healthy, 1 needs attention</span>
        </Card>
        <Card variant="bordered" className={styles.metricCard}>
          <span className={styles.metricLabel}>Completed today</span>
          <strong className={styles.metricValue}>{data.metrics.completedToday}</strong>
          <span className={styles.metricHint}>Executed successfully in the last run window</span>
        </Card>
        <Card variant="bordered" className={styles.metricCard}>
          <span className={styles.metricLabel}>Failure rate</span>
          <strong className={styles.metricValue}>{data.metrics.failureRate}%</strong>
          <span className={styles.metricHint}>Based on the current audit sample</span>
        </Card>
      </section>

      <section className={styles.grid}>
        <Card variant="bordered" className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2 className={styles.panelTitle}>Approval queue</h2>
              <p className={styles.panelSubtitle}>Most urgent actions waiting on a decision.</p>
            </div>
            <Link href="/actions" className={styles.inlineLink}>
              View queue
            </Link>
          </div>
          <div className={styles.stack}>
            {data.pendingActions.map((action) => (
              <div key={action.id} className={styles.row}>
                <div>
                  <p className={styles.rowTitle}>{action.title}</p>
                  <p className={styles.rowMeta}>
                    {action.targetApp} · Confidence {Math.round(action.confidenceScore * 100)}%
                  </p>
                </div>
                <Badge variant={action.riskLevel === 'high' ? 'danger' : action.riskLevel === 'medium' ? 'warning' : 'success'}>
                  {action.riskLevel} risk
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="bordered" className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2 className={styles.panelTitle}>Integration health</h2>
              <p className={styles.panelSubtitle}>Connection status for each execution surface.</p>
            </div>
            <Link href="/integrations" className={styles.inlineLink}>
              Manage apps
            </Link>
          </div>
          <div className={styles.stack}>
            {data.integrations.map((integration) => (
              <div key={integration.id} className={styles.row}>
                <div>
                  <p className={styles.rowTitle}>{integration.name}</p>
                  <p className={styles.rowMeta}>{integration.shortDescription}</p>
                </div>
                <Badge
                  variant={
                    integration.status === 'connected'
                      ? integration.health === 'warning'
                        ? 'warning'
                        : 'success'
                      : 'default'
                  }
                >
                  {integration.status}
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="bordered" className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2 className={styles.panelTitle}>Recent execution log</h2>
              <p className={styles.panelSubtitle}>Latest completed, failed, or rejected actions.</p>
            </div>
            <Link href="/history" className={styles.inlineLink}>
              Open history
            </Link>
          </div>
          <div className={styles.stack}>
            {latestHistory.map((item) => (
              <div key={item.id} className={styles.row}>
                <div>
                  <p className={styles.rowTitle}>{item.title}</p>
                  <p className={styles.rowMeta}>{item.details}</p>
                </div>
                <Badge
                  variant={
                    item.status === 'completed'
                      ? 'success'
                      : item.status === 'failed'
                        ? 'danger'
                        : 'warning'
                  }
                >
                  {item.status}
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="bordered" className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2 className={styles.panelTitle}>Operator feed</h2>
              <p className={styles.panelSubtitle}>Short events to keep the workspace readable.</p>
            </div>
          </div>
          <div className={styles.activityList}>
            {data.approvalActivity.map((item) => (
              <div key={item.id} className={styles.activityItem}>
                <span className={styles.activityDot} />
                <div>
                  <p className={styles.rowTitle}>{item.label}</p>
                  <p className={styles.rowMeta}>{item.description}</p>
                  <span className={styles.timestamp}>{formatDate(item.at)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </div>
  )
}
