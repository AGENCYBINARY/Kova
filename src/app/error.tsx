'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { Button } from '@/components/ui'
import { buttonClassNames } from '@/components/ui/button-classes'
import styles from './error.module.css'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('App route error:', error)
  }, [error])

  return (
    <div className={styles.page}>
      <div className={styles.panel}>
        <p className={styles.eyebrow}>Kova</p>
        <h1 className={styles.title}>Une erreur a interrompu l’interface.</h1>
        <p className={styles.description}>
          L’écran a rencontré une exception côté client. Tu peux relancer immédiatement ou revenir au dashboard.
        </p>
        <div className={styles.actions}>
          <Button onClick={() => reset()}>Réessayer</Button>
          <Link href="/dashboard" className={buttonClassNames({ variant: 'secondary' })}>
            Aller au dashboard
          </Link>
          <Link href="/" className={buttonClassNames({ variant: 'ghost' })}>
            Retour à l’accueil
          </Link>
        </div>
      </div>
    </div>
  )
}
