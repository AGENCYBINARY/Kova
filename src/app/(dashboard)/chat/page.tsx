'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { ChatInput } from '@/components/chat/ChatInput'
import { ActionProposalCard } from '@/components/actions/ActionProposalCard'
import styles from './page.module.css'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface ActionProposal {
  id: string
  type: string
  title: string
  description: string
  parameters: Record<string, unknown>
}

type ExecutionMode = 'ask' | 'auto'

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [proposals, setProposals] = useState<ActionProposal[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [preferredExecutionMode, setPreferredExecutionMode] = useState<ExecutionMode>('ask')
  const [effectiveExecutionMode, setEffectiveExecutionMode] = useState<ExecutionMode>('ask')
  const [executionModeReason, setExecutionModeReason] = useState<string>('manual_review')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, isStreaming])

  const refreshChatState = useCallback(async () => {
    const response = await fetch('/api/chat', { cache: 'no-store' })
    const data = await response.json()
    setMessages(data.messages || [])
    setProposals(data.proposals || [])
    setIsBootstrapping(false)
  }, [])

  useEffect(() => {
    void refreshChatState()
  }, [refreshChatState])

  const handleSend = useCallback(async (content: string, executionMode: ExecutionMode) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
    }
    setPreferredExecutionMode(executionMode)
    setMessages((prev) => [...prev, userMessage])
    setIsLoading(true)
    setIsStreaming(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content, executionMode }),
      })

      if (!response.ok) {
        throw new Error('Failed to send message.')
      }

      const data = await response.json()
      setEffectiveExecutionMode(data.effectiveExecutionMode || executionMode)
      setExecutionModeReason(data.executionModeReason || 'manual_review')
      if (data.assistantMessage) {
        setMessages((prev) => [...prev, data.assistantMessage])
      }
      if (Array.isArray(data.proposals) && data.proposals.length > 0) {
        setMessages((prev) => [
          ...prev,
          {
            id: `review-${Date.now()}`,
            role: 'assistant',
            content:
              (data.effectiveExecutionMode || executionMode) === 'ask'
                ? "I drafted everything. Do you want me to send it like this?"
                : 'Execution completed or queued automatically.',
          },
        ])
        setProposals((prev) => [...prev, ...data.proposals])
      }
      if (Array.isArray(data.executionMessages) && data.executionMessages.length > 0) {
        setMessages((prev) => [...prev, ...data.executionMessages])
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: 'I could not complete that turn. Check the server or database connection and try again.',
        },
      ])
    } finally {
      setIsLoading(false)
      setIsStreaming(false)
    }
  }, [])

  const handleApprove = useCallback(async (id: string) => {
    setIsLoading(true)

    try {
      const response = await fetch(`/api/actions/${id}/approve`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to approve action.')
      }

      const data = await response.json()
      setProposals((prev) => prev.filter((proposal) => proposal.id !== id))
      if (data.assistantMessage) {
        setMessages((prev) => [...prev, data.assistantMessage])
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleReject = useCallback(async (id: string) => {
    setIsLoading(true)

    try {
      const response = await fetch(`/api/actions/${id}/reject`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to reject action.')
      }

      const data = await response.json()
      setProposals((prev) => prev.filter((proposal) => proposal.id !== id))
      if (data.assistantMessage) {
        setMessages((prev) => [...prev, data.assistantMessage])
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Operator Console</p>
          <h1 className={styles.title}>Chat</h1>
          <p className={styles.subtitle}>
            Draft Gmail actions, create Google Calendar invites with Meet, and decide when CODEX should ask or act.
          </p>
        </div>
        <div className={styles.modePanel}>
          <div className={styles.modeMetric}>
            <span className={styles.modeLabel}>Requested</span>
            <strong>{preferredExecutionMode}</strong>
          </div>
          <div className={styles.modeMetric}>
            <span className={styles.modeLabel}>Applied</span>
            <strong>{effectiveExecutionMode}</strong>
          </div>
        </div>
      </header>

      <div className={styles.statusStrip}>
        <div className={styles.statusCard}>
          <span className={styles.statusLabel}>Pending review</span>
          <strong>{proposals.length}</strong>
        </div>
        <div className={styles.statusCard}>
          <span className={styles.statusLabel}>Execution rule</span>
          <strong>{executionModeReason.replaceAll('_', ' ')}</strong>
        </div>
      </div>

      <div className={styles.messages}>
        {isBootstrapping && messages.length === 0 ? (
          <MessageBubble
            role="assistant"
            content="Loading your operator workspace..."
            isStreaming
          />
        ) : null}

        {isLoading ? (
          <MessageBubble
            role="assistant"
            content="Thinking"
            thinking
          />
        ) : null}

        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            role={message.role}
            content={message.content}
            isStreaming={
              isStreaming &&
              message.role === 'assistant' &&
              message.id === messages[messages.length - 1].id
            }
          />
        ))}

        {proposals.map((proposal) => (
          <ActionProposalCard
            key={proposal.id}
            {...proposal}
            onApprove={handleApprove}
            onReject={handleReject}
            loading={isLoading}
          />
        ))}

        <div ref={messagesEndRef} />
      </div>

      <ChatInput
        onSend={handleSend}
        onModeChange={setPreferredExecutionMode}
        disabled={isLoading}
        preferredMode={preferredExecutionMode}
        effectiveMode={effectiveExecutionMode}
        effectiveModeReason={executionModeReason}
      />
    </div>
  )
}
