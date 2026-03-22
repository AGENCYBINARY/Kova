import { SignIn } from '@clerk/nextjs'
import Link from 'next/link'
import styles from '../../auth.module.css'

const features = [
  'Chat en langage naturel avec votre IA',
  'Approbation humaine avant chaque action',
  'Gmail, Calendar, Notion, Docs & Drive',
  'Audit complet de toutes les exécutions',
]

export default function SignInPage() {
  return (
    <div className={styles.container}>
      {/* Left — branding */}
      <div className={styles.left}>
        <Link href="/" className={styles.leftBrand}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="#6a8cff" />
            <path d="M2 17L12 22L22 17" stroke="#6a8cff" strokeWidth="2" strokeLinecap="round" />
            <path d="M2 12L12 17L22 12" stroke="#6a8cff" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
          </svg>
          Kova
        </Link>

        <div className={styles.leftContent}>
          <p className={styles.leftEye}>Workspace opérateur</p>
          <h1 className={styles.leftTitle}>
            Votre assistant
            <br />
            <span className={styles.leftGradient}>vous attend</span>
          </h1>
          <p className={styles.leftSub}>
            Connectez-vous pour accéder à votre espace de travail et déléguer vos opérations à l&apos;IA.
          </p>
          <div className={styles.leftFeatures}>
            {features.map((f) => (
              <div key={f} className={styles.leftFeatureItem}>
                <span className={styles.leftFeatureDot} />
                {f}
              </div>
            ))}
          </div>
        </div>

        <p className={styles.leftBottom}>© 2026 Agency Binary · Kova v1.0</p>
      </div>

      {/* Right — Clerk form */}
      <div className={styles.right}>
        <div className={styles.formWrap}>
          <SignIn
            fallbackRedirectUrl="/dashboard"
            appearance={{
              variables: {
                colorBackground: '#0b0e14',
                colorInputBackground: '#11151d',
                colorInputText: '#f5f7fb',
                colorText: '#f5f7fb',
                colorTextSecondary: '#9aa4b2',
                colorPrimary: '#6a8cff',
                colorDanger: '#ff6b7a',
                borderRadius: '10px',
                fontFamily: 'Geist, -apple-system, sans-serif',
              },
              elements: {
                card: {
                  background: 'transparent',
                  boxShadow: 'none',
                  border: 'none',
                  padding: '0',
                },
                headerTitle: { color: '#f5f7fb', fontSize: '22px', fontWeight: '700' },
                headerSubtitle: { color: '#9aa4b2' },
                socialButtonsBlockButton: {
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#f5f7fb',
                },
                formFieldInput: {
                  background: '#11151d',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#f5f7fb',
                },
                formButtonPrimary: {
                  background: 'linear-gradient(135deg, #6a8cff, #8f7cff)',
                  boxShadow: '0 4px 20px rgba(106,140,255,0.3)',
                },
                footerActionLink: { color: '#6a8cff' },
              },
            }}
          />
        </div>
      </div>
    </div>
  )
}
