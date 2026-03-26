import { Buffer } from 'node:buffer'
import { decryptSecret, encryptSecret } from '@/lib/security/crypto'
import { prisma } from '@/lib/db/prisma'
import type { IntegrationExecutionResult } from '@/lib/integrations/types'

const NOTION_VERSION = '2022-06-28'
const NOTION_READ_TIMEOUT_MS = 8_000
const NOTION_WRITE_TIMEOUT_MS = 12_000
const NOTION_AUTH_TIMEOUT_MS = 10_000

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldRetryNotionRequest(status?: number) {
  return status === 429 || (typeof status === 'number' && status >= 500)
}

async function notionRequest(
  url: string,
  init: RequestInit,
  options: {
    timeoutMs: number
    retries?: number
  }
) {
  const retries = options.retries || 0

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs)

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      })

      if (attempt < retries && shouldRetryNotionRequest(response.status)) {
        await wait(250 * (attempt + 1))
        continue
      }

      return response
    } catch (error) {
      const isAbortError = error instanceof Error && error.name === 'AbortError'
      if (attempt >= retries) {
        throw isAbortError ? new Error('Notion request timed out.') : error
      }
      await wait(250 * (attempt + 1))
    } finally {
      clearTimeout(timeout)
    }
  }

  throw new Error('Notion request failed.')
}

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

  const response = await notionRequest('https://api.notion.com/v1/oauth/token', {
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
  }, { timeoutMs: NOTION_AUTH_TIMEOUT_MS })

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

async function notionFetch(
  path: string,
  token: string,
  init?: RequestInit,
  options: {
    timeoutMs?: number
    retries?: number
  } = {}
) {
  const response = await notionRequest(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  }, {
    timeoutMs: options.timeoutMs || NOTION_WRITE_TIMEOUT_MS,
    retries: options.retries || 0,
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

export interface NotionDatabaseSummary {
  id: string
  title: string
  url: string | null
  lastEditedTime: string | null
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
  }, {
    timeoutMs: NOTION_READ_TIMEOUT_MS,
    retries: 1,
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

export async function searchNotionDatabases(
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
        value: 'database',
      },
      sort: {
        direction: 'descending',
        timestamp: 'last_edited_time',
      },
      page_size: Math.max(1, Math.min(options.maxResults || 10, 20)),
    }),
  }, {
    timeoutMs: NOTION_READ_TIMEOUT_MS,
    retries: 1,
  }) as {
    results?: Array<{
      id: string
      url?: string
      last_edited_time?: string
      title?: Array<{ plain_text?: string }>
    }>
  }

  return (data.results || []).map((database) => ({
    id: database.id,
    title: extractPlainText(database.title),
    url: database.url || null,
    lastEditedTime: database.last_edited_time || null,
  } satisfies NotionDatabaseSummary))
}

async function fetchNotionDatabaseSchema(token: string, databaseId: string) {
  return notionFetch(`/databases/${databaseId}`, token, undefined, {
    timeoutMs: NOTION_READ_TIMEOUT_MS,
    retries: 1,
  }) as Promise<{
    id: string
    title?: Array<{ plain_text?: string }>
    properties?: Record<string, { type?: string }>
  }>
}

async function fetchNotionPage(token: string, pageId: string) {
  return notionFetch(`/pages/${pageId}`, token, undefined, {
    timeoutMs: NOTION_READ_TIMEOUT_MS,
    retries: 1,
  }) as Promise<{
    id: string
    parent?: {
      type?: string
      database_id?: string
      page_id?: string
    }
    properties?: Record<string, { type?: string }>
    url?: string
  }>
}

function findNotionTitlePropertyName(properties: Record<string, { type?: string }> | undefined) {
  if (!properties) {
    return 'title'
  }

  for (const [name, property] of Object.entries(properties)) {
    if (property?.type === 'title') {
      return name
    }
  }

  return 'title'
}

