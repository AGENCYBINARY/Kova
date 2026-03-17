import Link from 'next/link'
import styles from '../legal.module.css'

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <Link href="/" className={styles.back}>
          Back to AGENCY BINARY
        </Link>

        <section className={styles.hero}>
          <p className={styles.eyebrow}>Privacy Policy</p>
          <h1 className={styles.title}>Privacy policy for CODEX by AGENCY BINARY</h1>
          <p className={styles.subtitle}>
            This policy explains what data we collect, how we use it, and how connected workspace data is handled inside the CODEX application.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Who we are</h2>
          <p>
            CODEX is operated by AGENCY BINARY. If you have any privacy questions, you can contact us at contact@agencybinary.fr.
          </p>
        </section>

        <section className={styles.section}>
          <h2>What we collect</h2>
          <ul>
            <li>Account information such as name, email address, and authentication identifiers.</li>
            <li>Workspace content you submit through the application, including prompts, messages, actions, and audit logs.</li>
            <li>Integration metadata required to connect services like Google and Notion.</li>
            <li>Encrypted access and refresh tokens when you authorize third-party integrations.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>How we use data</h2>
          <ul>
            <li>To authenticate users and secure access to workspaces.</li>
            <li>To generate, review, approve, and execute requested actions.</li>
            <li>To maintain execution history, audit trails, and operational logs.</li>
            <li>To support and improve product reliability and security.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>Third-party services</h2>
          <p>
            When you connect third-party services such as Google Workspace or Notion, CODEX only uses the permissions explicitly granted by the user. Tokens are stored encrypted and used only to perform approved actions or maintain the requested integrations.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Data retention</h2>
          <p>
            We retain account, workspace, and audit data for as long as required to operate the service, comply with legal obligations, resolve disputes, and enforce agreements, unless a deletion request is received and applicable law allows removal.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Your rights</h2>
          <p>
            You may request access, correction, or deletion of your personal data by contacting contact@agencybinary.fr. We will respond in accordance with applicable law.
          </p>
        </section>
      </div>
    </main>
  )
}
