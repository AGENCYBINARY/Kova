import { currentUser } from '@clerk/nextjs/server'
import { Sidebar } from '@/components/layout/Sidebar'
import { getSidebarBundle } from '@/lib/dashboard/server'
import { LangProvider } from '@/lib/lang-context'
import { cookies } from 'next/headers'
import styles from './layout.module.css'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [sidebarData, user] = await Promise.all([getSidebarBundle(), currentUser()])
  const savedLang = cookies().get('lang')?.value
  const initialLang = savedLang === 'en' ? 'en' : 'fr'
  const userName =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    user?.username ||
    user?.emailAddresses[0]?.emailAddress ||
    'User'
  const userEmail = user?.emailAddresses[0]?.emailAddress || ''

  return (
    <LangProvider initialLang={initialLang}>
      <div className={styles.container}>
        <Sidebar initialData={sidebarData} userName={userName} userEmail={userEmail} />
        <main className={styles.main}>{children}</main>
      </div>
    </LangProvider>
  )
}
