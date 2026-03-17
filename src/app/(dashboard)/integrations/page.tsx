import { Badge, Card } from '@/components/ui'
import { IntegrationActions } from '@/components/integrations/IntegrationActions'
import { getDashboardBundle } from '@/lib/dashboard/server'
import styles from './page.module.css'

interface IntegrationsPageProps {
  searchParams?: {
    connected?: string
    error?: string
  }
}

const providerLabels: Record<string, string> = {
  google: 'Google',
  notion: 'Notion',
}

export default async function IntegrationsPage({ searchParams }: IntegrationsPageProps) {
  const data = await getDashboardBundle()
  const connectedCount = data.integrations.filter((integration) => integration.status === 'connected').length
  const connectedParam = searchParams?.connected
  const errorParam = searchParams?.error
  const successMessage = connectedParam
    ? `Connected ${providerLabels[connectedParam] ?? connectedParam}`
    : null
  const errorMessage = errorParam ? `An error occurred during ${errorParam.replace(/_/g, ' ')}` : null

  return (
    <div className={styles.container}>
      {successMessage || errorMessage ? (
        <div
          className={`${styles.alert} ${successMessage ? styles.alertSuccess : styles.alertError}`}
        >
          {successMessage ?? errorMessage}
        </div>
      ) : null}

      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>App Surfaces</p>
          <h1 className={styles.title}>Integrations</h1>
          <p className={styles.subtitle}>
            Control which tools the agent can reach across Gmail, Notion, Google Calendar, and Google Docs.
          </p>
        </div>
        <div className={styles.headerBadges}>
          <Badge variant="success">{connectedCount} connected</Badge>
          <Badge variant={data.source === 'database' ? 'success' : 'warning'}>{data.source}</Badge>
        </div>
      </header>

      <div className={styles.content}>
        <div className={styles.summaryBar}>
          <Card variant="bordered" className={styles.summaryCard}>
            <strong>{connectedCount}</strong>
            <span>active integrations</span>
          </Card>
          <Card variant="bordered" className={styles.summaryCard}>
            <strong>{data.integrations.filter((integration) => integration.health !== 'healthy').length}</strong>
            <span>need attention</span>
          </Card>
        </div>
        <div className={styles.grid}>
          {data.integrations.map((integration) => (
            <Card key={integration.id} variant="bordered" className={styles.card}>
              <div className={styles.cardHeader}>
                <div
                  className={styles.iconWrapper}
                  style={{ backgroundColor: `${integration.color}20` }}
                >
                  <span className={styles.icon}>{integration.icon}</span>
                </div>
                  <div className={styles.cardInfo}>
                    <h3 className={styles.cardTitle}>{integration.name}</h3>
                    <p className={styles.cardDescription}>{integration.description}</p>
                  </div>
                  <Badge variant={integration.health === 'healthy' ? 'success' : integration.health === 'warning' ? 'warning' : 'default'} size="sm">
                    {integration.health}
                  </Badge>
                </div>

              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>Status</span>
                <Badge
                  variant={
                    integration.status === 'connected'
                      ? 'success'
                      : integration.status === 'error'
                        ? 'warning'
                        : 'default'
                  }
                  size="sm"
                >
                  {integration.status}
                </Badge>
              </div>

              {integration.status === 'connected' ? (
                <div className={styles.connectedInfo}>
                  <div className={styles.accountInfo}>
                    <span className={styles.accountLabel}>Connected as</span>
                    <span className={styles.accountEmail}>{integration.connectedAccount || 'Account connected'}</span>
                  </div>
                  <div className={styles.syncInfo}>
                    <Badge variant="success" size="sm">Connected</Badge>
                    <span className={styles.lastSync}>
                      Last sync: {new Date(integration.lastSync!).toLocaleString()}
                    </span>
                  </div>
                </div>
              ) : (
                <div className={styles.disconnectedInfo}>
                  <Badge variant="default" size="sm">Not connected</Badge>
                </div>
              )}

              <div className={styles.cardActions}>
                <IntegrationActions
                  provider={
                    integration.id === 'gmail' || integration.id === 'calendar' || integration.id === 'google_docs'
                      ? 'google'
                      : integration.id === 'notion'
                        ? 'notion'
                        : 'slack'
                  }
                  status={integration.status}
                />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
