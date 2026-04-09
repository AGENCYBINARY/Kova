'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui'

interface IntegrationActionsProps {
  provider: 'google' | 'notion' | 'slack'
  integrationId?: 'gmail' | 'calendar' | 'notion' | 'google_docs' | 'google_drive' | 'google_photos' | 'slack'
  status: 'connected' | 'disconnected' | 'error'
  needsReconnect?: boolean
}

export function IntegrationActions({ provider, integrationId, status, needsReconnect }: IntegrationActionsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)

  const buildScopedUrl = (basePath: string, error?: string) => {
    const params = new URLSearchParams()
    if (integrationId) {
      params.set('integration', integrationId)
    }
    if (error) {
      params.set('error', error)
    }
    const query = params.toString()
    return query ? `${basePath}?${query}` : basePath
  }

  const handleRefresh = async () => {
    if (isRefreshing) {
      return
    }

    setIsRefreshing(true)
    try {
      const response = await fetch(`/api/integrations/${provider}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: integrationId }),
      })
      const payload = await response.json().catch(() => null) as { error?: string } | null

      if (!response.ok) {
        const message = payload?.error || 'refresh_failed'
        router.push(buildScopedUrl(pathname, message))
        router.refresh()
        return
      }

      router.refresh()
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleDisconnect = async () => {
    if (isDisconnecting) {
      return
    }

    setIsDisconnecting(true)
    try {
      await fetch(`/api/integrations/${provider}/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: integrationId }),
      })
      router.refresh()
    } finally {
      setIsDisconnecting(false)
    }
  }

  if (provider === 'slack') {
    return (
      <Button variant="ghost" size="sm" disabled>
        Soon
      </Button>
    )
  }

  if (status === 'connected' || status === 'error') {
    return (
      <>
        {needsReconnect || status === 'error' ? (
          <a href={`/api/integrations/connect/${provider}`}>
            <Button variant="primary" size="sm">
              Reconnect
            </Button>
          </a>
        ) : null}
        <Button variant="secondary" size="sm" onClick={handleRefresh} disabled={isRefreshing || isDisconnecting}>
          {isRefreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
        <Button variant="danger" size="sm" onClick={handleDisconnect} disabled={isRefreshing || isDisconnecting}>
          {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
        </Button>
      </>
    )
  }

  return (
    <a href={`/api/integrations/connect/${provider}`}>
      <Button variant="primary" size="sm">
        Connect
      </Button>
    </a>
  )
}
