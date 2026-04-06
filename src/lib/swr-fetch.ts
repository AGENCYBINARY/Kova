import type { SWRConfiguration } from 'swr'

/** Shared fetcher for dashboard JSON APIs (credentials + no HTTP cache for auth’d data). */
export async function jsonFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return res.json() as Promise<T>
}

/** Sidebar, subscription: soft SWR — dedupe navigations, refresh on focus. */
export const dashboardSWRConfig: SWRConfiguration = {
  revalidateOnFocus: true,
  revalidateIfStale: true,
  dedupingInterval: 10_000,
  errorRetryCount: 2,
}

/** Assistant settings: change rarely; avoid refetch on every tab focus. */
export const settingsSWRConfig: SWRConfiguration = {
  revalidateOnFocus: false,
  dedupingInterval: 120_000,
  errorRetryCount: 2,
}
