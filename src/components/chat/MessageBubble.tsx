import { Avatar } from '../ui'
import styles from './MessageBubble.module.css'

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
  thinking?: boolean
  userFallback?: string
}

export function MessageBubble({ role, content, isStreaming, thinking, userFallback }: MessageBubbleProps) {
  const isUser = role === 'user'
  const lines = content.split('\n')

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
                ...
              </span>
            ) : null}
          </div>
        )}
      </div>
      <div className={styles.content}>
        <div className={styles.bubble}>
          <div className={styles.text}>
            {lines.map((line, index) => (
              <p key={`${role}-${index}`} className={styles.textLine}>
                {line || '\u00A0'}
              </p>
            ))}
          </div>
          {thinking ? (
            <span className={styles.thinkingDots} aria-hidden="true">
              ...
            </span>
          ) : null}
          {isStreaming && <span className={styles.cursor} />}
        </div>
      </div>
    </div>
  )
}
