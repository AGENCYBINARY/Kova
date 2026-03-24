import styles from '../loading.module.css'

export default function ChatLoading() {
  return (
    <div className={styles.page}>
      <div className={`${styles.skeleton} ${styles.headerSm}`} />
      <div className={`${styles.skeleton} ${styles.block}`} />
      <div className={`${styles.skeleton} ${styles.block}`} style={{ width: '70%' }} />
      <div className={`${styles.skeleton} ${styles.block}`} style={{ width: '85%' }} />
      <div className={`${styles.skeleton} ${styles.card}`} style={{ marginTop: 'auto', height: 60 }} />
    </div>
  )
}
