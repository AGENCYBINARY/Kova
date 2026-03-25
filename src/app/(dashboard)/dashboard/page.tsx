import { DashboardOverviewClient } from '@/components/dashboard/DashboardOverviewClient'
import { getDashboardBundle } from '@/lib/dashboard/server'

export default async function DashboardOverviewPage() {
  const data = await getDashboardBundle()
  return <DashboardOverviewClient data={data} />
}
