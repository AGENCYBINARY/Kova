"use client"

import { useEffect, useState } from "react"
import { Zap } from "lucide-react"

type QuotaData = {
  plan: string
  used: number
  limit: number
  allowed: boolean
}

export function UsageBadge() {
  const [quota, setQuota] = useState<QuotaData | null>(null)

  useEffect(() => {
    fetch("/api/subscription")
      .then((r) => r.json())
      .then(setQuota)
      .catch(() => null)
  }, [])

  if (!quota) return null

  const pct = Math.round((quota.used / quota.limit) * 100)
  const isNearLimit = pct >= 80
  const isAtLimit = !quota.allowed

  const upgrade = async (plan: "plus" | "pro") => {
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    })
    const data = await res.json()
    if (data.url) window.location.href = data.url
  }

  const openPortal = async () => {
    const res = await fetch("/api/stripe/portal", { method: "POST" })
    const data = await res.json()
    if (data.url) window.location.href = data.url
  }

  const planLabel = quota.plan.charAt(0).toUpperCase() + quota.plan.slice(1)

  return (
    <div className="p-3 mx-2 mb-2 rounded-xl bg-white/5 border border-white/10 text-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-white/70">
          <Zap className="w-3.5 h-3.5" />
          <span>Plan {planLabel}</span>
        </div>
        <span className={}>
          {quota.used}/{quota.limit}
        </span>
      </div>

      {/* Barre de progression */}
      <div className="h-1 bg-white/10 rounded-full overflow-hidden mb-2.5">
        <div
          className={}
          style={{ width:  }}
        />
      </div>

      {/* CTA */}
      {quota.plan === "free" && (
        <div className="flex gap-1.5">
          <button
            onClick={() => upgrade("plus")}
            className="flex-1 text-xs py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            Plus — 10€
          </button>
          <button
            onClick={() => upgrade("pro")}
            className="flex-1 text-xs py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            Pro — 25€
          </button>
        </div>
      )}
      {(quota.plan === "plus" || quota.plan === "pro") && (
        <button
          onClick={openPortal}
          className="w-full text-xs py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
        >
          Gérer mon abonnement
        </button>
      )}
    </div>
  )
}
