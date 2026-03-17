import { SignUp } from '@clerk/nextjs'
import styles from '../../sign-in/auth.module.css'

export default function SignUpPage() {
  return (
    <div className={styles.container}>
      <div className={styles.shell}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>Kova Access</p>
          <h1 className={styles.title}>Create your workspace account</h1>
          <p className={styles.description}>
            Start with a controlled execution workspace, then connect Gmail, Calendar, Notion, Google Drive, and more.
          </p>
        </div>
        <div className={styles.panel}>
          <SignUp fallbackRedirectUrl="/dashboard" />
        </div>
      </div>
    </div>
  )
}
