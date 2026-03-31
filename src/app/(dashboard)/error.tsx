'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { Button } from '@/components/ui'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Dashboard route error:', error)
  }, [error])

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '32px',
      }}
    >
      <div
        style={{
          width: 'min(560px, 100%)',
          padding: '28px',
          borderRadius: '28px',
          border: '1px solid rgba(255,255,255,0.06)',
          background:
            'radial-gradient(circle at top right, rgba(106,140,255,0.08), transparent 28%), linear-gradient(180deg, rgba(10,13,19,0.9), rgba(7,9,13,0.96))',
          boxShadow: '0 24px 60px rgba(0,0,0,0.22)',
        }}
      >
        <p
          style={{
            margin: '0 0 10px',
            fontSize: '11px',
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--accent-blue)',
          }}
        >
          Dashboard
        </p>
        <h1
          style={{
            margin: '0 0 10px',
            fontSize: '30px',
            lineHeight: 1.02,
            letterSpacing: '-0.05em',
          }}
        >
          Une erreur a interrompu le workspace.
        </h1>
        <p
          style={{
            margin: '0 0 18px',
            fontSize: '14px',
            lineHeight: 1.7,
            color: 'rgba(255,255,255,0.56)',
          }}
        >
          Le dashboard a rencontré une exception côté client. Tu peux relancer l’écran immédiatement ou revenir à la
          page d’accueil.
        </p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Button onClick={() => reset()}>Réessayer</Button>
          <Link href="/">
            <Button variant="secondary">Retour à l’accueil</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