function buildNotionPropertyValue(type: string, value: unknown) {
  if (type === 'title') {
    const titleContent =
      typeof value === 'string'
        ? value
        : value && typeof value === 'object' && 'name' in value
          ? String((value as { name?: unknown }).name || '')
          : String(value || '')
    return {
      title: [
        {
          text: {
            content: titleContent,
          },
        },
      ],
    }
  }

  if (type === 'rich_text') {
    const content =
      typeof value === 'string'
        ? value
        : value && typeof value === 'object' && 'content' in value
          ? String((value as { content?: unknown }).content || '')
          : JSON.stringify(value)
    return {
      rich_text: [
        {
          text: {
            content,
          },
        },
      ],
    }
  }

  if (type === 'number') {
    return {
      number: typeof value === 'number' ? value : Number(value),
    }
  }

  if (type === 'checkbox') {
    return {
      checkbox: Boolean(value),
    }
  }

  if (type === 'url') {
    return { url: String(value || '') || null }
  }

  if (type === 'email') {
    return { email: String(value || '') || null }
  }

  if (type === 'phone_number') {
    return { phone_number: String(value || '') || null }
  }

  if (type === 'date') {
    const dateValue = typeof value === 'string'
      ? { start: value }
      : value && typeof value === 'object'
        ? value
        : { start: String(value || '') }
    return { date: dateValue }
  }

  if (type === 'select') {
    return {
      select: value
        ? {
            name:
              value && typeof value === 'object' && 'name' in value
                ? String((value as { name?: unknown }).name || '')
                : String(value),
          }
        : null,
    }
  }

  if (type === 'multi_select') {
    const values = Array.isArray(value) ? value : [value]
    return {
      multi_select: values
        .filter((item): item is string | number => typeof item === 'string' || typeof item === 'number')
        .map((item) => ({ name: String(item) })),
    }
  }

  if (type === 'status') {
    return {
      status: value
        ? {
            name:
              value && typeof value === 'object' && 'name' in value
                ? String((value as { name?: unknown }).name || '')
                : String(value),
          }
        : null,
    }
  }

  if (type === 'people') {
    const values = Array.isArray(value) ? value : [value]
    return {
      people: values
        .map((item) => {
          if (typeof item === 'string') {
            return { id: item }
          }
          if (item && typeof item === 'object' && 'id' in item) {
            return { id: String((item as { id?: unknown }).id || '') }
          }
          return null
        })
        .filter((item): item is { id: string } => Boolean(item?.id)),
    }
  }

  if (type === 'relation') {
    const values = Array.isArray(value) ? value : [value]
    return {
      relation: values
        .map((item) => {
          if (typeof item === 'string') {
            return { id: item }
          }
          if (item && typeof item === 'object' && 'id' in item) {
            return { id: String((item as { id?: unknown }).id || '') }
          }
          return null
        })
        .filter((item): item is { id: string } => Boolean(item?.id)),
    }
  }

  if (type === 'files') {
    const values = Array.isArray(value) ? value : [value]
    return {
      files: values
        .map((item) => {
          if (typeof item === 'string' && item.startsWith('http')) {
            return {
              name: item.split('/').pop() || 'Attachment',
              type: 'external',
              external: {
                url: item,
              },
            }
          }

          if (
            item &&
            typeof item === 'object' &&
            'url' in item &&
            typeof (item as { url?: unknown }).url === 'string'
          ) {
            return {
              name:
                typeof (item as { name?: unknown }).name === 'string'
                  ? String((item as { name?: unknown }).name)
                  : String((item as { url?: string }).url?.split('/').pop() || 'Attachment'),
              type: 'external',
              external: {
                url: String((item as { url?: string }).url),
              },
            }
          }

          return null
        })
        .filter((item): item is { name: string; type: 'external'; external: { url: string } } => Boolean(item?.external?.url)),
    }
  }

  return {
    rich_text: [
      {
        text: {
          content: typeof value === 'string' ? value : JSON.stringify(value),
        },
      },
    ],
  }
}

function serializeNotionProperties(
  schema: Record<string, { type?: string }> | undefined,
  properties: Record<string, unknown>
) {
  const serialized: Record<string, unknown> = {}

  for (const [name, value] of Object.entries(properties)) {
    if (value === undefined) continue
    const propertyType = schema?.[name]?.type || 'rich_text'
    serialized[name] = buildNotionPropertyValue(propertyType, value)
  }

  return serialized
}

