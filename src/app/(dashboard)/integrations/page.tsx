import { IntegrationsPageClient } from '@/components/dashboard/IntegrationsPageClient'
import { getIntegrationsPageData } from '@/lib/dashboard/server'

export default async function IntegrationsPage() {
  const data = await getIntegrationsPageData()
  return <IntegrationsPageClient data={data} />
}
