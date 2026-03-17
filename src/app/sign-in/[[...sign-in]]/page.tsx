import { SignIn } from '@clerk/nextjs'
import styles from '../auth.module.css'

export default function SignInPage() {
  return (
    <div className={styles.container}>
      <div className={styles.shell}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>CODEX Access</p>
          <h1 className={styles.title}>Sign in to your operator workspace</h1>
          <p className={styles.description}>
            Review actions, approve execution, and monitor your integrations from a single control plane.
          </p>
        </div>
        <div className={styles.panel}>
          <SignIn />
        </div>
      </div>
    </div>
  )
}
