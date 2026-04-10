'use client'

import { useEffect, useState } from 'react'
import { Badge, Button, Card } from '@/components/ui'
import { useLang } from '@/lib/lang-context'
import type { ActionsPageData } from '@/lib/dashboard/server'
import { ActionParametersPreview, getProposalDisplayCopy, formatDateTimeParis } from '@/components/actions/action-parameter-previews'
import { iconForActionType } from '@/components/actions/action-type-icons'
import styles from '@/app/(dashboard)/actions/page.module.css'

export function ActionsPageClient({ data }: { data: ActionsPageData }) {
  const { t, lang } = useLang()
  const locale = lang === 'fr' ? 'fr-FR' : 'en-US'
  const [pendingActions, setPendingActions] = useState(data.pendingActions)
  const [loadingActionId, setLoadingActionId] = useState<string | null>(null)
  const [isBatchLoading, setIsBatchLoading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const highRiskCount = pendingActions.filter((action) => action.riskLevel === 'high').length
  const averageConfidence =
    pendingActions.length > 0
      ? Math.round(
          (pendingActions.reduce((sum, action) => {
            const c = action.confidenceScore
            return sum + (typeof c === 'number' && !Number.isNaN(c) ? c : 0)
          }, 0) /
            pendingActions.length) *
            100
        )
      : 0

  useEffect(() => {
    if (!toast) return

    const timeout = window.setTimeout(() => setToast(null), 3500)
    return () => window.clearTimeout(timeout)
  }, [toast])

  async function handleSingleReview(id: string, decision: 'approve' | 'reject') {
    setLoadingActionId(id)

    try {
      const response = await fetch(`/api/actions/${id}/${decision}`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': `${decision}-${id}-${crypto.randomUUID()}`,
        },
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Action review failed.')
      }

      const handledIds = Array.isArray(payload.actions)
        ? new Set((payload.actions as Array<{ id?: string }>).map((action) => action.id).filter(Boolean))
        : new Set<string>([id])

      setPendingActions((previous) => previous.filter((action) => !handledIds.has(action.id)))
      if (typeof payload.assistantMessage?.content === 'string') {
        setToast(payload.assistantMessage.content)
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Action review failed.')
    } finally {
      setLoadingActionId(null)
    }
  }

  async function handleBatchReview(decision: 'approve' | 'reject') {
    if (pendingActions.length === 0) {
      return
    }

    setIsBatchLoading(true)

    try {
      const response = await fetch('/api/actions/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `${decision}-batch-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          decision,
          actionIds: pendingActions.map((action) => action.id),
        }),
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Batch review failed.')
      }

      const handledIds = Array.isArray(payload.actions)
        ? new Set((payload.actions as Array<{ id?: string }>).map((action) => action.id).filter(Boolean))
        : new Set<string>()

      setPendingActions((previous) => previous.filter((action) => !handledIds.has(action.id)))
      if (typeof payload.assistantMessage?.content === 'string') {
        setToast(payload.assistantMessage.content)
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Batch review failed.')
    } finally {
      setIsBatchLoading(false)
    }
  }

  return (
    <div className={styles.container}>
      {toast ? <div className={styles.toast}>{toast}</div> : null}
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
        {pendingActions.length > 0 ? (
          <div className={styles.bulkActions}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleBatchReview('reject')}
              loading={isBatchLoading}
            >
              {lang === 'fr' ? 'Tout rejeter' : 'Reject all'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleBatchReview('approve')}
              loading={isBatchLoading}
            >
              {lang === 'fr' ? 'Tout approuver' : 'Approve all'}
            </Button>
          </div>
        ) : null}
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
            {pendingActions.map((action) => {
              const display = getProposalDisplayCopy({
                type: action.type,
                title: action.title,
                description: action.description,
                parameters: action.parameters,
                lang,
              })
              const scheduledHint =
                action.type === 'send_email' && typeof action.parameters.scheduledSendAt === 'string' && action.parameters.scheduledSendAt.trim()
                  ? formatDateTimeParis(action.parameters.scheduledSendAt, lang)
                  : null
              return (
                <Card key={action.id} variant="bordered" className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.iconWrapper}>
                    {iconForActionType(action.type)}
                  </div>
                  <div className={styles.cardInfo}>
                    <h3 className={styles.cardTitle}>{display.title}</h3>
                    <p className={styles.cardDescription}>{display.description}</p>
                    <div className={styles.meta}>
                      <span className={styles.cardTime}>
                        {t.actions.proposed} {new Date(action.createdAt).toLocaleString(locale)}
                      </span>
                      <span className={styles.metaDivider} />
                      <span className={styles.metaText}>{action.targetApp}</span>
                      <span className={styles.metaDivider} />
                      <span className={styles.metaText}>
                        {t.actions.confidence}{' '}
                        {typeof action.confidenceScore === 'number' && !Number.isNaN(action.confidenceScore)
                          ? Math.round(action.confidenceScore * 100)
                          : 0}
                        %
                      </span>
                    </div>
                  </div>
                  <div className={styles.badges}>
                    <Badge variant="warning">{t.actions.pendingBadge}</Badge>
                    <Badge variant={action.riskLevel === 'high' ? 'danger' : action.riskLevel === 'medium' ? 'warning' : 'success'}>
                      {action.riskLevel} {t.dashboard.risk}
                    </Badge>
                  </div>
                </div>
                {scheduledHint ? (
                  <p className={styles.scheduleLine}>
                    {t.proposal.scheduledSend}: {scheduledHint}
                  </p>
                ) : null}
                {action.details ? <p className={styles.details}>{action.details}</p> : null}
                <div className={styles.parameters}>
                  <ActionParametersPreview type={action.type} parameters={action.parameters} showRawJson />
                </div>
                <div className={styles.cardActions}>
                  <Button variant="ghost" size="sm" disabled>{t.actions.modify}</Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleSingleReview(action.id, 'reject')}
                    loading={loadingActionId === action.id}
                  >
                    {t.actions.reject}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleSingleReview(action.id, 'approve')}
                    loading={loadingActionId === action.id}
                  >
                    {t.actions.approve}
                  </Button>
                </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
