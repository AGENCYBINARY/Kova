import Link from 'next/link'
import type { Metadata } from 'next'
import styles from '../legal.module.css'

export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'Privacy Policy — Kova',
  description:
    'How Kova by AGENCY BINARY collects, uses, and protects personal data and connected workspace information.',
}

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <Link href="/" className={styles.back}>
          Back to Kova
        </Link>

        <section className={styles.hero}>
          <p className={styles.eyebrow}>Privacy Policy</p>
          <h1 className={styles.title}>Privacy policy for Kova by AGENCY BINARY</h1>
          <p className={styles.subtitle}>
            This policy explains what data we collect, how we use it, how long we keep it, and your choices. It applies to the Kova web application and related
            services operated by AGENCY BINARY.
          </p>
          <p className={`${styles.subtitle} ${styles.metaDate}`}>
            <strong>Last updated:</strong> April 6, 2026
          </p>
        </section>

        <section className={styles.section}>
          <h2>Who we are</h2>
          <p>
            Kova is operated by <strong>AGENCY BINARY</strong> (“we”, “us”). For privacy requests:{' '}
            <a href="mailto:contact@agencybinary.fr">contact@agencybinary.fr</a>.
          </p>
        </section>

        <section className={styles.section}>
          <h2>What we collect</h2>
          <ul>
            <li>
              <strong>Account data:</strong> name, email address, and authentication identifiers from our identity provider when you sign in.
            </li>
            <li>
              <strong>Workspace activity:</strong> prompts, chat messages, proposed and approved actions, execution results, and audit or history records needed
              to run the product.
            </li>
            <li>
              <strong>Integration data:</strong> metadata required to connect third-party services (for example Google Workspace, Notion), and encrypted OAuth
              access and refresh tokens you explicitly authorize.
            </li>
            <li>
              <strong>Technical data:</strong> limited logs and diagnostics (such as IP address, device/browser type, timestamps, error reports) used for
              security, abuse prevention, and reliability.
            </li>
            <li>
              <strong>Billing data:</strong> if you subscribe to a paid plan, our payment processor handles card and invoice details; we receive subscription
              status and billing identifiers as needed to provide access.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>How we use data</h2>
          <ul>
            <li>To authenticate users, enforce access control, and secure workspaces.</li>
            <li>To operate AI-assisted features: interpret requests, prepare actions, and generate content you request.</li>
            <li>To execute, review, approve, or log actions you initiate through connected integrations.</li>
            <li>To maintain execution history, audit trails, and operational logs as described in the product.</li>
            <li>To provide support, detect fraud or misuse, and improve reliability and security.</li>
            <li>To comply with legal obligations and enforce our terms.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>Google user data</h2>
          <p>
            If you connect a Google account, Kova accesses Google user data only within the OAuth scopes you approve, and only to provide the features you
            request (for example reading or sending email, calendar, or files where applicable). We do not sell Google user data. We do not use Google user data
            for advertising. We do not train generalized machine learning models on your Google content unless we explicitly notify you and you agree.
          </p>
          <p>
            You can disconnect Google at any time from Kova; we stop using that connection for new actions, subject to retention described below.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Legal bases (EEA/UK users)</h2>
          <p>
            Where the GDPR or UK GDPR applies, we rely on: performance of a contract (providing Kova); legitimate interests (security, product improvement,
            fraud prevention), balanced against your rights; consent where required (for example certain marketing or optional analytics, if offered); and legal
            obligation where applicable.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Cookies and similar technologies</h2>
          <p>
            We use cookies and similar technologies as needed for authentication, session security, preferences, and (if enabled) analytics. Essential cookies
            are required for sign-in and core functionality. You can control non-essential cookies through your browser settings where applicable.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Sharing and subprocessors</h2>
          <p>
            We share data with service providers who process it on our instructions, for example: authentication (e.g. Clerk), hosting and infrastructure
            (e.g. Vercel), payment processing (e.g. Stripe), AI inference providers (e.g. Anthropic), and email or monitoring tools as needed to operate the
            service. We require appropriate contractual and security safeguards.
          </p>
          <p>We may disclose information if required by law, court order, or to protect rights, safety, and security.</p>
        </section>

        <section className={styles.section}>
          <h2>International transfers</h2>
          <p>
            We and our providers may process data in the European Economic Area, the United Kingdom, the United States, and other countries where we or they
            operate. Where data is transferred outside the EEA/UK, we use appropriate safeguards such as Standard Contractual Clauses or equivalent mechanisms
            where required.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Retention</h2>
          <p>
            We retain account, workspace, integration, and audit data for as long as your account is active and as needed to provide the service, comply with
            law, resolve disputes, and enforce agreements. When you ask to delete your account or data, we delete or anonymize it within a reasonable period
            unless we must retain specific records for legal reasons.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Security</h2>
          <p>
            We implement technical and organizational measures appropriate to the risk, including encryption in transit, encrypted storage of integration
            tokens, access controls, and monitoring. No method of transmission or storage is 100% secure; we encourage strong passwords and safe use of connected
            accounts.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Your rights</h2>
          <p>
            Depending on your location, you may have rights to access, rectify, erase, restrict or object to certain processing, data portability, and to
            withdraw consent where processing is consent-based. You may lodge a complaint with a supervisory authority. To exercise rights, contact{' '}
            <a href="mailto:contact@agencybinary.fr">contact@agencybinary.fr</a>. We will respond within the timeframes required by applicable law.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Children</h2>
          <p>
            Kova is intended for professionals and is not directed at children under 16 (or the digital consent age in your country). We do not knowingly
            collect personal data from children.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Changes</h2>
          <p>
            We may update this policy to reflect product, legal, or regulatory changes. We will post the revised version on this page and update the “Last
            updated” date. Material changes may be communicated by email or in-app notice where appropriate.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Related documents</h2>
          <p>
            See also our <Link href="/terms">Terms of use</Link>.
          </p>
        </section>
      </div>
    </main>
  )
}
