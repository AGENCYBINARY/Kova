'use client'

import { useEffect, useState } from 'react'
import styles from './ChatThinkingStatus.module.css'
import bubbleStyles from './MessageBubble.module.css'

const FR_LINES = [
  'Lecture de ta demande…',
  'Vérification du calendrier et des intégrations…',
  'Préparation des actions (agenda, mail)…',
  'Recherche du destinataire dans tes mails si besoin…',
  'Finalisation du libellé des propositions…',
]

const EN_LINES = [
  'Reading your request…',
  'Checking calendar and connected tools…',
  'Preparing actions (schedule, email)…',
  'Matching recipients from your mail history when needed…',
  'Polishing proposal wording…',
]

export function ChatThinkingStatus({ lang }: { lang: 'fr' | 'en' }) {
  const lines = lang === 'en' ? EN_LINES : FR_LINES
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % lines.length)
    }, 1500)
    return () => window.clearInterval(id)
  }, [lines.length])

  return (
    <div className={`${bubbleStyles.message} ${bubbleStyles.assistant}`} aria-busy="true">
      <div className={bubbleStyles.avatarWrapper}>
        <div className={bubbleStyles.aiAvatarGroup}>
          <div className={bubbleStyles.aiAvatar}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor" />
              <path
                d="M2 17L12 22L22 17"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M2 12L12 17L22 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      </div>
      <div className={bubbleStyles.content}>
        <div className={styles.wrap}>
          <p key={index} className={styles.line}>
            {lines[index]}
          </p>
          <p className={styles.sub}>
            {lang === 'en' ? 'This usually takes a few seconds.' : 'Quelques secondes en général.'}
          </p>
        </div>
      </div>
    </div>
  )
}
