import { Badge, Card } from '@/components/ui'
import { IntegrationActions } from '@/components/integrations/IntegrationActions'
import { getLang, getT } from '@/lib/lang-server'
import type { IntegrationsPageData } from '@/lib/dashboard/server'
import styles from '@/app/(dashboard)/integrations/page.module.css'

function formatIntegrationError(errorCode: string, lang: 'fr' | 'en') {
  const messages = {
    google_oauth_state: {
      fr: 'La connexion Google a expiré ou le lien de retour est invalide. Relance la connexion.',
      en: 'Google sign-in expired or the callback link is invalid. Reconnect Google.',
    },
    google_oauth_config: {
      fr: 'La configuration OAuth Google est incomplète côté serveur.',
      en: 'Google OAuth server configuration is incomplete.',
    },
    google_oauth_exchange: {
      fr: 'Google a refusé l’échange du code OAuth. Réessaie la connexion.',
      en: 'Google rejected the OAuth code exchange. Try connecting again.',
    },
    google_oauth_account: {
      fr: 'Google n’a pas permis de lire le compte connecté. Réessaie la connexion.',
      en: 'Google did not allow reading the connected account. Reconnect Google.',
    },
    google_oauth_failed: {
      fr: 'La connexion Google a échoué. Réessaie dans quelques secondes.',
      en: 'Google connection failed. Try again in a few seconds.',
    },
    notion_oauth_state: {
      fr: 'La connexion Notion a expiré ou le lien de retour est invalide. Relance la connexion.',
      en: 'Notion sign-in expired or the callback link is invalid. Reconnect Notion.',
    },
    notion_oauth_config: {
      fr: 'La configuration OAuth Notion est incomplète côté serveur.',
      en: 'Notion OAuth server configuration is incomplete.',
    },
    notion_oauth_exchange: {
      fr: 'Notion a refusé l’échange du code OAuth. Réessaie la connexion.',
      en: 'Notion rejected the OAuth code exchange. Try connecting again.',
    },
    notion_oauth_context: {
      fr: 'Le workspace actif n’a pas pu être résolu pendant la connexion Notion.',
      en: 'The active workspace could not be resolved during Notion sign-in.',
    },
    notion_oauth_persist: {
      fr: 'La connexion Notion a réussi mais l’enregistrement local a échoué.',
      en: 'Notion connected but local persistence failed.',
    },
    notion_oauth_failed: {
      fr: 'La connexion Notion a échoué. Réessaie dans quelques secondes.',
      en: 'Notion connection failed. Try again in a few seconds.',
    },
  } as const

  const message = messages[errorCode as keyof typeof messages]
  if (message) {
    return message[lang]
  }

  return lang === 'fr' ? `Erreur d’intégration : ${errorCode.replace(/_/g, ' ')}` : `Integration error: ${errorCode.replace(/_/g, ' ')}`
}

export function IntegrationsPageClient({
  data,
  connectedParam,
  errorParam,
}: {
  data: IntegrationsPageData
  connectedParam?: string | null
  errorParam?: string | null
}) {
  const t = getT()
  const lang = getLang()
  const locale = lang === 'fr' ? 'fr-FR' : 'en-US'
  const connectedCount = data.integrations.filter((integration) => integration.status === 'connected').length

  const successMessage = connectedParam ? `${t.integrations.connectedMsg} ${connectedParam}` : null
  const errorMessage = errorParam ? formatIntegrationError(errorParam, lang) : null

  return (
    <div className={styles.container}>
      {(successMessage || errorMessage) ? (
        <div className={`${styles.alert} ${successMessage ? styles.alertSuccess : styles.alertError}`}>
          {successMessage ?? errorMessage}
        </div>
      ) : null}
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
            <strong>{data.integrations.filter((integration) => integration.health !== 'healthy').length}</strong>
            <span>{t.integrations.needAttention}</span>
          </Card>
        </div>
        <div className={styles.grid}>
          {data.integrations.map((integration) => (
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
                    <span className={styles.accountEmail}>
                      {integration.connectedAccount || (lang === 'fr' ? 'Compte connecté' : 'Account connected')}
                    </span>
                  </div>
                  <div className={styles.syncInfo}>
                    <Badge variant="success" size="sm">{lang === 'fr' ? 'Connecté' : 'Connected'}</Badge>
                    <span className={styles.lastSync}>
                      {lang === 'fr' ? 'Dernière synchro :' : 'Last sync:'} {integration.lastSync ? new Date(integration.lastSync).toLocaleString(locale) : '-'}
                    </span>
                  </div>
                  {integration.warnings && integration.warnings.length > 0 ? (
                    <div className={styles.warningList}>
                      {integration.warnings.map((warning) => <div key={warning} className={styles.warningItem}>{warning}</div>)}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className={styles.disconnectedInfo}>
                  <Badge variant="default" size="sm">{lang === 'fr' ? 'Non connecté' : 'Not connected'}</Badge>
                </div>
              )}
              <div className={styles.cardActions}>
                <IntegrationActions
                  provider={
                    integration.id === 'gmail' || integration.id === 'calendar' || integration.id === 'google_docs' || integration.id === 'google_drive' || integration.id === 'google_photos'
                      ? 'google'
                      : integration.id === 'notion'
                        ? 'notion'
                        : 'slack'
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
