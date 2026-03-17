import { Avatar } from '../ui'
import styles from './MessageBubble.module.css'

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
  thinking?: boolean
}

export function MessageBubble({ role, content, isStreaming, thinking }: MessageBubbleProps) {
  const isUser = role === 'user'

  return (
    <div className={`${styles.message} ${isUser ? styles.user : styles.assistant}`}>
      <div className={styles.avatarWrapper}>
        {isUser ? (
          <Avatar fallback="You" size="sm" />
        ) : (
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
        )}
      </div>
      <div className={styles.content}>
        <div className={styles.bubble}>
          <p className={styles.text}>{content}</p>
          {thinking ? (
            <span className={styles.thinkingDots} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          ) : null}
          {isStreaming && <span className={styles.cursor} />}
        </div>
      </div>
    </div>
  )
}
