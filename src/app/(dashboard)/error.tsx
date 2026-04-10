'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { Button } from '@/components/ui'
import { buttonClassNames } from '@/components/ui/button-classes'
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
          Le workspace a rencontré une exception côté client. Tu peux relancer l’écran immédiatement ou revenir à
          l’accueil pendant que Kova recharge l’état courant.
        </p>
        <div className={styles.actions}>
          <Button onClick={() => reset()}>Réessayer</Button>
          <Link href="/" className={buttonClassNames({ variant: 'secondary' })}>
            Retour à l’accueil
          </Link>
        </div>
      </div>
    </div>
  )
}
