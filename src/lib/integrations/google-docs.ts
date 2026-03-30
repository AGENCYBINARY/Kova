import type { IntegrationExecutionResult } from '@/lib/integrations/types'
import {
  googleFetch,
  GOOGLE_READ_TIMEOUT_MS,
  GOOGLE_WRITE_TIMEOUT_MS,
} from '@/lib/integrations/google-http'

function escapeDriveQueryValue(value: string) {
  return value.replace(/'/g, "\\'")
}

async function insertTextIntoGoogleDoc(accessToken: string, documentId: string, text: string) {
  const getResponse = await googleFetch(
    `https://docs.googleapis.com/v1/documents/${documentId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 }
  )

  if (!getResponse.ok) {
    throw new Error(`Google Docs read failed: ${getResponse.status}`)
  }

  const document = (await getResponse.json()) as { body?: { content?: Array<{ endIndex?: number }> } }
  const endIndex = document.body?.content?.[document.body.content.length - 1]?.endIndex || 1

  const updateResponse = await googleFetch(
    `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            insertText: {
              location: { index: Math.max(1, endIndex - 1) },
              text,
            },
          },
        ],
      }),
    },
    { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS }
  )

  if (!updateResponse.ok) {
    throw new Error(`Google Docs write failed: ${updateResponse.status}`)
  }
}

export interface GoogleDocSummary {
  id: string
  title: string
  modifiedTime: string | null
  webViewLink: string | null
  preview: string
}

export async function readGoogleDocContent(accessToken: string, documentId: string): Promise<string> {
  const response = await googleFetch(
    `https://docs.googleapis.com/v1/documents/${documentId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 }
  )

  if (!response.ok) {
    throw new Error(`Google Docs read failed: ${response.status}`)
  }

  const doc = (await response.json()) as {
    title?: string
    body?: {
      content?: Array<{
        paragraph?: {
          elements?: Array<{
            textRun?: { content?: string }
          }>
        }
        table?: {
          tableRows?: Array<{
            tableCells?: Array<{
              content?: Array<{
                paragraph?: {
                  elements?: Array<{ textRun?: { content?: string } }>
                }
              }>
            }>
          }>
        }
      }>
    }
  }

  const lines: string[] = []
  for (const block of doc.body?.content || []) {
    if (block.paragraph) {
      const text = (block.paragraph.elements || [])
        .map((el) => el.textRun?.content || '')
        .join('')
        .trimEnd()
      if (text) lines.push(text)
    } else if (block.table) {
      for (const row of block.table.tableRows || []) {
        const cells = (row.tableCells || []).map((cell) =>
          (cell.content || [])
            .flatMap((paragraph) => (paragraph.paragraph?.elements || []).map((el) => el.textRun?.content || ''))
            .join('')
            .trim()
        )
        if (cells.some(Boolean)) lines.push(cells.join(' | '))
      }
    }
  }

  return lines.join('\n').trim()
}

export async function listRecentGoogleDocs(
  accessToken: string,
  options: { query?: string; maxResults?: number } = {}
): Promise<GoogleDocSummary[]> {
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  const clauses = ["trashed=false", "mimeType='application/vnd.google-apps.document'"]

  if (options.query?.trim()) {
    const escaped = escapeDriveQueryValue(options.query.trim())
    clauses.push(`(name contains '${escaped}' or fullText contains '${escaped}')`)
  }

  url.searchParams.set('q', clauses.join(' and '))
  url.searchParams.set('orderBy', 'modifiedTime desc')
  url.searchParams.set('pageSize', String(Math.max(1, Math.min(options.maxResults || 8, 20))))
  url.searchParams.set('fields', 'files(id,name,modifiedTime,webViewLink)')

  const response = await googleFetch(
    url.toString(),
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 }
  )

  if (!response.ok) {
    throw new Error(`Google Drive Docs list failed: ${response.status}`)
  }

  const data = (await response.json()) as {
    files?: Array<{
      id: string
      name?: string
      modifiedTime?: string
      webViewLink?: string
    }>
  }

  const files = data.files || []

  const enriched = await Promise.all(
    files.slice(0, 4).map(async (file) => {
      let preview = ''
      try {
        const content = await readGoogleDocContent(accessToken, file.id)
        preview = content.slice(0, 300).replace(/\n+/g, ' ').trim()
      } catch {
        preview = ''
      }
      return {
        id: file.id,
        title: file.name || 'Untitled',
        modifiedTime: file.modifiedTime || null,
        webViewLink: file.webViewLink || null,
        preview,
      } satisfies GoogleDocSummary
    })
  )

  const rest = files.slice(4).map((file) => ({
    id: file.id,
    title: file.name || 'Untitled',
    modifiedTime: file.modifiedTime || null,
    webViewLink: file.webViewLink || null,
    preview: '',
  })) satisfies GoogleDocSummary[]

  return [...enriched, ...rest]
}

export async function createGoogleDoc(
  accessToken: string,
  parameters: Record<string, unknown>
): Promise<IntegrationExecutionResult> {
  const response = await googleFetch(
    'https://docs.googleapis.com/v1/documents',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: parameters.title || 'Kova document',
      }),
    },
    { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS }
  )

  if (!response.ok) {
    throw new Error(`Google Docs create failed: ${response.status}`)
  }

  const document = (await response.json()) as { documentId: string; title: string }
  const sections = Array.isArray(parameters.sections) ? parameters.sections : []
  const sourcePrompt = typeof parameters.sourcePrompt === 'string' ? parameters.sourcePrompt : ''
  const text = `${sections.map((section) => `${section}\n`).join('\n')}\n${sourcePrompt}\n`
  await insertTextIntoGoogleDoc(accessToken, document.documentId, text)

  return {
    details: 'Document created in Google Docs.',
    output: {
      provider: 'google_docs',
      documentId: document.documentId,
      title: document.title,
    },
  }
}

export async function updateGoogleDoc(
  accessToken: string,
  parameters: Record<string, unknown>
): Promise<IntegrationExecutionResult> {
  const documentId = String(parameters.documentId || '')
  if (!documentId) {
    throw new Error('documentId is required to update a Google Doc.')
  }

  const text =
    typeof parameters.content === 'string' ? parameters.content : JSON.stringify(parameters.content || '', null, 2)
  await insertTextIntoGoogleDoc(accessToken, documentId, `\n${text}\n`)

  return {
    details: 'Document updated in Google Docs.',
    output: {
      provider: 'google_docs',
      documentId,
    },
  }
}
