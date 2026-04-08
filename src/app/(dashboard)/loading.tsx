import styles from './loading.module.css'

export default function DashboardRouteLoading() {
  return (
    <div className={styles.page}>
      <div className={`${styles.skeleton} ${styles.headerSm}`} />
      <div className={styles.row}>
        <div className={`${styles.skeleton} ${styles.cardTall}`} />
        <div className={`${styles.skeleton} ${styles.cardTall}`} />
      </div>
      <div className={`${styles.skeleton} ${styles.table}`} />
    </div>
  )
}
