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
  const sidebarData = await getSidebarBundle()
  const savedLang = cookies().get('lang')?.value
  const initialLang = savedLang === 'en' ? 'en' : 'fr'

  return (
    <LangProvider initialLang={initialLang}>
      <div className={styles.container}>
        <Sidebar
          initialData={sidebarData}
          userName={sidebarData.user.name}
          userEmail={sidebarData.user.email}
        />
        <main className={styles.main}>{children}</main>
      </div>
    </LangProvider>
  )
}
