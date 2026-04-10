'use client'
import { Badge, Button, Card } from '../ui'
import { useLang } from '@/lib/lang-context'
import { ActionParametersPreview, getProposalDisplayCopy } from './action-parameter-previews'
import { iconForActionType } from './action-type-icons'
import styles from './ActionProposalCard.module.css'

interface ActionProposalCardProps {
  id: string
  type: string
  title: string
  description: string
  parameters: Record<string, unknown>
  onApprove: (id: string) => void
  onReject: (id: string) => void
  loading?: boolean
}

export function ActionProposalCard({ id, type, title, description, parameters, onApprove, onReject, loading }: ActionProposalCardProps) {
  const { t, lang } = useLang()
  const displayCopy = getProposalDisplayCopy({ type, title, description, parameters, lang })

  return (
    <Card variant="bordered" className={styles.card}>
      <div className={styles.header}>
        <div className={styles.iconWrapper}>{iconForActionType(type)}</div>
        <div className={styles.headerContent}>
          <h3 className={styles.title}>{displayCopy.title}</h3>
          <Badge variant="warning" size="sm">{t.proposal.pendingApproval}</Badge>
        </div>
      </div>
      <p className={styles.description}>{displayCopy.description}</p>
      <ActionParametersPreview type={type} parameters={parameters} showRawJson={false} />
      <div className={styles.actions}>
        <Button variant="danger" size="sm" onClick={() => onReject(id)} disabled={loading}>
          {t.proposal.reject}
        </Button>
        <Button variant="primary" size="sm" onClick={() => onApprove(id)} disabled={loading} loading={loading}>
          {t.proposal.approve}
        </Button>
      </div>
    </Card>
  )
}
