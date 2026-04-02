import {
  googleFetch,
  GOOGLE_READ_TIMEOUT_MS,
} from '@/lib/integrations/google-http'

const GOOGLE_PHOTOS_PICKER_BASE_URL = 'https://photospicker.googleapis.com/v1'
export const GOOGLE_PHOTOS_PICKER_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

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

    const details = Array.isArray(data.error?.details) ? data.error.details : []
    const serviceDisabled = details.find(
      (detail) => detail.reason === 'SERVICE_DISABLED' && detail.metadata?.service === 'photospicker.googleapis.com'
    )

    if (serviceDisabled) {
      return 'Google Photos est connecté en OAuth, mais l’API Google Photos Picker est désactivée dans le projet Google Cloud.'
    }

    const message = data.error?.message || ''

    if (/insufficient authentication scopes/i.test(message)) {
      return 'Reconnecte Google pour autoriser Google Photos Picker avec les permissions de sélection de médias.'
    }

    if (data.error?.status === 'FAILED_PRECONDITION') {
      return 'La sélection Google Photos n’est pas terminée. Ouvre le sélecteur, choisis les médias, puis réessaie.'
    }

    return message || `Google Photos request failed: ${response.status}`
  } catch {
    return bodyText || `Google Photos request failed: ${response.status}`
  }
}

function buildGooglePhotosPickerUrl(pathname: string, query?: Record<string, string | number | undefined>) {
  const url = new URL(`${GOOGLE_PHOTOS_PICKER_BASE_URL}${pathname}`)
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value))
    }
  })
  return url.toString()
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

export interface GooglePhotosPickerSession {
  sessionId: string
  pickerUri: string | null
  mediaItemsSet: boolean
  expireTime: string | null
  pollingConfig: {
    pollIntervalSeconds: number | null
    timeoutSeconds: number | null
  } | null
}

export interface GooglePhotosPickerSessionMetadata extends GooglePhotosPickerSession {
  pickedCount: number | null
  updatedAt: string
}

function mapGooglePhotosPickerSession(data: unknown): GooglePhotosPickerSession {
  const record = asRecord(data)
  const name = typeof record.name === 'string' ? record.name : null
  const sessionId =
    typeof record.id === 'string' && record.id.trim().length > 0
      ? record.id.trim()
      : name?.split('/').filter(Boolean).pop() || ''

  if (!sessionId) {
    throw new Error('Google Photos Picker did not return a usable session ID.')
  }

  const rawPollingConfig = asRecord(record.pollingConfig)

  return {
    sessionId,
    pickerUri: typeof record.pickerUri === 'string' ? record.pickerUri : null,
    mediaItemsSet: record.mediaItemsSet === true,
    expireTime: typeof record.expireTime === 'string' ? record.expireTime : null,
    pollingConfig:
      Object.keys(rawPollingConfig).length > 0
        ? {
            pollIntervalSeconds:
              typeof rawPollingConfig.pollIntervalSeconds === 'number' ? rawPollingConfig.pollIntervalSeconds : null,
            timeoutSeconds:
              typeof rawPollingConfig.timeoutSeconds === 'number' ? rawPollingConfig.timeoutSeconds : null,
          }
        : null,
  }
}

export function getGooglePhotosPickerSessionMetadata(metadata: unknown): GooglePhotosPickerSessionMetadata | null {
  const pickerSession = asRecord(asRecord(metadata).pickerSession)
  const sessionId = typeof pickerSession.sessionId === 'string' ? pickerSession.sessionId.trim() : ''
  if (!sessionId) {
    return null
  }

  return {
    sessionId,
    pickerUri: typeof pickerSession.pickerUri === 'string' ? pickerSession.pickerUri : null,
    mediaItemsSet: pickerSession.mediaItemsSet === true,
    expireTime: typeof pickerSession.expireTime === 'string' ? pickerSession.expireTime : null,
    pollingConfig: pickerSession.pollingConfig && typeof pickerSession.pollingConfig === 'object'
      ? {
          pollIntervalSeconds:
            typeof asRecord(pickerSession.pollingConfig).pollIntervalSeconds === 'number'
              ? (asRecord(pickerSession.pollingConfig).pollIntervalSeconds as number)
              : null,
          timeoutSeconds:
            typeof asRecord(pickerSession.pollingConfig).timeoutSeconds === 'number'
              ? (asRecord(pickerSession.pollingConfig).timeoutSeconds as number)
              : null,
        }
      : null,
    pickedCount: typeof pickerSession.pickedCount === 'number' ? pickerSession.pickedCount : null,
    updatedAt: typeof pickerSession.updatedAt === 'string' ? pickerSession.updatedAt : new Date(0).toISOString(),
  }
}

