/**
 * Canonical public app origin (no trailing slash). Used for OAuth redirects and Stripe return URLs.
 */
export function getAppBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!raw) {
    throw new Error('NEXT_PUBLIC_APP_URL is not configured.')
  }
  return raw.replace(/\/+$/, '')
}
