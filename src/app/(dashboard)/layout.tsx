import { Sidebar } from '@/components/layout/Sidebar'
import { LangProvider } from '@/lib/lang-context'
import styles from './layout.module.css'

// No auth() call here — middleware already protects every route in this group.
// Removing auth() makes this layout static, which lets Next.js prefetch all
// sub-routes in the sidebar → instant navigation instead of 2-3 s round trips.
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <LangProvider>
      <div className={styles.container}>
        <Sidebar />
        <main className={styles.main}>{children}</main>
      </div>
    </LangProvider>
  )
}
