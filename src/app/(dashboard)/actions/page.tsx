import { ActionsPageClient } from '@/components/dashboard/ActionsPageClient'
import { getActionsPageData } from '@/lib/dashboard/server'

export default async function ActionsPage() {
  const data = await getActionsPageData()
  return <ActionsPageClient data={data} />
}
