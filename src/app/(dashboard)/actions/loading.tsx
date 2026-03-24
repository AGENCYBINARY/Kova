import styles from '../loading.module.css'

export default function ActionsLoading() {
  return (
    <div className={styles.page}>
      <div className={`${styles.skeleton} ${styles.header}`} />
      <div className={styles.row}>
        <div className={`${styles.skeleton} ${styles.card}`} />
        <div className={`${styles.skeleton} ${styles.card}`} />
      </div>
      <div className={`${styles.skeleton} ${styles.block}`} />
      <div className={`${styles.skeleton} ${styles.block}`} />
      <div className={`${styles.skeleton} ${styles.block}`} />
    </div>
  )
}
