import { HistoryPageClient } from '@/components/dashboard/HistoryPageClient'
import { getHistoryPageData } from '@/lib/dashboard/server'

export default async function HistoryPage() {
  const data = await getHistoryPageData()
  return <HistoryPageClient data={data} />
}
