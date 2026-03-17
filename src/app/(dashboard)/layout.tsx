import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import styles from './layout.module.css'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = auth()

  if (!userId) {
    redirect('/sign-in')
  }

  return (
    <div className={styles.container}>
      <Sidebar />
      <main className={styles.main}>{children}</main>
    </div>
  )
}
