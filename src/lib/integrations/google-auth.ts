import { decryptSecret, encryptSecret } from '@/lib/security/crypto'
import { prisma } from '@/lib/db/prisma'
import {
  GOOGLE_AUTH_TIMEOUT_MS,
  GOOGLE_READ_TIMEOUT_MS,
  googleFetch,
} from '@/lib/integrations/google-http'
import { GOOGLE_PHOTOS_PICKER_SCOPE } from '@/lib/integrations/google-photos'

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.appdata',
  GOOGLE_PHOTOS_PICKER_SCOPE,
]

export const GOOGLE_PROVIDER_TYPES = ['gmail', 'calendar', 'google_docs', 'google_drive', 'google_photos'] as const

const GOOGLE_REQUIRED_SCOPES = {
  gmail: [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.labels',
    'https://www.googleapis.com/auth/gmail.readonly',
  ],
  calendar: [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly',
  ],
  google_docs: [
    'https://www.googleapis.com/auth/documents',
  ],
  google_drive: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.appdata',
  ],
  google_photos: [
    GOOGLE_PHOTOS_PICKER_SCOPE,
  ],
} as const

export interface GoogleIntegrationCapabilityState {
  grantedScopes: string[]
  missingScopes: string[]
  needsReconnect: boolean
}

function getGoogleRedirectUri() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) {
    throw new Error('NEXT_PUBLIC_APP_URL is missing.')
  }

  return `${appUrl}/api/integrations/callback/google`
}

function getGoogleClientConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials are missing.')
  }

  return { clientId, clientSecret }
}

export function buildGoogleOAuthUrl(state: string) {
  const { clientId } = getGoogleClientConfig()
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', getGoogleRedirectUri())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '))
  url.searchParams.set('state', state)
  return url.toString()
}

export async function exchangeGoogleCodeForTokens(code: string) {
  const { clientId, clientSecret } = getGoogleClientConfig()
  const response = await googleFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getGoogleRedirectUri(),
      grant_type: 'authorization_code',
    }),
  }, { timeoutMs: GOOGLE_AUTH_TIMEOUT_MS })

  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${response.status}`)
  }

  return response.json() as Promise<{
    access_token: string
    refresh_token?: string
    expires_in: number
    token_type: string
    scope: string
    id_token?: string
  }>
}

async function refreshGoogleAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = getGoogleClientConfig()
  const response = await googleFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  }, { timeoutMs: GOOGLE_AUTH_TIMEOUT_MS })

  if (!response.ok) {
    throw new Error(`Google token refresh failed: ${response.status}`)
  }

  return response.json() as Promise<{
    access_token: string
    expires_in: number
    token_type: string
    scope: string
  }>
}

export async function fetchGoogleAccountEmail(accessToken: string) {
  const response = await googleFetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }, { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 })

  if (!response.ok) {
    throw new Error(`Google userinfo fetch failed: ${response.status}`)
  }

  const data = await response.json() as { email?: string }
  return data.email || null
}

export async function persistGoogleTokens(params: {
  userId: string
  workspaceId: string
  accessToken: string
  refreshToken?: string
  expiresIn: number
  connectedAccount: string | null
  grantedScopes?: string[]
}) {
  const encryptedAccessToken = encryptSecret(params.accessToken)
  const encryptedRefreshToken = params.refreshToken ? encryptSecret(params.refreshToken) : null
  const expiresAt = new Date(Date.now() + params.expiresIn * 1000)

  await Promise.all(
    GOOGLE_PROVIDER_TYPES.map(async (type) => {
      const result = await prisma.integration.updateMany({
        where: {
          type,
          userId: params.userId,
          workspaceId: params.workspaceId,
        },
        data: {
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          expiresAt,
          status: 'connected',
          lastSyncAt: new Date(),
          metadata: {
            connectedAccount: params.connectedAccount,
            provider: 'google',
            grantedScopes: params.grantedScopes || [],
          },
        },
      })

      if (result.count === 0) {
        await prisma.integration.create({
          data: {
            type,
            accessToken: encryptedAccessToken,
            refreshToken: encryptedRefreshToken,
            expiresAt,
            status: 'connected',
            lastSyncAt: new Date(),
            metadata: {
              connectedAccount: params.connectedAccount,
              provider: 'google',
              grantedScopes: params.grantedScopes || [],
            },
            workspaceId: params.workspaceId,
            userId: params.userId,
          },
        })
      }
    })
  )
}

export function getGoogleGrantedScopes(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return []
  }

  const grantedScopes = (metadata as Record<string, unknown>).grantedScopes
  if (!Array.isArray(grantedScopes)) {
    return []
  }

  return grantedScopes.filter((scope): scope is string => typeof scope === 'string')
}

export function getGoogleIntegrationCapabilityState(
  provider: typeof GOOGLE_PROVIDER_TYPES[number],
  metadata: unknown
): GoogleIntegrationCapabilityState {
  const grantedScopes = getGoogleGrantedScopes(metadata)
  const requiredScopes = GOOGLE_REQUIRED_SCOPES[provider] || []
  const missingScopes = requiredScopes.filter((scope) => !grantedScopes.includes(scope))

  return {
    grantedScopes,
    missingScopes,
    needsReconnect: missingScopes.length > 0,
  }
}

export async function getValidGoogleAccessToken(integration: {
  id: string
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
}) {
  if (!integration.expiresAt || integration.expiresAt.getTime() > Date.now() + 30_000) {
    const accessToken = decryptSecret(integration.accessToken)
    if (!accessToken) {
      throw new Error('Missing Google access token.')
    }
    return accessToken
  }

  const refreshToken = decryptSecret(integration.refreshToken)
  if (!refreshToken) {
    throw new Error('Missing Google refresh token.')
  }

  const refreshed = await refreshGoogleAccessToken(refreshToken)
  const encryptedAccessToken = encryptSecret(refreshed.access_token)
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000)

  await prisma.integration.updateMany({
    where: {
      id: integration.id,
    },
    data: {
      accessToken: encryptedAccessToken,
      expiresAt,
      lastSyncAt: new Date(),
      status: 'connected',
    },
  })

  return refreshed.access_token
}
