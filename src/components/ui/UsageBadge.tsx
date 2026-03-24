"use client"
import { useEffect, useState } from "react"

type QuotaData = {
  plan: string
  used: number
  limit: number
  allowed: boolean
}

export function UsageBadge() {
  const [quota, setQuota] = useState<QuotaData | null>(null)
  const [upgrading, setUpgrading] = useState(false)
  const [upgradeError, setUpgradeError] = useState<string | null>(null)

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
  const barWidth = Math.min(pct, 100) + "%"

  const barColor = isAtLimit ? "#ef4444" : isNearLimit ? "#f59e0b" : "rgba(255,255,255,0.2)"
  const textColor = isAtLimit ? "rgba(239,68,68,0.9)" : isNearLimit ? "rgba(245,158,11,0.9)" : "rgba(255,255,255,0.3)"

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

  const planLabel = quota.plan.charAt(0).toUpperCase() + quota.plan.slice(1)

  return (
    <div style={{ padding: "0 10px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
      {/* One-line compact badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 8 }}>
        <span style={{ fontSize: 10, color: textColor, fontWeight: 500, letterSpacing: "0.02em", whiteSpace: "nowrap" }}>
          {planLabel} · {quota.used}/{quota.limit}
        </span>
        <div style={{ flex: 1, height: 2, background: "rgba(255,255,255,0.06)", borderRadius: 99, overflow: "hidden" }}>
          <div style={{ width: barWidth, height: "100%", background: barColor, borderRadius: 99, transition: "width 0.4s" }} />
        </div>
      </div>

      {/* Upgrade buttons only if free */}
      {quota.plan === "free" && (
        <>
          <div style={{ display: "flex", gap: 5 }}>
            <button
              onClick={() => upgrade("plus")}
              disabled={upgrading}
              style={{ flex: 1, fontSize: 10, padding: "4px 0", borderRadius: 7, background: "rgba(99,102,241,0.2)", border: "none", color: upgrading ? "rgba(165,163,255,0.4)" : "rgba(165,163,255,0.9)", cursor: upgrading ? "default" : "pointer", fontWeight: 500 }}
            >
              {upgrading ? "…" : "Plus 10€"}
            </button>
            <button
              onClick={() => upgrade("pro")}
              disabled={upgrading}
              style={{ flex: 1, fontSize: 10, padding: "4px 0", borderRadius: 7, background: "rgba(255,255,255,0.05)", border: "none", color: upgrading ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.4)", cursor: upgrading ? "default" : "pointer", fontWeight: 500 }}
            >
              {upgrading ? "…" : "Pro 25€"}
            </button>
          </div>
          {upgradeError && (
            <p style={{ fontSize: 9, color: "rgba(239,68,68,0.8)", margin: 0, padding: "2px 8px", textAlign: "center" }}>
              {upgradeError}
            </p>
          )}
        </>
      )}

      {(quota.plan === "plus" || quota.plan === "pro") && (
        <button
          onClick={openPortal}
          style={{ width: "100%", fontSize: 10, padding: "4px 0", borderRadius: 7, background: "rgba(255,255,255,0.05)", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer" }}
        >
          Gérer l&apos;abonnement
        </button>
      )}
    </div>
  )
}
