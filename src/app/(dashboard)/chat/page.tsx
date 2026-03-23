'use client'
import { useUser } from '@clerk/nextjs'
import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { ChatInput } from '@/components/chat/ChatInput'
import { ActionProposalCard } from '@/components/actions/ActionProposalCard'
import { useLang } from '@/lib/lang-context'
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
  const { user } = useUser()
  const { t, lang } = useLang()
  const [messages, setMessages] = useState<Message[]>([])
  const [proposals, setProposals] = useState<ActionProposal[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [preferredExecutionMode, setPreferredExecutionMode] = useState<ExecutionMode>('ask')
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
    const startedAt = Date.now()
    const userMessage: Message = { id: Date.now().toString(), role: 'user', content }
    setPreferredExecutionMode(executionMode)
    setMessages((prev) => [...prev, userMessage])
    setIsLoading(true)
    setIsStreaming(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, executionMode }),
      })

      if (!response.ok) {
        if (response.status === 429) {
          const errData = await response.json().catch(() => ({}))
          if (errData.error === 'quota_exceeded') {
            const q = errData.quota
            const planLabel = q?.plan === 'free' ? (lang === 'en' ? 'free' : 'gratuit') : (q?.plan ?? 'free')
            setMessages((prev) => [
              ...prev,
              {
                id: String(Date.now()),
                role: 'assistant' as const,
                content: lang === 'en'
                  ? `You have reached your monthly limit of ${q?.limit ?? 50} requests (${planLabel} plan). Upgrade your subscription from Settings to continue.`
                  : `Tu as atteint ta limite mensuelle de ${q?.limit ?? 50} requêtes (plan ${planLabel}). Pour continuer, mets à niveau ton abonnement depuis les Paramètres.`,
              },
            ])
            return
          }
        }
        throw new Error('Failed to send message.')
      }

      const data = await response.json()
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
                ? executionMode === 'auto'
                  ? lang === 'en'
                    ? 'I prepared the action for review because a manual check is still required.'
                    : "J'ai préparé l'action pour révision car une vérification manuelle est encore requise."
                  : lang === 'en'
                    ? 'Action ready. Review it and approve when you want me to send it.'
                    : "Action prête. Revois-la et approuve quand tu veux que je l'envoie."
                : lang === 'en'
                  ? 'Done. The action was executed automatically.'
                  : 'Fait. L\'action a été exécutée automatiquement.',
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
        { id: `error-${Date.now()}`, role: 'assistant', content: t.chat.error },
      ])
    } finally {
      const elapsed = Date.now() - startedAt
      if (elapsed < 900) {
        await new Promise((resolve) => setTimeout(resolve, 900 - elapsed))
      }
      setIsLoading(false)
      setIsStreaming(false)
    }
  }, [t])

  const handleApprove = useCallback(async (id: string) => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/actions/${id}/approve`, { method: 'POST' })
      if (!response.ok) throw new Error('Failed to approve action.')
      const data = await response.json()
      const handledIds = Array.isArray(data.actions)
        ? new Set((data.actions as Array<{ id?: string }>).map((a) => a.id).filter(Boolean))
        : new Set<string>([id])
      setProposals((prev) => prev.filter((p) => !handledIds.has(p.id)))
      if (data.assistantMessage) setMessages((prev) => [...prev, data.assistantMessage])
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleReject = useCallback(async (id: string) => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/actions/${id}/reject`, { method: 'POST' })
      if (!response.ok) throw new Error('Failed to reject action.')
      const data = await response.json()
      const handledIds = Array.isArray(data.actions)
        ? new Set((data.actions as Array<{ id?: string }>).map((a) => a.id).filter(Boolean))
        : new Set<string>([id])
      setProposals((prev) => prev.filter((p) => !handledIds.has(p.id)))
      if (data.assistantMessage) setMessages((prev) => [...prev, data.assistantMessage])
    } finally {
      setIsLoading(false)
    }
  }, [])

  const userFallback = user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress || 'User'

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <p className={styles.eyebrow}>{t.chat.eyebrow}</p>
          <h1 className={styles.title}>{t.chat.title}</h1>
          <p className={styles.subtitle}>{t.chat.subtitle}</p>
        </div>
      </header>
      <div className={styles.messages}>
        {isBootstrapping && messages.length === 0 ? (
          <MessageBubble role="assistant" content={t.chat.loading} isStreaming userFallback={userFallback} />
        ) : null}
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            role={message.role}
            content={message.content}
            userFallback={userFallback}
            isStreaming={isStreaming && message.role === 'assistant' && message.id === messages[messages.length - 1].id}
          />
        ))}
        {isLoading ? (
          <MessageBubble role="assistant" content="" thinking userFallback={userFallback} />
        ) : null}
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
      />
    </div>
  )
}
