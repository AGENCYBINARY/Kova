import { DashboardOverview } from '@/components/dashboard/DashboardOverview'
import { getDashboardBundle } from '@/lib/dashboard/server'
import styles from './page.module.css'

export default async function DashboardOverviewPage() {
  try {
    const data = await getDashboardBundle()
    return <DashboardOverview data={data} />
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'Erreur inconnue'
    return (
      <div className={styles.container}>
        <div className={styles.loadError}>
          <p className={styles.loadErrorTitle}>Impossible de charger le tableau de bord</p>
          <p className={styles.loadErrorHint}>
            Vérifie la connexion base de données, les variables d’environnement et les logs Vercel. Détail ci-dessous pour le
            support.
          </p>
          <pre className={styles.loadErrorPre}>{message}</pre>
        </div>
      </div>
    )
  }
}
