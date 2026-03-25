'use client'
import { useState, useRef, KeyboardEvent, useLayoutEffect } from 'react'
import { Textarea } from '../ui'
import { useLang } from '@/lib/lang-context'
import styles from './ChatInput.module.css'

interface ChatInputProps {
  onSend: (message: string, executionMode: 'ask' | 'auto') => void
  onModeChange: (mode: 'ask' | 'auto') => void
  disabled?: boolean
  preferredMode: 'ask' | 'auto'
}

export function ChatInput({ onSend, onModeChange, disabled, preferredMode }: ChatInputProps) {
  const { t } = useLang()
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 52), 160)
    textarea.style.height = `${nextHeight}px`
  }, [message])

  const handleSend = () => {
    if (message.trim() && !disabled) {
      onSend(message.trim(), preferredMode)
      setMessage('')
      if (textareaRef.current) textareaRef.current.style.height = '52px'
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.inputWrapper}>
        <Textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.chatInput.placeholder}
          disabled={disabled}
          className={styles.textarea}
        />
        <button
          className={styles.sendButton}
          onClick={handleSend}
          disabled={!message.trim() || disabled}
          aria-label={t.chatInput.send}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h11" />
            <path d="m11 6 6 6-6 6" />
          </svg>
        </button>
      </div>
      <div className={styles.bottomRow}>
        <div className={styles.modeSwitch}>
          <button
            type="button"
            className={`${styles.modeButton} ${preferredMode === 'ask' ? styles.modeButtonActive : ''}`}
            onClick={() => onModeChange('ask')}
            disabled={disabled}
          >
            {t.chatInput.askMode}
          </button>
          <button
            type="button"
            className={`${styles.modeButton} ${preferredMode === 'auto' ? styles.modeButtonActive : ''}`}
            onClick={() => onModeChange('auto')}
            disabled={disabled}
          >
            {t.chatInput.autoMode}
          </button>
        </div>
        <p className={styles.hint}>{t.chatInput.hint}</p>
      </div>
    </div>
  )
}
