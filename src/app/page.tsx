import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import KovaDemoVideo from '@/components/landing/KovaDemoVideo'
import styles from './page.module.css'

const features = [
  {
    icon: '💬',
    title: 'Copilot Chat',
    desc: 'Parle en langage naturel. Kova comprend ce que tu veux faire, prépare l\'action, et te la soumet.',
  },
  {
    icon: '✅',
    title: 'Approval Queue',
    desc: 'Chaque action passe par validation avant de toucher un outil externe. Tu gardes un contrôle total.',
  },
  {
    icon: '📋',
    title: 'Execution History',
    desc: 'Un audit complet de toutes les actions exécutées, rejetées ou en échec. Rien n\'est perdu.',
  },
  {
    icon: '🔗',
    title: '5 Integrations',
    desc: 'Gmail, Google Calendar, Notion, Google Docs et Google Drive. Tout connecté en quelques secondes.',
  },
  {
    icon: '📊',
    title: 'Workspace View',
    desc: 'Vue opérateur avec métriques en temps réel, santé des intégrations et activité récente.',
  },
  {
    icon: '⚡',
    title: 'Auto Execution',
    desc: 'Configure les politiques d\'approbation : demander toujours, ou exécuter automatiquement les actions à faible risque.',
  },
]

const integrations = [
  { name: 'Gmail', color: '#EA4335', icon: '✉' },
  { name: 'Calendar', color: '#4285F4', icon: '◷' },
  { name: 'Notion', color: '#ffffff', icon: 'N' },
  { name: 'Google Docs', color: '#34A853', icon: 'G' },
  { name: 'Drive', color: '#0F9D58', icon: '▲' },
]

export default function HomePage() {
  const { userId } = auth()
  if (userId) redirect('/dashboard')

  return (
    <div className={styles.root}>
      {/* Ambient background orbs */}
      <div className={styles.orbBlue} aria-hidden />
      <div className={styles.orbPurple} aria-hidden />
      <div className={styles.orbGold} aria-hidden />

      {/* ── Nav ── */}
      <header className={styles.nav}>
        <div className={styles.navInner}>
          <Link href="/" className={styles.brand}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="#6a8cff" />
              <path d="M2 17L12 22L22 17" stroke="#6a8cff" strokeWidth="2" strokeLinecap="round" />
              <path d="M2 12L12 17L22 12" stroke="#6a8cff" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
            </svg>
            <span>Kova</span>
          </Link>
          <div className={styles.navLinks}>
            <a href="#features" className={styles.navLink}>Fonctionnalités</a>
            <a href="#demo" className={styles.navLink}>Démo</a>
            <Link href="/sign-in" className={styles.navSignIn}>Connexion</Link>
            <Link href="/sign-up" className={styles.navCta}>Commencer</Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className={styles.hero}>
        <div className={styles.heroBadge}>
          <span className={styles.badgePulse} />
          AI Executive Assistant · v1.0
        </div>

        <h1 className={styles.heroTitle}>
          Les opérations,
          <br />
          <span className={styles.heroGradient}>à la vitesse de la pensée</span>
        </h1>

        <p className={styles.heroSub}>
          Connecte tes outils. Délègue à l&apos;IA.
          <br />
          Valide avant que rien ne parte.
        </p>

        <div className={styles.heroCtas}>
          <Link href="/sign-up" className={styles.ctaPrimary}>
            Ouvrir mon espace de travail
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
          <a href="#demo" className={styles.ctaGhost}>
            Voir la démo ↓
          </a>
        </div>

        {/* Integration chips */}
        <div className={styles.integRow}>
          {integrations.map((app) => (
            <div key={app.name} className={styles.integChip}>
              <span className={styles.integIcon} style={{ color: app.color }}>{app.icon}</span>
              {app.name}
            </div>
          ))}
        </div>
      </section>

      {/* ── Demo video ── */}
      <section id="demo" className={styles.demoSection}>
        <div className={styles.sectionHead}>
          <p className={styles.eyebrow}>Démo produit</p>
          <h2 className={styles.sectionTitle}>Kova en action</h2>
          <p className={styles.sectionSub}>
            Du langage naturel à l&apos;action exécutée — en quelques secondes.
          </p>
        </div>
        <KovaDemoVideo />
      </section>

      {/* ── Features ── */}
      <section id="features" className={styles.featuresSection}>
        <div className={styles.sectionHead}>
          <p className={styles.eyebrow}>Fonctionnalités</p>
          <h2 className={styles.sectionTitle}>Tout ce qu&apos;il faut, rien de superflu</h2>
        </div>
        <div className={styles.featGrid}>
          {features.map((f) => (
            <div key={f.title} className={styles.featCard}>
              <div className={styles.featEmoji}>{f.icon}</div>
              <h3 className={styles.featTitle}>{f.title}</h3>
              <p className={styles.featDesc}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA banner ── */}
      <section className={styles.ctaBanner}>
        <div className={styles.ctaBannerInner}>
          <div className={styles.ctaBannerGlow} aria-hidden />
          <p className={styles.ctaBannerEye}>Prêt à déléguer ?</p>
          <h2 className={styles.ctaBannerTitle}>Lance ton workspace Kova</h2>
          <p className={styles.ctaBannerSub}>Connexion en 2 minutes. Aucune carte bancaire requise.</p>
          <Link href="/sign-up" className={styles.ctaPrimary}>
            Commencer gratuitement
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <Link href="/" className={styles.brand} style={{ opacity: 0.5 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor" />
              <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
            </svg>
            <span>Kova</span>
          </Link>
          <div className={styles.footerLinks}>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
          <p className={styles.footerCopy}>© 2026 Agency Binary</p>
        </div>
      </footer>
    </div>
  )
}
