'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { Button } from '@/components/ui'
import styles from './error.module.css'

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
    <div className={styles.shell}>
      <div className={styles.panel}>
        <p className={styles.eyebrow}>Workspace recovery</p>
        <h1 className={styles.title}>Une erreur a interrompu le dashboard.</h1>
        <p className={styles.copy}>
          Une erreur a interrompu cette page du workspace. Tu peux relancer l’écran ou revenir à l’accueil.
        </p>
        <div className={styles.actions}>
          <Button onClick={() => reset()}>Réessayer</Button>
          <Button asChild variant="secondary">
            <Link href="/">Retour à l’accueil</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
