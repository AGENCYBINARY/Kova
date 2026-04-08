import { IntegrationsPageClient } from '@/components/dashboard/IntegrationsPageClient'
import { getIntegrationsPageData } from '@/lib/dashboard/server'

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const data = await getIntegrationsPageData()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const connectedParam = typeof resolvedSearchParams?.connected === 'string' ? resolvedSearchParams.connected : null
  const errorParam = typeof resolvedSearchParams?.error === 'string' ? resolvedSearchParams.error : null

  return <IntegrationsPageClient data={data} connectedParam={connectedParam} errorParam={errorParam} />
}
