'use client'

import { useUser } from '@clerk/nextjs'
import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageBubble } from '@/components/chat/MessageBubble'
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
}

const WELCOME_FR = "Je suis votre opérateur Kova. Demandez-moi de rédiger des emails, planifier des réunions, travailler dans Notion, créer des Google Docs ou enregistrer des fichiers sur Google Drive. Je préparerai l'action pour approbation avant exécution."
const WELCOME_EN = "I'm your Kova operator. Ask me to draft emails, schedule meetings, work in Notion, create Google Docs, or save files to Google Drive. I will prepare the action for approval before execution."

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

export function ChatPageClient({ initialMessages, initialProposals }: ChatPageClientProps) {
  const { user } = useUser()
  const { t, lang } = useLang()
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [proposals, setProposals] = useState<ActionProposal[]>(initialProposals)
  const [isLoading, setIsLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [preferredExecutionMode, setPreferredExecutionMode] = useState<ExecutionMode>('ask')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, isStreaming, scrollToBottom])

  const translateMessages = useCallback((items: Message[], currentLang: string) => (
    items.map((message) =>
      message.id === 'welcome'
        ? { ...message, content: currentLang === 'fr' ? WELCOME_FR : WELCOME_EN }
        : message
    )
  ), [])

  useEffect(() => {
    setMessages((previous) => translateMessages(previous, lang))
  }, [lang, translateMessages])

  const appendSystemError = useCallback(() => {
    setMessages((previous) => [
      ...previous,
      { id: `error-${Date.now()}`, role: 'assistant', content: t.chat.error },
    ])
  }, [t])

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
        if (response.status === 429) {
          const errData = await response.json().catch(() => ({}))
          if (errData.error === 'quota_exceeded') {
            const quota = errData.quota
            const planLabel = quota?.plan === 'free' ? (lang === 'en' ? 'free' : 'gratuit') : (quota?.plan ?? 'free')
            setMessages((previous) => [
              ...previous,
              {
                id: String(Date.now()),
                role: 'assistant',
                content: lang === 'en'
                  ? `You have reached your monthly limit of ${quota?.limit ?? 50} requests (${planLabel} plan). Upgrade your subscription from Settings to continue.`
                  : `Tu as atteint ta limite mensuelle de ${quota?.limit ?? 50} requêtes (plan ${planLabel}). Pour continuer, mets à niveau ton abonnement depuis les Paramètres.`,
              },
            ])
            return
          }

          if (errData.error === 'rate_limit_exceeded') {
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
        }

        throw new Error('Failed to send message.')
      }

      const data = await response.json()
      if (data.assistantMessage) {
        setMessages((previous) => [...previous, data.assistantMessage])
      }
      if (Array.isArray(data.proposals) && data.proposals.length > 0) {
        setMessages((previous) => [
          ...previous,
          {
            id: `review-${Date.now()}`,
            role: 'assistant',
            content:
              (data.effectiveExecutionMode || params.executionMode) === 'ask'
                ? params.executionMode === 'auto'
                  ? lang === 'en'
                    ? 'I prepared the action for review because a manual check is still required.'
                    : "J'ai préparé l'action pour révision car une vérification manuelle est encore requise."
                  : lang === 'en'
                    ? 'Action ready. Review it and approve when you want me to send it.'
                    : "Action prête. Revois-la et approuve quand tu veux que je l'envoie."
                : lang === 'en'
                  ? 'Done. The action was executed automatically.'
                  : "Fait. L'action a été exécutée automatiquement.",
          },
        ])
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
        {messages.map((message) => (
          <div key={message.id}>
            <MessageBubble
              role={message.role}
              content={message.content}
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
        {isLoading ? <MessageBubble role="assistant" content="" thinking userFallback={userFallback} /> : null}
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
