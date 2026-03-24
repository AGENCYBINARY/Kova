import styles from '../loading.module.css'

export default function SettingsLoading() {
  return (
    <div className={styles.page}>
      <div className={`${styles.skeleton} ${styles.headerSm}`} />
      <div className={`${styles.skeleton} ${styles.block}`} />
      <div className={`${styles.skeleton} ${styles.block}`} />
      <div className={`${styles.skeleton} ${styles.block}`} />
      <div className={`${styles.skeleton} ${styles.block}`} />
    </div>
  )
}
