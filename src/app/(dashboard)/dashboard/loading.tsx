import styles from '../loading.module.css'

export default function DashboardLoading() {
  return (
    <div className={styles.page}>
      <div className={`${styles.skeleton} ${styles.header}`} />
      <div className={styles.row}>
        <div className={`${styles.skeleton} ${styles.card}`} />
        <div className={`${styles.skeleton} ${styles.card}`} />
        <div className={`${styles.skeleton} ${styles.card}`} />
        <div className={`${styles.skeleton} ${styles.card}`} />
      </div>
      <div className={styles.row}>
        <div className={`${styles.skeleton} ${styles.cardTall}`} />
        <div className={`${styles.skeleton} ${styles.cardTall}`} />
      </div>
      <div className={`${styles.skeleton} ${styles.table}`} />
    </div>
  )
}
