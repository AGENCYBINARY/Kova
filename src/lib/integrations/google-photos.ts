import {
  googleFetch,
  GOOGLE_READ_TIMEOUT_MS,
} from '@/lib/integrations/google-http'

async function readGooglePhotosError(response: Response) {
  let bodyText = ''

  try {
    bodyText = await response.text()
  } catch {
    return `Google Photos request failed: ${response.status}`
  }

  if (!bodyText) {
    return `Google Photos request failed: ${response.status}`
  }

  try {
    const data = JSON.parse(bodyText) as {
      error?: {
        message?: string
        status?: string
        details?: Array<{
          '@type'?: string
          reason?: string
          domain?: string
          metadata?: Record<string, string>
        }>
      }
    }

    const details = Array.isArray(data.error?.details) ? data.error?.details : []
    const serviceDisabled = details.find(
      (detail) => detail.reason === 'SERVICE_DISABLED' && detail.metadata?.service === 'photoslibrary.googleapis.com'
    )

    if (serviceDisabled) {
      return 'Google Photos est connecté en OAuth, mais l’API Photos Library est désactivée dans le projet Google Cloud.'
    }

    return data.error?.message || `Google Photos request failed: ${response.status}`
  } catch {
    return bodyText || `Google Photos request failed: ${response.status}`
  }
}

export interface GooglePhotoSummary {
  id: string
  filename: string
  mimeType: string
  creationTime: string | null
  mediaUrl: string | null
  productUrl: string | null
  width: string | null
  height: string | null
}

export interface GooglePhotoAlbumSummary {
  id: string
  title: string
  itemCount: string | null
  coverPhotoUrl: string | null
}

export async function listGooglePhotosMedia(
  accessToken: string,
  options: {
    maxResults?: number
  } = {}
) {
  return listRecentGooglePhotos(accessToken, {
    maxResults: options.maxResults,
  })
}

export async function searchGooglePhotosMedia(
  accessToken: string,
  options: {
    query: string
    maxResults?: number
  }
) {
  const query = options.query.trim().toLowerCase()
  if (!query) {
    return []
  }

  const recent = await listRecentGooglePhotos(accessToken, {
    query,
    maxResults: options.maxResults ? Math.max(options.maxResults, 25) : 40,
  })

  return recent.slice(0, Math.max(1, Math.min(options.maxResults || 12, 20)))
}

export async function listRecentGooglePhotos(
  accessToken: string,
  options: {
    query?: string
    maxResults?: number
  } = {}
) {
  const url = new URL('https://photoslibrary.googleapis.com/v1/mediaItems')
  url.searchParams.set('pageSize', String(Math.max(1, Math.min(options.maxResults || 12, 30))))

  const response = await googleFetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }, { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 })

  if (!response.ok) {
    throw new Error(await readGooglePhotosError(response))
  }

  const data = await response.json() as {
    mediaItems?: Array<{
      id: string
      filename?: string
      mimeType?: string
      productUrl?: string
      baseUrl?: string
      mediaMetadata?: {
        creationTime?: string
        width?: string
        height?: string
      }
    }>
  }

  const query = options.query?.trim().toLowerCase()
  const items = (data.mediaItems || []).map((item) => ({
    id: item.id,
    filename: item.filename || 'Untitled media',
    mimeType: item.mimeType || 'application/octet-stream',
    creationTime: item.mediaMetadata?.creationTime || null,
    mediaUrl: item.baseUrl || null,
    productUrl: item.productUrl || null,
    width: item.mediaMetadata?.width || null,
    height: item.mediaMetadata?.height || null,
  } satisfies GooglePhotoSummary))

  return query
    ? items.filter((item) => item.filename.toLowerCase().includes(query))
    : items
}

export async function listGooglePhotoAlbums(accessToken: string, options: { maxResults?: number } = {}) {
  const url = new URL('https://photoslibrary.googleapis.com/v1/albums')
  url.searchParams.set('pageSize', String(Math.max(1, Math.min(options.maxResults || 12, 30))))

  const response = await googleFetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }, { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 })

  if (!response.ok) {
    throw new Error(await readGooglePhotosError(response))
  }

  const data = await response.json() as {
    albums?: Array<{
      id: string
      title?: string
      mediaItemsCount?: string
      coverPhotoBaseUrl?: string
    }>
  }

  return (data.albums || []).map((album) => ({
    id: album.id,
    title: album.title || 'Album sans titre',
    itemCount: album.mediaItemsCount || null,
    coverPhotoUrl: album.coverPhotoBaseUrl || null,
  } satisfies GooglePhotoAlbumSummary))
}
