import { Sidebar } from '@/components/layout/Sidebar'
import { getSidebarBundle } from '@/lib/dashboard/server'
import { LangProvider } from '@/lib/lang-context'
import styles from './layout.module.css'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const sidebarData = await getSidebarBundle()

  return (
    <LangProvider>
      <div className={styles.container}>
        <Sidebar initialData={sidebarData} />
        <main className={styles.main}>{children}</main>
      </div>
    </LangProvider>
  )
}
