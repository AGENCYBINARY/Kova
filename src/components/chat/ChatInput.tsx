'use client'
import { useState, useRef, KeyboardEvent, useLayoutEffect, useCallback, useEffect } from 'react'
import { Textarea } from '../ui'
import { useLang } from '@/lib/lang-context'
import {
  createSpeechRecognition,
  isSpeechRecognitionSupported,
  type BrowserSpeechRecognition,
  type SpeechRecognitionResultListEvent,
} from '@/lib/speech/dictation'
import styles from './ChatInput.module.css'

interface ChatInputProps {
  onSend: (message: string, executionMode: 'ask' | 'auto') => void
  onModeChange: (mode: 'ask' | 'auto') => void
  disabled?: boolean
  preferredMode: 'ask' | 'auto'
}

export function ChatInput({ onSend, onModeChange, disabled, preferredMode }: ChatInputProps) {
  const { t, lang } = useLang()
  const [message, setMessage] = useState('')
  const [isListening, setIsListening] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messageRef = useRef('')
  const dictationSnapshotRef = useRef('')
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)

  messageRef.current = message

  const speechSupported = typeof window !== 'undefined' && isSpeechRecognitionSupported()

  const stopDictation = useCallback(() => {
    const r = recognitionRef.current
    if (r) {
      try {
        r.stop()
      } catch {
        try {
          r.abort()
        } catch {
          /* ignore */
        }
      }
      recognitionRef.current = null
    }
    setIsListening(false)
  }, [])

  useEffect(() => {
    return () => {
      const r = recognitionRef.current
      if (r) {
        try {
          r.abort()
        } catch {
          /* ignore */
        }
        recognitionRef.current = null
      }
    }
  }, [])

  const toggleDictation = useCallback(() => {
    if (disabled || !speechSupported) return
    if (isListening) {
      stopDictation()
      return
    }

    const Recognition = createSpeechRecognition()
    if (!Recognition) return

    dictationSnapshotRef.current = messageRef.current
    Recognition.lang = lang === 'fr' ? 'fr-FR' : 'en-US'
    Recognition.continuous = true
    Recognition.interimResults = true
    Recognition.maxAlternatives = 1

    Recognition.onstart = () => setIsListening(true)

    Recognition.onresult = (event: SpeechRecognitionResultListEvent) => {
      let spoken = ''
      for (let i = 0; i < event.results.length; i += 1) {
        spoken += event.results[i]![0]!.transcript
      }
      const snap = dictationSnapshotRef.current
      const trimmed = spoken.trim()
      if (!trimmed) return
      const spacer = snap.length > 0 && !/\s$/.test(snap) ? ' ' : ''
      setMessage(snap + spacer + trimmed)
    }

    Recognition.onerror = () => {
      stopDictation()
    }

    Recognition.onend = () => {
      recognitionRef.current = null
      setIsListening(false)
    }

    try {
      recognitionRef.current = Recognition
      Recognition.start()
    } catch {
      recognitionRef.current = null
      setIsListening(false)
    }
  }, [disabled, speechSupported, isListening, lang, stopDictation])

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
        <div className={styles.inputActions}>
          <button
            type="button"
            className={`${styles.micButton} ${isListening ? styles.micButtonActive : ''}`}
            onClick={toggleDictation}
            disabled={disabled || !speechSupported}
            aria-label={isListening ? t.chatInput.dictationStop : t.chatInput.dictation}
            aria-pressed={isListening}
            title={!speechSupported ? t.chatInput.dictationUnsupported : undefined}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z" />
              <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
              <path d="M12 18v4" />
              <path d="M8 22h8" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.sendButton}
            onClick={handleSend}
            disabled={!message.trim() || disabled}
            aria-label={t.chatInput.send}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M5 12h11" />
              <path d="m11 6 6 6-6 6" />
            </svg>
          </button>
        </div>
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
