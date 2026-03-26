'use client'

import { useLang } from '@/lib/lang-context'
import styles from './ChatDisambiguationCard.module.css'

export interface ChatDisambiguation {
  actionType: string
  source: 'gmail' | 'calendar' | 'google_drive' | 'google_docs' | 'notion'
  field: string
  question: string
  options: Array<{
    id: string
    label: string
  }>
}

interface ChatDisambiguationCardProps {
  item: ChatDisambiguation
  disabled?: boolean
  onSelect: (item: ChatDisambiguation, option: ChatDisambiguation['options'][number]) => void
}

export function ChatDisambiguationCard({ item, disabled, onSelect }: ChatDisambiguationCardProps) {
  const { lang } = useLang()
  const sourceLabel =
    item.source === 'gmail'
      ? 'Gmail'
      : item.source === 'calendar'
        ? 'Calendar'
        : item.source === 'google_drive'
          ? 'Drive'
          : item.source === 'google_docs'
            ? 'Docs'
            : 'Notion'

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <div className={styles.header}>
          <div className={styles.headerTop}>
            <span className={styles.eyebrow}>{lang === 'en' ? 'Need selection' : 'Sélection requise'}</span>
            <span className={styles.source}>{sourceLabel}</span>
          </div>
          <p className={styles.question}>{item.question}</p>
        </div>
        <div className={styles.options}>
          {item.options.map((option, index) => (
            <button
              key={`${item.field}-${option.id}`}
              type="button"
              className={styles.option}
              onClick={() => onSelect(item, option)}
              disabled={disabled}
            >
              <span className={styles.optionIndex}>{index + 1}</span>
              <span className={styles.optionBody}>
                <span className={styles.optionText}>{option.label}</span>
                <span className={styles.optionMeta}>
                {lang === 'en' ? 'Use this match' : 'Utiliser ce match'}
                </span>
              </span>
            </button>
          ))}
        </div>
        <p className={styles.footer}>
          {lang === 'en' ? 'Or answer in free text if none of these matches is correct.' : 'Ou réponds en texte libre si aucune de ces suggestions ne convient.'}
        </p>
      </div>
    </div>
  )
}
