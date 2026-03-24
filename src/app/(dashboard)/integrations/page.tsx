'use client'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Badge, Card } from '@/components/ui'
import { IntegrationActions } from '@/components/integrations/IntegrationActions'
import { useLang } from '@/lib/lang-context'
import type { DashboardBundle } from '@/lib/dashboard/server'
import styles from './page.module.css'
import skeletonStyles from '../loading.module.css'

export default function IntegrationsPage() {
  const { t, lang } = useLang()
  const locale = lang === 'fr' ? 'fr-FR' : 'en-US'
  const searchParams = useSearchParams()
  const [data, setData] = useState<DashboardBundle | null>(null)

  useEffect(() => {
    fetch('/api/dashboard').then(r => r.json()).then(setData).catch(() => null)
  }, [])

  if (!data) return (
    <div className={skeletonStyles.page}>
      <div className={`${skeletonStyles.skeleton} ${skeletonStyles.headerSm}`} />
      <div className={skeletonStyles.row}>
        <div className={`${skeletonStyles.skeleton} ${skeletonStyles.cardTall}`} />
        <div className={`${skeletonStyles.skeleton} ${skeletonStyles.cardTall}`} />
        <div className={`${skeletonStyles.skeleton} ${skeletonStyles.cardTall}`} />
      </div>
    </div>
  )

  const connectedParam = searchParams?.get('connected')
  const errorParam = searchParams?.get('error')
  const connectedCount = data.integrations.filter(i => i.status === 'connected').length

  const successMessage = connectedParam ? `${t.integrations.connectedMsg} ${connectedParam}` : null
  const errorMessage = errorParam ? `${t.integrations.errorMsg} ${errorParam.replace(/_/g, ' ')}` : null

  return (
    <div className={styles.container}>
      {(successMessage || errorMessage) && (
        <div className={`${styles.alert} ${successMessage ? styles.alertSuccess : styles.alertError}`}>
          {successMessage ?? errorMessage}
        </div>
      )}
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{t.integrations.eyebrow}</p>
          <h1 className={styles.title}>{t.integrations.title}</h1>
          <p className={styles.subtitle}>{t.integrations.subtitle}</p>
        </div>
        <div className={styles.headerBadges}>
          <Badge variant="success">{connectedCount} {t.integrations.connected}</Badge>
          <Badge variant={data.source === 'database' ? 'success' : 'warning'}>{data.source}</Badge>
        </div>
      </header>
      <div className={styles.content}>
        <div className={styles.summaryBar}>
          <Card variant="bordered" className={styles.summaryCard}>
            <strong>{connectedCount}</strong>
            <span>{t.integrations.activeIntegrations}</span>
          </Card>
          <Card variant="bordered" className={styles.summaryCard}>
            <strong>{data.integrations.filter(i => i.health !== 'healthy').length}</strong>
            <span>{t.integrations.needAttention}</span>
          </Card>
        </div>
        <div className={styles.grid}>
          {data.integrations.map(integration => (
            <Card key={integration.id} variant="bordered" className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.iconWrapper} style={{ backgroundColor: `${integration.color}20` }}>
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
                <Badge variant={integration.status === 'connected' ? 'success' : integration.status === 'error' ? 'warning' : 'default'} size="sm">
                  {integration.status}
                </Badge>
              </div>
              {integration.status === 'connected' ? (
                <div className={styles.connectedInfo}>
                  <div className={styles.accountInfo}>
                    <span className={styles.accountLabel}>{lang === 'fr' ? 'Connecté en tant que' : 'Connected as'}</span>
                    <span className={styles.accountEmail}>{integration.connectedAccount || (lang === 'fr' ? 'Compte connecté' : 'Account connected')}</span>
                  </div>
                  <div className={styles.syncInfo}>
                    <Badge variant="success" size="sm">{lang === 'fr' ? 'Connecté' : 'Connected'}</Badge>
                    <span className={styles.lastSync}>
                      {lang === 'fr' ? 'Dernière synchro :' : 'Last sync:'} {new Date(integration.lastSync!).toLocaleString(locale)}
                    </span>
                  </div>
                  {integration.warnings && integration.warnings.length > 0 && (
                    <div className={styles.warningList}>
                      {integration.warnings.map(w => <div key={w} className={styles.warningItem}>{w}</div>)}
                    </div>
                  )}
                </div>
              ) : (
                <div className={styles.disconnectedInfo}>
                  <Badge variant="default" size="sm">{lang === 'fr' ? 'Non connecté' : 'Not connected'}</Badge>
                </div>
              )}
              <div className={styles.cardActions}>
                <IntegrationActions
                  provider={
                    integration.id === 'gmail' || integration.id === 'calendar' || integration.id === 'google_docs' || integration.id === 'google_drive'
                      ? 'google' : integration.id === 'notion' ? 'notion' : 'slack'
                  }
                  status={integration.status}
                  needsReconnect={integration.needsReconnect}
                />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