export function withGooglePhotosPickerSessionMetadata(
  metadata: unknown,
  session: GooglePhotosPickerSession,
  extras: {
    pickedCount?: number | null
  } = {}
) {
  return {
    ...asRecord(metadata),
    providerError: null,
    healthCheckAt: new Date().toISOString(),
    pickerSession: {
      sessionId: session.sessionId,
      pickerUri: session.pickerUri,
      mediaItemsSet: session.mediaItemsSet,
      expireTime: session.expireTime,
      pollingConfig: session.pollingConfig,
      pickedCount: typeof extras.pickedCount === 'number' ? extras.pickedCount : null,
      updatedAt: new Date().toISOString(),
    },
  }
}

export async function createGooglePhotosPickerSession(
  accessToken: string,
  _options: {
    requestId?: string
  } = {}
) {
  const response = await googleFetch(buildGooglePhotosPickerUrl('/sessions'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  }, { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 })

  if (!response.ok) {
    throw new Error(await readGooglePhotosError(response))
  }

  return mapGooglePhotosPickerSession(await response.json())
}

export async function getGooglePhotosPickerSession(accessToken: string, sessionId: string) {
  const response = await googleFetch(buildGooglePhotosPickerUrl(`/sessions/${encodeURIComponent(sessionId)}`), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }, { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 })

  if (!response.ok) {
    throw new Error(await readGooglePhotosError(response))
  }

  return mapGooglePhotosPickerSession(await response.json())
}

export async function deleteGooglePhotosPickerSession(accessToken: string, sessionId: string) {
  const response = await googleFetch(buildGooglePhotosPickerUrl(`/sessions/${encodeURIComponent(sessionId)}`), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }, { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 })

  if (!response.ok) {
    throw new Error(await readGooglePhotosError(response))
  }
}

export async function listGooglePhotosMedia(
  accessToken: string,
  options: {
    sessionId: string
    maxResults?: number
    pageToken?: string
  }
) {
  const response = await googleFetch(buildGooglePhotosPickerUrl('/mediaItems', {
    sessionId: options.sessionId,
    pageSize: Math.max(1, Math.min(options.maxResults || 12, 100)),
    pageToken: options.pageToken,
  }), {
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
      mediaFile?: {
        baseUrl?: string
        filename?: string
        mimeType?: string
      }
      createTime?: string
      mediaFileMetadata?: {
        width?: string
        height?: string
      }
    }>
    nextPageToken?: string
  }

  const items = (data.mediaItems || []).map((item) => ({
    id: item.id,
    filename: item.mediaFile?.filename || 'Untitled media',
    mimeType: item.mediaFile?.mimeType || 'application/octet-stream',
    creationTime: item.createTime || null,
    mediaUrl: item.mediaFile?.baseUrl || null,
    productUrl: null,
    width: item.mediaFileMetadata?.width || null,
    height: item.mediaFileMetadata?.height || null,
  } satisfies GooglePhotoSummary))

  return {
    items,
    nextPageToken: typeof data.nextPageToken === 'string' ? data.nextPageToken : null,
  }
}

export async function searchGooglePhotosMedia(
  accessToken: string,
  options: {
    sessionId: string
    query: string
    maxResults?: number
  }
) {
  const query = options.query.trim().toLowerCase()
  if (!query) {
    return []
  }

  const firstPage = await listGooglePhotosMedia(accessToken, {
    sessionId: options.sessionId,
    maxResults: options.maxResults ? Math.max(options.maxResults, 25) : 40,
  })

  return firstPage.items
    .filter((item) =>
      item.filename.toLowerCase().includes(query) ||
      item.mimeType.toLowerCase().includes(query)
    )
    .slice(0, Math.max(1, Math.min(options.maxResults || 12, 20)))
}
