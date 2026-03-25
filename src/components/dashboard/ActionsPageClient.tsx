'use client'

import { Badge, Button, Card } from '@/components/ui'
import { useLang } from '@/lib/lang-context'
import type { ActionsPageData } from '@/lib/dashboard/server'
import styles from '@/app/(dashboard)/actions/page.module.css'

const actionIcons: Record<string, JSX.Element> = {
  send_email: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>,
  create_calendar_event: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>,
  create_google_drive_file: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 3h6l5 9-5 9H9l-5-9 5-9z" /><path d="M9 3 4 12M15 3l5 9M7 16h10" /></svg>,
}

export function ActionsPageClient({ data }: { data: ActionsPageData }) {
  const { t, lang } = useLang()
  const locale = lang === 'fr' ? 'fr-FR' : 'en-US'
  const { pendingActions } = data
  const highRiskCount = pendingActions.filter((action) => action.riskLevel === 'high').length
  const averageConfidence =
    pendingActions.length > 0
      ? Math.round((pendingActions.reduce((sum, action) => sum + action.confidenceScore, 0) / pendingActions.length) * 100)
      : 0

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>{t.actions.eyebrow}</p>
          <h1 className={styles.title}>{t.actions.title}</h1>
          <p className={styles.subtitle}>{t.actions.subtitle}</p>
        </div>
        <div className={styles.headerStats}>
          <Badge variant="warning">{pendingActions.length} {t.actions.pending}</Badge>
          <Badge variant={highRiskCount > 0 ? 'danger' : 'success'}>{highRiskCount} {t.actions.highRisk}</Badge>
          <Badge variant={data.source === 'database' ? 'success' : 'warning'}>{data.source}</Badge>
        </div>
      </header>
      <div className={styles.content}>
        <div className={styles.summary}>
          <Card variant="bordered" className={styles.summaryCard}>
            <span className={styles.summaryLabel}>{t.actions.queuePressure}</span>
            <strong className={styles.summaryValue}>{pendingActions.length}</strong>
            <p className={styles.summaryHint}>{t.actions.queuePressureHint}</p>
          </Card>
          <Card variant="bordered" className={styles.summaryCard}>
            <span className={styles.summaryLabel}>{t.actions.avgConfidence}</span>
            <strong className={styles.summaryValue}>{averageConfidence}%</strong>
            <p className={styles.summaryHint}>{t.actions.avgConfidenceHint}</p>
          </Card>
        </div>
        {pendingActions.length === 0 ? (
          <div className={styles.empty}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            <h3>{t.actions.empty}</h3>
            <p>{t.actions.emptyHint}</p>
          </div>
        ) : (
          <div className={styles.list}>
            {pendingActions.map((action) => (
              <Card key={action.id} variant="bordered" className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.iconWrapper}>
                    {actionIcons[action.type] || actionIcons.send_email}
                  </div>
                  <div className={styles.cardInfo}>
                    <h3 className={styles.cardTitle}>{action.title}</h3>
                    <p className={styles.cardDescription}>{action.description}</p>
                    <div className={styles.meta}>
                      <span className={styles.cardTime}>
                        {t.actions.proposed} {new Date(action.createdAt).toLocaleString(locale)}
                      </span>
                      <span className={styles.metaDivider} />
                      <span className={styles.metaText}>{action.targetApp}</span>
                      <span className={styles.metaDivider} />
                      <span className={styles.metaText}>{t.actions.confidence} {Math.round(action.confidenceScore * 100)}%</span>
                    </div>
                  </div>
                  <div className={styles.badges}>
                    <Badge variant="warning">{t.actions.pendingBadge}</Badge>
                    <Badge variant={action.riskLevel === 'high' ? 'danger' : action.riskLevel === 'medium' ? 'warning' : 'success'}>
                      {action.riskLevel} {t.dashboard.risk}
                    </Badge>
                  </div>
                </div>
                {action.details ? <p className={styles.details}>{action.details}</p> : null}
                <div className={styles.parameters}>
                  <pre>{JSON.stringify(action.parameters, null, 2)}</pre>
                </div>
                <div className={styles.cardActions}>
                  <Button variant="ghost" size="sm">{t.actions.modify}</Button>
                  <Button variant="danger" size="sm">{t.actions.reject}</Button>
                  <Button variant="primary" size="sm">{t.actions.approve}</Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
