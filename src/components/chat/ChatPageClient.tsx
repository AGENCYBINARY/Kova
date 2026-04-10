'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { ChatThinkingStatus } from '@/components/chat/ChatThinkingStatus'
import { ChatDisambiguationCard, type ChatDisambiguation } from '@/components/chat/ChatDisambiguationCard'
import { ChatInput } from '@/components/chat/ChatInput'
import { ActionProposalCard } from '@/components/actions/ActionProposalCard'
import { useLang } from '@/lib/lang-context'
import styles from '@/app/(dashboard)/chat/page.module.css'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  metadata?: {
    disambiguations?: ChatDisambiguation[]
    plan?: Array<{
      title?: string
      detail?: string
      app?: string
    }>
  }
}

interface ActionProposal {
  id: string
  type: string
  title: string
  description: string
  parameters: Record<string, unknown>
}

type ExecutionMode = 'ask' | 'auto'

interface ChatPageClientProps {
  initialMessages: Message[]
  initialProposals: ActionProposal[]
  userFallback: string
  bootstrapFromApi?: boolean
}

function buildDisambiguationReply(
  item: ChatDisambiguation,
  option: ChatDisambiguation['options'][number],
  lang: 'fr' | 'en'
) {
  const displayContent =
    lang === 'en'
      ? `Use "${option.label}".`
      : `Utilise "${option.label}".`
  const requestContent = `${displayContent}\n[[kova-ref:${item.source}:${item.field}:${option.id}]]`
  return {
    displayContent,
    requestContent,
  }
}

