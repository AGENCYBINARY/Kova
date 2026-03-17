'use client'

import { useState, useRef, KeyboardEvent } from 'react'
import { Textarea } from '../ui'
import styles from './ChatInput.module.css'

interface ChatInputProps {
  onSend: (message: string, executionMode: 'ask' | 'auto') => void
  onModeChange: (mode: 'ask' | 'auto') => void
  disabled?: boolean
  preferredMode: 'ask' | 'auto'
  effectiveMode: 'ask' | 'auto'
  effectiveModeReason?: string
}

function formatModeReason(reason?: string) {
  if (!reason) {
    return 'manual review'
  }

  return reason.replaceAll('_', ' ')
}

export function ChatInput({
  onSend,
  onModeChange,
  disabled,
  preferredMode,
  effectiveMode,
  effectiveModeReason,
}: ChatInputProps) {
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = () => {
    if (message.trim() && !disabled) {
      textareaRef.current?.blur()
      onSend(message.trim(), preferredMode)
      setMessage('')
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleModeChange = (mode: 'ask' | 'auto') => {
    if (mode === 'auto') {
      const confirmed = window.confirm(
        "Mode prévention: l'assistant pourra exécuter directement certaines actions. Utilise ce mode seulement si les intégrations sont bien configurées."
      )

      if (!confirmed) {
        return
      }
    }

    onModeChange(mode)
  }

  return (
    <div className={styles.container}>
      <div className={styles.modeSwitch}>
        <button
          type="button"
          className={`${styles.modeButton} ${preferredMode === 'ask' ? styles.modeButtonActive : ''}`}
          onClick={() => handleModeChange('ask')}
          disabled={disabled}
        >
          Demander avant d&apos;agir
        </button>
        <button
          type="button"
          className={`${styles.modeButton} ${preferredMode === 'auto' ? styles.modeButtonActive : ''}`}
          onClick={() => handleModeChange('auto')}
          disabled={disabled}
        >
          Agir sans demander
        </button>
      </div>
      <div className={styles.modeSummary}>
        <span className={styles.modeSummaryText}>Mode demandé: {preferredMode}</span>
        <span className={styles.modeSummaryText}>Mode appliqué: {effectiveMode}</span>
        <span className={styles.modeSummaryText}>Règle: {formatModeReason(effectiveModeReason)}</span>
      </div>
      <div className={styles.inputWrapper}>
        <Textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe what you want to do... (Cmd+Enter to send)"
          disabled={disabled}
          className={styles.textarea}
        />
        <button
          className={styles.sendButton}
          onClick={handleSend}
          disabled={!message.trim() || disabled}
          aria-label="Send message"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
      <p className={styles.hint}>
        {preferredMode === 'ask'
          ? 'Ask mode: Kova drafts the action, shows the preview, and waits for your Yes or No.'
          : effectiveMode === 'auto'
            ? 'Auto mode: Kova executes immediately when the request is usable and safe enough.'
            : 'Auto mode requested, but Kova will fall back to review when confidence or recipient safety is not sufficient.'}
      </p>
    </div>
  )
}
