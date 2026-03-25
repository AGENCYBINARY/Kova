import { Buffer } from 'node:buffer'
import { decryptSecret, encryptSecret } from '@/lib/security/crypto'
import { prisma } from '@/lib/db/prisma'
import type { IntegrationExecutionResult } from '@/lib/integrations/types'

const NOTION_VERSION = '2022-06-28'

function getNotionClientConfig() {
  const clientId = process.env.NOTION_CLIENT_ID
  const clientSecret = process.env.NOTION_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Notion OAuth credentials are missing.')
  }

  return { clientId, clientSecret }
}

function getNotionRedirectUri() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) {
    throw new Error('NEXT_PUBLIC_APP_URL is missing.')
  }

  return `${appUrl}/api/integrations/callback/notion`
}

export function buildNotionOAuthUrl(state: string) {
  const { clientId } = getNotionClientConfig()
  const url = new URL('https://api.notion.com/v1/oauth/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('owner', 'user')
  url.searchParams.set('redirect_uri', getNotionRedirectUri())
  url.searchParams.set('state', state)
  return url.toString()
}

export async function exchangeNotionCodeForTokens(code: string) {
  const { clientId, clientSecret } = getNotionClientConfig()
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const response = await fetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getNotionRedirectUri(),
    }),
  })

  if (!response.ok) {
    throw new Error(`Notion token exchange failed: ${response.status}`)
  }

  return response.json() as Promise<{
    access_token: string
    workspace_name?: string
    workspace_icon?: string
    bot_id?: string
    owner?: { user?: { person?: { email?: string } } }
  }>
}

export async function persistNotionTokens(params: {
  userId: string
  workspaceId: string
  accessToken: string
  connectedAccount: string | null
  workspaceName: string | null
}) {
  const result = await prisma.integration.updateMany({
    where: {
      type: 'notion',
      userId: params.userId,
      workspaceId: params.workspaceId,
    },
    data: {
      accessToken: encryptSecret(params.accessToken),
      refreshToken: null,
      expiresAt: null,
      status: 'connected',
      lastSyncAt: new Date(),
      metadata: {
        connectedAccount: params.connectedAccount,
        workspaceName: params.workspaceName,
        provider: 'notion',
      },
    },
  })

  if (result.count === 0) {
    await prisma.integration.create({
      data: {
        type: 'notion',
        accessToken: encryptSecret(params.accessToken),
        refreshToken: null,
        expiresAt: null,
        status: 'connected',
        lastSyncAt: new Date(),
        metadata: {
          connectedAccount: params.connectedAccount,
          workspaceName: params.workspaceName,
          provider: 'notion',
        },
        workspaceId: params.workspaceId,
        userId: params.userId,
      },
    })
  }
}

export function getValidNotionAccessToken(integration: { accessToken: string }) {
  const token = decryptSecret(integration.accessToken)
  if (!token) {
    throw new Error('Missing Notion access token.')
  }
  return token
}

async function notionFetch(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })

  if (!response.ok) {
    throw new Error(`Notion API request failed: ${response.status}`)
  }

  return response.json()
}

export interface NotionPageSummary {
  id: string
  title: string
  url: string | null
  lastEditedTime: string | null
  preview: string
}

function extractNotionTitle(properties: Record<string, unknown> | undefined) {
  if (!properties) {
    return 'Untitled'
  }

  for (const value of Object.values(properties)) {
    if (!value || typeof value !== 'object') {
      continue
    }

    const property = value as {
      type?: string
      title?: Array<{ plain_text?: string }>
      rich_text?: Array<{ plain_text?: string }>
    }

    if (property.type === 'title' && Array.isArray(property.title)) {
      const title = property.title.map((item) => item.plain_text || '').join('').trim()
      if (title) {
        return title
      }
    }
  }

  return 'Untitled'
}

function extractPlainText(richText: Array<{ plain_text?: string }> | undefined) {
  return (richText || []).map((item) => item.plain_text || '').join('').trim()
}

function blockToPreview(block: Record<string, unknown>) {
  const type = typeof block.type === 'string' ? block.type : ''
  const content = block[type]

  if (!content || typeof content !== 'object') {
    return ''
  }

  const richText = (content as { rich_text?: Array<{ plain_text?: string }> }).rich_text
  return extractPlainText(richText)
}

export async function searchNotionPages(
  token: string,
  options: {
    query?: string
    maxResults?: number
  } = {}
) {
  const data = await notionFetch('/search', token, {
    method: 'POST',
    body: JSON.stringify({
      query: options.query?.trim() || undefined,
      filter: {
        property: 'object',
        value: 'page',
      },
      sort: {
        direction: 'descending',
        timestamp: 'last_edited_time',
      },
      page_size: Math.max(1, Math.min(options.maxResults || 10, 20)),
    }),
  }) as {
    results?: Array<{
      id: string
      url?: string
      last_edited_time?: string
      properties?: Record<string, unknown>
    }>
  }

  return (data.results || []).map((page) => ({
    id: page.id,
    title: extractNotionTitle(page.properties),
    url: page.url || null,
    lastEditedTime: page.last_edited_time || null,
    preview: '',
  } satisfies NotionPageSummary))
}

export async function readNotionPagePreview(
  token: string,
  pageId: string,
  options: {
    maxBlocks?: number
  } = {}
) {
  const data = await notionFetch(`/blocks/${pageId}/children?page_size=${Math.max(1, Math.min(options.maxBlocks || 6, 20))}`, token) as {
    results?: Array<Record<string, unknown>>
  }

  return (data.results || [])
    .map(blockToPreview)
    .filter(Boolean)
    .slice(0, options.maxBlocks || 6)
    .join(' ')
    .trim()
}

export async function createNotionPage(token: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const parentPageId = process.env.NOTION_PARENT_PAGE_ID || String(parameters.parentPageId || '')

  if (!parentPageId) {
    throw new Error('NOTION_PARENT_PAGE_ID or parentPageId is required for Notion page creation.')
  }

  const title = String(parameters.title || 'Kova page')
  const content = String(parameters.content || '')

  const data = await notionFetch('/pages', token, {
    method: 'POST',
    body: JSON.stringify({
      parent: {
        type: 'page_id',
        page_id: parentPageId,
      },
      properties: {
        title: {
          title: [
            {
              text: {
                content: title,
              },
            },
          ],
        },
      },
      children: content
        ? [
            {
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [
                  {
                    type: 'text',
                    text: {
                      content,
                    },
                  },
                ],
              },
            },
          ]
        : [],
    }),
  }) as { id: string; url?: string }

  return {
    details: 'Page created in Notion.',
    output: {
      provider: 'notion',
      pageId: data.id,
      url: data.url || null,
    },
  }
}

export async function updateNotionPage(token: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const pageId = String(parameters.pageId || '')
  if (!pageId) {
    throw new Error('pageId is required to update a Notion page.')
  }

  const content = String(parameters.content || '')
  const fields = Array.isArray(parameters.fields) ? parameters.fields.join(', ') : ''

  const data = await notionFetch(`/blocks/${pageId}/children`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: {
                  content: content || fields || 'Updated by Kova',
                },
              },
            ],
          },
        },
      ],
    }),
  }) as { results?: Array<{ id?: string }> }

  return {
    details: 'Page updated in Notion.',
    output: {
      provider: 'notion',
      pageId,
      blocksAppended: data.results?.length || 0,
    },
  }
}
