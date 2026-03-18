'use client'

import { useState, useRef, KeyboardEvent, useLayoutEffect, ChangeEvent } from 'react'
import { Textarea } from '../ui'
import styles from './ChatInput.module.css'

interface ChatInputProps {
  onSend: (message: string, executionMode: 'ask' | 'auto') => void
  onModeChange: (mode: 'ask' | 'auto') => void
  disabled?: boolean
  preferredMode: 'ask' | 'auto'
}

export function ChatInput({
  onSend,
  onModeChange,
  disabled,
  preferredMode,
}: ChatInputProps) {
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
      setAttachments([])
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      if (textareaRef.current) {
        textareaRef.current.style.height = '52px'
      }
    }
  }

  const handlePickAttachment = () => {
    fileInputRef.current?.click()
  }

  const handleAttachmentChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    setAttachments(files.map((file) => file.name))
  }

  const removeAttachment = (name: string) => {
    setAttachments((current) => current.filter((item) => item !== name))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleModeChange = (mode: 'ask' | 'auto') => {
    onModeChange(mode)
  }

  return (
    <div className={styles.container}>
      <div className={styles.inputWrapper}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className={styles.hiddenInput}
          onChange={handleAttachmentChange}
        />
        <button
          type="button"
          className={styles.attachButton}
          onClick={handlePickAttachment}
          disabled={disabled}
          aria-label="Add attachment"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>
        <Textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Écris ton message..."
          disabled={disabled}
          className={styles.textarea}
        />
        <button
          className={styles.sendButton}
          onClick={handleSend}
          disabled={!message.trim() || disabled}
          aria-label="Send message"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h11" />
            <path d="m11 6 6 6-6 6" />
          </svg>
        </button>
      </div>
      {attachments.length > 0 ? (
        <div className={styles.attachments}>
          {attachments.map((attachment) => (
            <button
              key={attachment}
              type="button"
              className={styles.attachmentChip}
              onClick={() => removeAttachment(attachment)}
              title="Retirer la pièce jointe"
            >
              <span>{attachment}</span>
              <span className={styles.attachmentRemove}>×</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className={styles.bottomRow}>
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
        <p className={styles.hint}>Entrée pour envoyer, Shift+Entrée pour une ligne.</p>
      </div>
    </div>
  )
}