function buildParagraphChildren(content: string) {
  if (!content.trim()) {
    return []
  }

  return [
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
}

export async function readNotionPagePreview(
  token: string,
  pageId: string,
  options: {
    maxBlocks?: number
  } = {}
) {
  const data = await notionFetch(
    `/blocks/${pageId}/children?page_size=${Math.max(1, Math.min(options.maxBlocks || 6, 20))}`,
    token,
    undefined,
    {
      timeoutMs: NOTION_READ_TIMEOUT_MS,
      retries: 1,
    }
  ) as {
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
  const title = String(parameters.title || 'Kova page')
  const content = String(parameters.content || '')
  const parentPageId = String(parameters.parentPageId || process.env.NOTION_PARENT_PAGE_ID || '')
  const parentDatabaseId = String(parameters.parentDatabaseId || '')
  const rawProperties =
    parameters.properties && typeof parameters.properties === 'object' && !Array.isArray(parameters.properties)
      ? (parameters.properties as Record<string, unknown>)
      : {}

  if (!parentPageId && !parentDatabaseId) {
    throw new Error('NOTION_PARENT_PAGE_ID, parentPageId, or parentDatabaseId is required for Notion page creation.')
  }

  const parent =
    parentDatabaseId
      ? {
          type: 'database_id',
          database_id: parentDatabaseId,
        }
      : {
          type: 'page_id',
          page_id: parentPageId,
        }

  const schema = parentDatabaseId
    ? await fetchNotionDatabaseSchema(token, parentDatabaseId)
    : null
  const titlePropertyName = findNotionTitlePropertyName(schema?.properties)
  const properties = parentDatabaseId
    ? {
        ...serializeNotionProperties(schema?.properties, rawProperties),
        [titlePropertyName]: buildNotionPropertyValue('title', title),
      }
    : {
        title: buildNotionPropertyValue('title', title),
      }

  const data = await notionFetch('/pages', token, {
    method: 'POST',
    body: JSON.stringify({
      parent,
      properties,
      children: buildParagraphChildren(content),
    }),
  }, {
    timeoutMs: NOTION_WRITE_TIMEOUT_MS,
  }) as { id: string; url?: string }

  return {
    details: 'Page created in Notion.',
    output: {
      provider: 'notion',
      pageId: data.id,
      parentPageId: parentPageId || null,
      parentDatabaseId: parentDatabaseId || null,
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
  }, {
    timeoutMs: NOTION_WRITE_TIMEOUT_MS,
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

export async function updateNotionPageProperties(token: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const pageId = String(parameters.pageId || '')
  const rawProperties =
    parameters.properties && typeof parameters.properties === 'object' && !Array.isArray(parameters.properties)
      ? (parameters.properties as Record<string, unknown>)
      : {}
  const content = typeof parameters.content === 'string' ? parameters.content : ''

  if (!pageId) {
    throw new Error('pageId is required to update Notion properties.')
  }

  if (Object.keys(rawProperties).length === 0 && !content.trim()) {
    throw new Error('properties or content is required to update a Notion page.')
  }

  const page = await fetchNotionPage(token, pageId)
  if (Object.keys(rawProperties).length > 0) {
    await notionFetch(`/pages/${pageId}`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        properties: serializeNotionProperties(page.properties, rawProperties),
      }),
    }, {
      timeoutMs: NOTION_WRITE_TIMEOUT_MS,
    })
  }

  let blocksAppended = 0
  if (content.trim()) {
    const data = await notionFetch(`/blocks/${pageId}/children`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        children: buildParagraphChildren(content),
      }),
    }, {
      timeoutMs: NOTION_WRITE_TIMEOUT_MS,
    }) as { results?: Array<{ id?: string }> }
    blocksAppended = data.results?.length || 0
  }

  return {
    details: 'Notion properties updated.',
    output: {
      provider: 'notion',
      pageId,
      parentDatabaseId: page.parent?.database_id || null,
      updatedPropertyCount: Object.keys(rawProperties).length,
      blocksAppended,
      url: page.url || null,
    },
  }
}