export function ChatPageClient({ initialMessages, initialProposals, userFallback, bootstrapFromApi = false }: ChatPageClientProps) {
  const { t, lang } = useLang()
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [proposals, setProposals] = useState<ActionProposal[]>(initialProposals)
  const [isLoading, setIsLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isBootstrapping, setIsBootstrapping] = useState(bootstrapFromApi && initialMessages.length === 0 && initialProposals.length === 0)
  const [preferredExecutionMode, setPreferredExecutionMode] = useState<ExecutionMode>('ask')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const hasInitialScrollRef = useRef(false)

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    messagesEndRef.current?.scrollIntoView({ behavior })
  }, [])

  useEffect(() => {
    const behavior = hasInitialScrollRef.current ? 'smooth' : 'auto'
    scrollToBottom(behavior)
    hasInitialScrollRef.current = true
  }, [messages, isStreaming, scrollToBottom])

  useEffect(() => {
    setMessages((previous) => previous.filter((message) => message.id !== 'welcome'))
  }, [])

  const appendSystemError = useCallback(() => {
    setMessages((previous) => [
      ...previous,
      { id: `error-${Date.now()}`, role: 'assistant', content: t.chat.error },
    ])
  }, [t])

  useEffect(() => {
    if (!bootstrapFromApi || (initialMessages.length > 0 || initialProposals.length > 0)) {
      return
    }

    let cancelled = false

    async function bootstrap() {
      try {
        const response = await fetch('/api/chat', {
          cache: 'no-store',
          credentials: 'same-origin',
        })

        if (!response.ok) {
          throw new Error('Failed to load chat bootstrap.')
        }

        const data = await response.json()
        if (cancelled) {
          return
        }

        if (Array.isArray(data.messages)) {
          setMessages(data.messages)
        }

        if (Array.isArray(data.proposals)) {
          setProposals(data.proposals)
        }
      } catch {
        if (!cancelled) {
          appendSystemError()
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false)
        }
      }
    }

    bootstrap()

    return () => {
      cancelled = true
    }
  }, [appendSystemError, bootstrapFromApi, initialMessages.length, initialProposals.length])

  const submitTurn = useCallback(async (params: {
    displayContent: string
    requestContent?: string
    executionMode: ExecutionMode
  }) => {
    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: params.displayContent }
    setPreferredExecutionMode(params.executionMode)
    setMessages((previous) => [...previous, userMessage])
    setIsLoading(true)
    setIsStreaming(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: params.requestContent || params.displayContent, executionMode: params.executionMode }),
      })

      if (!response.ok) {
        const errData = (await response.json().catch(() => ({}))) as Record<string, unknown>

        if (response.status === 429 && errData.error === 'quota_exceeded') {
          const quota = errData.quota as { plan?: string; limit?: number } | undefined
          const planLabel = quota?.plan === 'free' ? (lang === 'en' ? 'free' : 'gratuit') : (quota?.plan ?? 'free')
          setMessages((previous) => [
            ...previous,
            {
              id: String(Date.now()),
              role: 'assistant',
              content:
                lang === 'en'
                  ? `You have reached your monthly limit of ${quota?.limit ?? 50} requests (${planLabel} plan). Upgrade your subscription from Settings to continue.`
                  : `Tu as atteint ta limite mensuelle de ${quota?.limit ?? 50} requêtes (plan ${planLabel}). Pour continuer, mets à niveau ton abonnement depuis les Paramètres.`,
            },
          ])
          return
        }

        if (response.status === 429 && errData.error === 'rate_limit_exceeded') {
          setMessages((previous) => [
            ...previous,
            {
              id: String(Date.now()),
              role: 'assistant',
              content: typeof errData.message === 'string' ? errData.message : t.chat.error,
            },
          ])
          return
        }

        const messageFr = typeof errData.messageFr === 'string' ? errData.messageFr : null
        const messageEn = typeof errData.messageEn === 'string' ? errData.messageEn : null
        if (messageFr || messageEn) {
          const content =
            lang === 'en' ? messageEn || messageFr || t.chat.error : messageFr || messageEn || t.chat.error
          setMessages((previous) => [
            ...previous,
            { id: String(Date.now()), role: 'assistant', content },
          ])
          return
        }

        throw new Error('Failed to send message.')
      }

      const data = await response.json()
      if (data.assistantMessage) {
        setMessages((previous) => [...previous, data.assistantMessage])
      }
      if (Array.isArray(data.proposals) && data.proposals.length > 0) {
        setProposals((previous) => [...previous, ...data.proposals])
      }
      if (Array.isArray(data.executionMessages) && data.executionMessages.length > 0) {
        setMessages((previous) => [...previous, ...data.executionMessages])
      }
    } catch {
      appendSystemError()
    } finally {
      setIsLoading(false)
      setIsStreaming(false)
    }
  }, [appendSystemError, lang, t])

  const handleSend = useCallback(async (content: string, executionMode: ExecutionMode) => {
    await submitTurn({
      displayContent: content,
      executionMode,
    })
  }, [submitTurn])

  const handleDisambiguationSelect = useCallback(async (item: ChatDisambiguation, option: ChatDisambiguation['options'][number]) => {
    const reply = buildDisambiguationReply(item, option, lang)
    await submitTurn({
      displayContent: reply.displayContent,
      requestContent: reply.requestContent,
      executionMode: preferredExecutionMode,
    })
  }, [lang, preferredExecutionMode, submitTurn])

  const handleApprove = useCallback(async (id: string) => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/actions/${id}/approve`, { method: 'POST' })
      if (!response.ok) {
        throw new Error('Failed to approve action.')
      }

      const data = await response.json()
      const handledIds = Array.isArray(data.actions)
        ? new Set((data.actions as Array<{ id?: string }>).map((action) => action.id).filter(Boolean))
        : new Set<string>([id])

      setProposals((previous) => previous.filter((proposal) => !handledIds.has(proposal.id)))
      if (data.assistantMessage) {
        setMessages((previous) => [...previous, data.assistantMessage])
      }
    } catch {
      appendSystemError()
    } finally {
      setIsLoading(false)
    }
  }, [appendSystemError])

  const handleReject = useCallback(async (id: string) => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/actions/${id}/reject`, { method: 'POST' })
      if (!response.ok) {
        throw new Error('Failed to reject action.')
      }

      const data = await response.json()
      const handledIds = Array.isArray(data.actions)
        ? new Set((data.actions as Array<{ id?: string }>).map((action) => action.id).filter(Boolean))
        : new Set<string>([id])

      setProposals((previous) => previous.filter((proposal) => !handledIds.has(proposal.id)))
      if (data.assistantMessage) {
        setMessages((previous) => [...previous, data.assistantMessage])
      }
    } catch {
      appendSystemError()
    } finally {
      setIsLoading(false)
    }
  }, [appendSystemError])

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
        {isBootstrapping && messages.length === 0 ? <ChatThinkingStatus lang={lang} /> : null}
        {messages.map((message) => (
          <div key={message.id}>
            <MessageBubble
              role={message.role}
              content={message.content}
              metadata={message.metadata}
              userFallback={userFallback}
              isStreaming={isStreaming && message.role === 'assistant' && message.id === messages[messages.length - 1]?.id}
            />
            {message.role === 'assistant' && Array.isArray(message.metadata?.disambiguations)
              ? message.metadata?.disambiguations.map((item, index) => (
                  <ChatDisambiguationCard
                    key={`${message.id}-${item.field}-${index}`}
                    item={item}
                    disabled={isLoading}
                    onSelect={handleDisambiguationSelect}
                  />
                ))
              : null}
          </div>
        ))}
        {isLoading ? <ChatThinkingStatus lang={lang} /> : null}
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
