import Link from 'next/link'
import styles from '../legal.module.css'

export default function TermsPage() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <Link href="/" className={styles.back}>
          Back to AGENCY BINARY
        </Link>

        <section className={styles.hero}>
          <p className={styles.eyebrow}>Terms Of Use</p>
          <h1 className={styles.title}>Terms of use for CODEX by AGENCY BINARY</h1>
          <p className={styles.subtitle}>
            These terms govern access to and use of the CODEX application, including connected integrations and AI-assisted execution workflows.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Use of the service</h2>
          <p>
            CODEX is provided for professional workflow automation and operational assistance. You agree to use the service only for lawful purposes and in compliance with all applicable rules and provider policies.
          </p>
        </section>

        <section className={styles.section}>
          <h2>User responsibilities</h2>
          <ul>
            <li>You are responsible for actions approved and executed from your workspace.</li>
            <li>You must ensure that connected third-party accounts are used with proper authorization.</li>
            <li>You must not use the service to send unlawful, abusive, or unauthorized content.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>Integrations and external services</h2>
          <p>
            CODEX may connect to services such as Google Workspace and Notion. Your use of those services remains subject to their own terms and policies. AGENCY BINARY is not responsible for outages, limitations, or policy changes imposed by third-party providers.
          </p>
        </section>

        <section className={styles.section}>
          <h2>No warranty</h2>
          <p>
            The service is provided on an &quot;as is&quot; and &quot;as available&quot; basis. While we aim for reliability, we do not guarantee uninterrupted availability, error-free execution, or provider-side success for every automated action.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, AGENCY BINARY will not be liable for indirect, incidental, special, consequential, or punitive damages arising from use of the service or third-party integrations.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Contact</h2>
          <p>
            For legal or contractual questions, contact contact@agencybinary.fr.
          </p>
        </section>
      </div>
    </main>
  )
}
