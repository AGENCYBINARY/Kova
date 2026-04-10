import Link from 'next/link'
import type { Metadata } from 'next'
import styles from '../legal.module.css'

export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'Terms of Use — Kova',
  description: 'Terms governing access to and use of Kova by AGENCY BINARY.',
}

export default function TermsPage() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <Link href="/" className={styles.back}>
          Back to Kova
        </Link>

        <section className={styles.hero}>
          <p className={styles.eyebrow}>Terms Of Use</p>
          <h1 className={styles.title}>Terms of use for Kova by AGENCY BINARY</h1>
          <p className={styles.subtitle}>
            These terms govern access to and use of the Kova application, including connected integrations and AI-assisted execution workflows.             By creating an
            account or using Kova, you agree to these terms and to our{' '}
            <Link href="/privacy" className={styles.inlineLink}>
              Privacy policy
            </Link>
            .
          </p>
          <p className={`${styles.subtitle} ${styles.metaDate}`}>
            <strong>Last updated:</strong> April 6, 2026
          </p>
        </section>

        <section className={styles.section}>
          <h2>Who may use the service</h2>
          <p>
            You must be legally able to enter a binding contract in your jurisdiction and use Kova only for lawful business or professional purposes. You are
            responsible for the accuracy of information you provide and for maintaining the security of your account credentials.
          </p>
        </section>

        <section className={styles.section}>
          <h2>The service</h2>
          <p>
            Kova provides professional workflow automation and operational assistance. Features may include chat, action preparation, approval flows, and
            connections to third-party services you authorize. We may modify, add, or discontinue features with reasonable notice where practicable.
          </p>
        </section>

        <section className={styles.section}>
          <h2>AI-assisted outputs</h2>
          <p>
            Kova may use artificial intelligence to interpret requests and draft content or actions. Outputs can be incomplete or incorrect. You remain
            responsible for reviewing suggestions before approval or sending, and for compliance with applicable laws, contracts, and workplace policies. Nothing
            in the service constitutes legal, financial, medical, or other professional advice.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Subscriptions and fees</h2>
          <p>
            Some plans may be billed on a subscription basis through our payment provider. Fees, renewal, and cancellation terms are presented at checkout
            and in your billing portal. Taxes may apply. Failure to pay may result in suspension or termination of access.
          </p>
        </section>

        <section className={styles.section}>
          <h2>User responsibilities</h2>
          <ul>
            <li>You are responsible for actions approved and executed from your workspace.</li>
            <li>You must ensure that connected third-party accounts are used with proper authorization from the account owner or organization.</li>
            <li>You must not use the service to violate law, harass others, distribute malware, scrape without permission, or send unlawful or deceptive content.</li>
            <li>You must not attempt to bypass security, probe vulnerabilities without authorization, or overload our systems.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>Integrations and external services</h2>
          <p>
            Kova may connect to services such as Google Workspace and Notion. Your use of those services remains subject to their own terms and policies.
            AGENCY BINARY is not responsible for outages, limitations, or policy changes imposed by third-party providers. Revoking access in the third-party
            product may limit or break related features in Kova.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Intellectual property</h2>
          <p>
            Kova, its branding, and our software are owned by AGENCY BINARY or our licensors. Subject to these terms, we grant you a limited, non-exclusive,
            non-transferable right to use Kova for your internal business purposes. You retain rights in your own content; you grant us a license to host,
            process, and display it as needed to operate the service.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Confidentiality</h2>
          <p>
            We treat your workspace data in accordance with our Privacy policy. You agree not to misuse or disclose non-public information about Kova that we
            designate as confidential, except as required by law.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Suspension and termination</h2>
          <p>
            We may suspend or terminate access if you materially breach these terms, create risk or legal exposure, or if we must comply with law. You may stop
            using Kova at any time. Provisions that by nature should survive (including liability limits, governing law, and disputes) will survive termination.
          </p>
        </section>

        <section className={styles.section}>
          <h2>No warranty</h2>
          <p>
            The service is provided on an &quot;as is&quot; and &quot;as available&quot; basis. To the fullest extent permitted by law, we disclaim all
            warranties, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. We do not guarantee uninterrupted
            availability, error-free execution, or success of every automated action in third-party systems.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, AGENCY BINARY and its affiliates, directors, and employees will not be liable for indirect, incidental,
            special, consequential, or punitive damages, or loss of profits, data, or goodwill, arising from use of the service or third-party integrations.
          </p>
          <p>
            Our aggregate liability for claims arising out of or related to the service in any twelve-month period is limited to the greater of (a) the fees you
            paid us for the service in that period or (b) one hundred euros (€100), except where liability cannot be limited under mandatory law.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Indemnity</h2>
          <p>
            You will defend and indemnify AGENCY BINARY against third-party claims arising from your content, your use of integrations without authorization,
            or your violation of these terms or applicable law, to the extent permitted by law.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Governing law and disputes</h2>
          <p>
            These terms are governed by the laws of <strong>France</strong>, without regard to conflict-of-law rules. Courts located in France have exclusive
            jurisdiction over disputes, subject to mandatory consumer protections that may apply in your country of residence.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Changes to these terms</h2>
          <p>
            We may update these terms to reflect legal or product changes. We will post the new version on this page and update the “Last updated” date. If a
            change is material, we will provide notice by email or in-app where reasonable. Continued use after the effective date constitutes acceptance of
            the updated terms.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Contact</h2>
          <p>
            For legal or contractual questions: <a href="mailto:contact@agencybinary.fr">contact@agencybinary.fr</a>.
          </p>
        </section>
      </div>
    </main>
  )
}
