"use client"
import { useState } from "react"
import useSWR from "swr"
import { dashboardSWRConfig } from "@/lib/swr-fetch"

type QuotaData = {
  plan: string
  used: number
  limit: number
  allowed: boolean
}

function isQuotaData(value: unknown): value is QuotaData {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.plan === 'string' &&
    typeof candidate.used === 'number' &&
    typeof candidate.limit === 'number' &&
    typeof candidate.allowed === 'boolean'
  )
}

type UsageBadgeProps = {
  /** Quota from parent (e.g. bundled sidebar API). */
  quota?: QuotaData | null
  /** When true, parent is still loading bundled data — no duplicate /api/subscription fetch. */
  loading?: boolean
}

async function subscriptionFetcher(url: string): Promise<QuotaData | null> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin" })
  if (!response.ok) {
    return null
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return null
  }
  return isQuotaData(payload) ? payload : null
}

export function UsageBadge({ quota: quotaProp, loading = false }: UsageBadgeProps) {
  const [upgrading, setUpgrading] = useState(false)
  const [upgradeError, setUpgradeError] = useState<string | null>(null)

  const fetchSubscription = !loading && quotaProp === undefined
  const { data: swrQuota, isLoading: subLoading } = useSWR<QuotaData | null>(
    fetchSubscription ? "/api/subscription" : null,
    subscriptionFetcher,
    dashboardSWRConfig
  )

  const quota = quotaProp !== undefined ? quotaProp : swrQuota

  if (loading || (fetchSubscription && subLoading)) {
    return null
  }

  if (!quota || quota.limit <= 0) return null

  const pct = Math.round((quota.used / quota.limit) * 100)
  const isNearLimit = pct >= 80
  const isAtLimit = !quota.allowed
  const barWidth = Math.min(pct, 100) + "%"

  const barColor = isAtLimit ? '#ef4444' : isNearLimit ? '#f0bf6d' : 'rgba(255,255,255,0.22)'
  const textColor = isAtLimit ? 'rgba(255,128,141,0.92)' : isNearLimit ? 'rgba(240,191,109,0.92)' : 'rgba(255,255,255,0.42)'

  const upgrade = async (plan: "plus" | "pro") => {
    setUpgrading(true)
    setUpgradeError(null)
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        setUpgradeError(data.error || "Erreur lors de la redirection")
        setUpgrading(false)
      }
    } catch {
      setUpgradeError("Connexion impossible au serveur")
      setUpgrading(false)
    }
  }

  const openPortal = async () => {
    const res = await fetch("/api/stripe/portal", { method: "POST" })
    const data = await res.json()
    if (data.url) window.location.href = data.url
  }

  const rawPlan = typeof quota.plan === 'string' ? quota.plan : ''
  const normalizedPlan = rawPlan.trim()
  const planLabel = normalizedPlan ? normalizedPlan.charAt(0).toUpperCase() + normalizedPlan.slice(1) : 'Plan'

  return (
    <div style={{ padding: '0 0 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.05)',
          background: 'rgba(255,255,255,0.018)',
        }}
      >
        <span style={{ fontSize: 10, color: textColor, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
          Usage
        </span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.66)', whiteSpace: 'nowrap' }}>
          {planLabel} · {quota.used}/{quota.limit}
        </span>
        <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ width: barWidth, height: '100%', background: barColor, borderRadius: 99, transition: 'width 0.4s' }} />
        </div>
      </div>

      {quota.plan === 'free' && (
        <>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => upgrade('plus')}
              disabled={upgrading}
              style={{
                flex: 1,
                fontSize: 10,
                padding: '7px 0',
                borderRadius: 10,
                background: 'linear-gradient(135deg, rgba(106,140,255,0.22), rgba(79,169,205,0.16))',
                border: '1px solid rgba(106,140,255,0.16)',
                color: upgrading ? 'rgba(255,255,255,0.3)' : 'rgba(245,247,251,0.92)',
                cursor: upgrading ? 'default' : 'pointer',
                fontWeight: 600,
              }}
            >
              {upgrading ? '…' : 'Plus 10€'}
            </button>
            <button
              onClick={() => upgrade('pro')}
              disabled={upgrading}
              style={{
                flex: 1,
                fontSize: 10,
                padding: '7px 0',
                borderRadius: 10,
                background: 'rgba(255,255,255,0.035)',
                border: '1px solid rgba(255,255,255,0.06)',
                color: upgrading ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.62)',
                cursor: upgrading ? 'default' : 'pointer',
                fontWeight: 600,
              }}
            >
              {upgrading ? '…' : 'Pro 25€'}
            </button>
          </div>
          {upgradeError && (
            <p style={{ fontSize: 10, color: 'rgba(255,128,141,0.88)', margin: 0, padding: '2px 6px', textAlign: 'center' }}>
              {upgradeError}
            </p>
          )}
        </>
      )}

      {(quota.plan === 'plus' || quota.plan === 'pro') && (
        <button
          onClick={openPortal}
          style={{
            width: '100%',
            fontSize: 10,
            padding: '7px 0',
            borderRadius: 10,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.05)',
            color: 'rgba(255,255,255,0.55)',
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
          }}
        >
          Gérer l&apos;abonnement
        </button>
      )}
    </div>
  )
}
