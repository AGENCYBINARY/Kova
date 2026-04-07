import { Avatar } from '../ui'
import styles from './MessageBubble.module.css'

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  metadata?: {
    plan?: Array<{
      title?: string
      detail?: string
      app?: string
    }>
  }
  isStreaming?: boolean
  thinking?: boolean
  userFallback?: string
}

export function MessageBubble({ role, content, metadata, isStreaming, thinking, userFallback }: MessageBubbleProps) {
  const isUser = role === 'user'
  const lines = content.split('\n')
  const hasVisibleContent = lines.some((line) => line.trim().length > 0)
  const shouldRenderBubble = hasVisibleContent || (isStreaming && !thinking)
  const urlPattern = /(https?:\/\/[^\s]+)/g
  const planSteps = role === 'assistant' && Array.isArray(metadata?.plan) ? metadata.plan.filter((step) => step?.title || step?.detail) : []

  const renderLine = (line: string, index: number) => {
    if (!line) {
      return (
        <p key={`${role}-${index}`} className={styles.textLine}>
          {'\u00A0'}
        </p>
      )
    }

    const parts = line.split(urlPattern)
    return (
      <p key={`${role}-${index}`} className={styles.textLine}>
        {parts.map((part, partIndex) =>
          /^https?:\/\//.test(part)
            ? (
              <a key={`${role}-${index}-${partIndex}`} href={part} target="_blank" rel="noreferrer">
                {part}
              </a>
            )
            : <span key={`${role}-${index}-${partIndex}`}>{part}</span>
        )}
      </p>
    )
  }

  return (
    <div className={`${styles.message} ${isUser ? styles.user : styles.assistant}`}>
      <div className={styles.avatarWrapper}>
        {isUser ? (
          <Avatar fallback={userFallback || 'User'} size="sm" />
        ) : (
          <div className={styles.aiAvatarGroup}>
            <div className={styles.aiAvatar}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2L2 7L12 12L22 7L12 2Z"
                  fill="currentColor"
                />
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
            {thinking ? (
              <span className={styles.avatarThinkingDots} aria-hidden="true">
                <span className={styles.avatarThinkingDot} />
                <span className={styles.avatarThinkingDot} />
                <span className={styles.avatarThinkingDot} />
              </span>
            ) : null}
          </div>
        )}
      </div>
      <div className={styles.content}>
        {shouldRenderBubble ? (
          <div className={styles.bubble}>
            <div className={styles.text}>
              {lines.map((line, index) => renderLine(line, index))}
            </div>
            {planSteps.length > 0 ? (
              <div className={styles.plan}>
                <p className={styles.planLabel}>Plan</p>
                <ol className={styles.planList}>
                  {planSteps.map((step, index) => (
                    <li key={`${role}-plan-${index}`} className={styles.planItem}>
                      <span className={styles.planTitle}>
                        {step.title || (step.app ? `Étape ${index + 1} · ${step.app}` : `Étape ${index + 1}`)}
                      </span>
                      {step.detail ? <span className={styles.planDetail}>{step.detail}</span> : null}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {isStreaming && <span className={styles.cursor} />}
          </div>
        ) : null}
      </div>
    </div>
  )
}
