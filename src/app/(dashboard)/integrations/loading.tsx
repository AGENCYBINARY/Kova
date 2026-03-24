import styles from '../loading.module.css'

export default function IntegrationsLoading() {
  return (
    <div className={styles.page}>
      <div className={`${styles.skeleton} ${styles.header}`} />
      <div className={styles.row}>
        <div className={`${styles.skeleton} ${styles.card}`} />
        <div className={`${styles.skeleton} ${styles.card}`} />
      </div>
      <div className={styles.row}>
        <div className={`${styles.skeleton} ${styles.cardTall}`} />
        <div className={`${styles.skeleton} ${styles.cardTall}`} />
        <div className={`${styles.skeleton} ${styles.cardTall}`} />
      </div>
    </div>
  )
}
