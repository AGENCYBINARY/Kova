'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { UserButton, useUser } from '@clerk/nextjs'
import { useLang } from '@/lib/lang-context'
import { UsageBadge } from '@/components/ui/UsageBadge'
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher'
import styles from './Sidebar.module.css'

function getNavigation(t: ReturnType<typeof useLang>['t']) {
  return [
    {
      name: t.nav.dashboard,
      href: '/dashboard',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
        </svg>
      ),
    },
    {
      name: t.nav.chat,
      href: '/chat',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
    {
      name: t.nav.actions,
      href: '/actions',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      ),
    },
    {
      name: t.nav.history,
      href: '/history',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
    {
      name: t.nav.integrations,
      href: '/integrations',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      ),
    },
    {
      name: t.nav.settings,
      href: '/settings',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
    },
  ]
}

const defaultIntegrations = [
  { name: 'Gmail', status: 'disconnected', color: '#EA4335' },
  { name: 'Calendar', status: 'disconnected', color: '#4285F4' },
  { name: 'Notion', status: 'disconnected', color: '#000000' },
  { name: 'Docs', status: 'disconnected', color: '#34A853' },
  { name: 'Drive', status: 'disconnected', color: '#0F9D58' },
  { name: 'Slack', status: 'disconnected', color: '#4A154B' },
]

function IntegrationLogo({ name }: { name: string }) {
  if (name === 'Gmail') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 6.75 12 13l9-6.25" stroke="#EA4335" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" stroke="#EA4335" strokeWidth="2" />
      </svg>
    )
  }
  if (name === 'Calendar') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="5" width="16" height="15" rx="3" stroke="#4285F4" strokeWidth="2" />
        <path d="M8 3v4M16 3v4M4 10h16" stroke="#4285F4" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }
  if (name === 'Notion') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="5" y="4" width="14" height="16" rx="2.5" stroke="#FFFFFF" strokeWidth="2" />
        <path d="M9 17V8l6 9V8" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (name === 'Docs') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M8 3h6l4 4v13a1 1 0 0 1-1 1H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" stroke="#34A853" strokeWidth="2" strokeLinejoin="round" />
        <path d="M14 3v5h5M9 12h6M9 16h6" stroke="#34A853" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }
  if (name === 'Drive') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M9 4h6l5 8-3 5H7l-3-5 5-8Z" stroke="#0F9D58" strokeWidth="2" strokeLinejoin="round" />
        <path d="M9 4 4 12M15 4l5 8M7 17h10" stroke="#0F9D58" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="4" stroke="#4A154B" strokeWidth="2" />
      <path d="M9 12h6M12 9v6" stroke="#4A154B" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const { user } = useUser()
  const { t } = useLang()
  const [integrations, setIntegrations] = useState(defaultIntegrations)

  const navigation = getNavigation(t)

  useEffect(() => {
    let active = true
    async function loadIntegrations() {
      try {
        const response = await fetch('/api/dashboard/integrations', { cache: 'no-store' })
        if (!response.ok) return
        const data = await response.json()
        if (!active || !Array.isArray(data.items)) return
        setIntegrations([
          { name: 'Gmail', status: data.items.find((item: { id: string; status: string }) => item.id === 'gmail')?.status || 'disconnected', color: '#EA4335' },
          { name: 'Calendar', status: data.items.find((item: { id: string; status: string }) => item.id === 'calendar')?.status || 'disconnected', color: '#4285F4' },
          { name: 'Notion', status: data.items.find((item: { id: string; status: string }) => item.id === 'notion')?.status || 'disconnected', color: '#000000' },
          { name: 'Docs', status: data.items.find((item: { id: string; status: string }) => item.id === 'google_docs')?.status || 'disconnected', color: '#34A853' },
          { name: 'Drive', status: data.items.find((item: { id: string; status: string }) => item.id === 'google_drive')?.status || 'disconnected', color: '#0F9D58' },
          { name: 'Slack', status: data.items.find((item: { id: string; status: string }) => item.id === 'slack')?.status || 'disconnected', color: '#4A154B' },
        ])
      } catch {
        // Keep disconnected state
      }
    }
    void loadIntegrations()
    return () => { active = false }
  }, [])

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <Link href="/dashboard" className={styles.logo}>
          <div className={styles.logoIcon}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="var(--accent-purple)" />
              <path d="M2 17L12 22L22 17" stroke="var(--accent-purple)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2 12L12 17L22 12" stroke="var(--accent-purple)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className={styles.logoText}>Kova</span>
        </Link>
        <LanguageSwitcher />
      </div>
      <nav className={styles.nav}>
        <ul className={styles.navList}>
          {navigation.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`${styles.navItem} ${pathname === item.href || pathname?.startsWith(item.href + '/') ? styles.active : ''}`}
              >
                <span className={styles.navIcon}>{item.icon}</span>
                <span className={styles.navText}>{item.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.integrations}>
        <ul className={styles.integrationMiniList}>
          {integrations.map((app) => (
            <li key={app.name} className={styles.integrationMiniItem}>
              <span className={styles.integrationMiniLabel}>
                <span className={styles.integrationMiniLogo}>
                  <IntegrationLogo name={app.name} />
                </span>
                <span className={styles.integrationMiniName}>{app.name}</span>
              </span>
              <span
                className={`${styles.integrationStatusDot} ${styles[app.status]}`}
                title={`${app.name}: ${app.status}`}
                aria-label={`${app.name}: ${app.status}`}
              />
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.usageBadgeWrapper}>
        <UsageBadge />
      </div>
      <div className={styles.footer}>
        <div className={styles.user}>
          <UserButton
            afterSignOutUrl="/"
            appearance={{
              elements: {
                avatarBox: styles.userAvatar,
              },
            }}
          />
          <div className={styles.userInfo}>
            <span className={styles.userName}>{user?.fullName || 'User'}</span>
            <span className={styles.userEmail}>
              {user?.primaryEmailAddress?.emailAddress}
            </span>
          </div>
        </div>
      </div>
    </aside>
  )
}
