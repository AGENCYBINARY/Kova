'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'

interface IntegrationActionsProps {
  provider: 'google' | 'notion' | 'slack'
  status: 'connected' | 'disconnected' | 'error'
  needsReconnect?: boolean
}

export function IntegrationActions({ provider, status, needsReconnect }: IntegrationActionsProps) {
  const router = useRouter()

  const handleRefresh = async () => {
    await fetch(`/api/integrations/${provider}/refresh`, { method: 'POST' })
    router.refresh()
  }

  const handleDisconnect = async () => {
    await fetch(`/api/integrations/${provider}/disconnect`, { method: 'POST' })
    router.refresh()
  }

  if (provider === 'slack') {
    return (
      <Button variant="ghost" size="sm" disabled>
        Soon
      </Button>
    )
  }

  if (status === 'connected') {
    return (
      <>
        {needsReconnect ? (
          <a href={`/api/integrations/connect/${provider}`}>
            <Button variant="primary" size="sm">
              Reconnect
            </Button>
          </a>
        ) : null}
        <Button variant="secondary" size="sm" onClick={handleRefresh}>
          Refresh
        </Button>
        <Button variant="danger" size="sm" onClick={handleDisconnect}>
          Disconnect
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
