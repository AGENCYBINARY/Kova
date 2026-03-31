import type { IntegrationExecutionResult } from '@/lib/integrations/types'
import {
  googleFetch,
  GOOGLE_READ_TIMEOUT_MS,
  GOOGLE_WRITE_TIMEOUT_MS,
} from '@/lib/integrations/google-http'

export interface GoogleDriveFileSummary {
  id: string
  name: string
  mimeType: string
  modifiedTime: string | null
  owners: string[]
  webViewLink: string | null
  parentIds?: string[]
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/'/g, "\\'")
}

async function findDriveFileByName(accessToken: string, name: string, parentId?: string | null) {
  const clauses = ["trashed=false", `name='${escapeDriveQueryValue(name)}'`]
  if (parentId) {
    clauses.push(`'${escapeDriveQueryValue(parentId)}' in parents`)
  }

  const url = new URL('https://www.googleapis.com/drive/v3/files')
  url.searchParams.set('q', clauses.join(' and '))
  url.searchParams.set('pageSize', '10')
  url.searchParams.set('fields', 'files(id,name,mimeType,parents,webViewLink,modifiedTime)')

  const response = await googleFetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }, { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 })

  if (!response.ok) {
    throw new Error(`Google Drive lookup failed: ${response.status}`)
  }

  const data = await response.json() as {
    files?: Array<{
      id: string
      name?: string
      mimeType?: string
      parents?: string[]
      webViewLink?: string
      modifiedTime?: string
    }>
  }

  return (data.files || [])[0] || null
}

async function ensureDriveFolderPath(accessToken: string, folderPath: string) {
  const segments = folderPath
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  let parentId: string | null = null

  for (const segment of segments) {
    const existing = await findDriveFileByName(accessToken, segment, parentId)
    if (existing?.mimeType === 'application/vnd.google-apps.folder') {
      parentId = existing.id
      continue
    }

    const createResponse = await googleFetch('https://www.googleapis.com/drive/v3/files?fields=id,name,parents,mimeType', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: segment,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    }, { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS })

    if (!createResponse.ok) {
      throw new Error(`Google Drive folder path creation failed: ${createResponse.status}`)
    }

    const created = await createResponse.json() as { id: string }
    parentId = created.id
  }

  return parentId
}

export async function searchGoogleDriveFiles(
  accessToken: string,
  options: {
    query?: string
    maxResults?: number
  } = {}
) {
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  const clauses = ["trashed=false"]

  if (options.query?.trim()) {
    const escapedQuery = escapeDriveQueryValue(options.query.trim())
    clauses.push(`(name contains '${escapedQuery}' or fullText contains '${escapedQuery}')`)
  }

  url.searchParams.set('q', clauses.join(' and '))
  url.searchParams.set('orderBy', 'modifiedTime desc')
  url.searchParams.set('pageSize', String(Math.max(1, Math.min(options.maxResults || 12, 30))))
  url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,owners(displayName,emailAddress),webViewLink,parents)')

  const response = await googleFetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }, { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 })

  if (!response.ok) {
    throw new Error(`Google Drive read failed: ${response.status}`)
  }

  const data = await response.json() as {
    files?: Array<{
      id: string
      name?: string
      mimeType?: string
      modifiedTime?: string
      webViewLink?: string
      parents?: string[]
      owners?: Array<{ displayName?: string; emailAddress?: string }>
    }>
  }

  return (data.files || []).map((file) => ({
    id: file.id,
    name: file.name || 'Untitled',
    mimeType: file.mimeType || 'application/octet-stream',
    modifiedTime: file.modifiedTime || null,
    owners: (file.owners || []).map((owner) => owner.displayName || owner.emailAddress || '').filter(Boolean),
    webViewLink: file.webViewLink || null,
    parentIds: Array.isArray(file.parents) ? file.parents : [],
  } satisfies GoogleDriveFileSummary))
}

async function searchGoogleDriveAppDataFiles(
  accessToken: string,
  options: {
    query?: string
    maxResults?: number
  } = {}
) {
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  const clauses = ["'appDataFolder' in parents", 'trashed=false']

  if (options.query?.trim()) {
    const escapedQuery = escapeDriveQueryValue(options.query.trim())
    clauses.push(`(name contains '${escapedQuery}' or fullText contains '${escapedQuery}')`)
  }

  url.searchParams.set('spaces', 'appDataFolder')
  url.searchParams.set('q', clauses.join(' and '))
  url.searchParams.set('pageSize', String(Math.max(1, Math.min(options.maxResults || 20, 50))))
  url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime)')

  const response = await googleFetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }, { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 })

  if (!response.ok) {
    throw new Error(`Google Drive appData read failed: ${response.status}`)
  }

  const data = await response.json() as {
    files?: Array<{ id: string; name?: string; mimeType?: string; modifiedTime?: string }>
  }

  return (data.files || []).map((file) => ({
    id: file.id,
    name: file.name || 'Untitled',
    mimeType: file.mimeType || 'application/octet-stream',
    modifiedTime: file.modifiedTime || null,
  }))
}

export async function listGoogleDriveAppDataFiles(
  accessToken: string,
  options: {
    query?: string
    maxResults?: number
  } = {}
) {
  const clauses = ["trashed=false", "'appDataFolder' in parents"]
  if (options.query?.trim()) {
    clauses.push(`name contains '${escapeDriveQueryValue(options.query.trim())}'`)
  }

  const url = new URL('https://www.googleapis.com/drive/v3/files')
  url.searchParams.set('q', clauses.join(' and '))
  url.searchParams.set('orderBy', 'modifiedTime desc')
  url.searchParams.set('pageSize', String(Math.max(1, Math.min(options.maxResults || 20, 50))))
  url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime)')

  const response = await googleFetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }, { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 })

  if (!response.ok) {
    throw new Error(`Google Drive appData read failed: ${response.status}`)
  }

  const data = await response.json() as {
    files?: Array<{ id: string; name?: string; mimeType?: string; modifiedTime?: string }>
  }

  return (data.files || []).map((file) => ({
    id: file.id,
    name: file.name || 'Untitled config',
    mimeType: file.mimeType || 'application/octet-stream',
    modifiedTime: file.modifiedTime || null,
  }))
}

export async function upsertGoogleDriveAppDataFile(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const name = String(parameters.name || parameters.key || 'kova-config.json').trim()
  const content = typeof parameters.content === 'string' ? parameters.content : JSON.stringify(parameters.value ?? {}, null, 2)
  const mimeType = typeof parameters.mimeType === 'string' ? parameters.mimeType : 'application/json'

  if (!name) {
    throw new Error('name is required to save app data in Google Drive.')
  }

  const existing = await findDriveFileByName(accessToken, name, 'appDataFolder')
  const endpoint = existing
    ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart&fields=id,name,modifiedTime`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime'

  const response = await googleFetch(endpoint, {
    method: existing ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'multipart/related; boundary=kova_appdata_boundary',
    },
    body: [
      '--kova_appdata_boundary',
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify({
        name,
        mimeType,
        parents: ['appDataFolder'],
      }),
      '--kova_appdata_boundary',
      `Content-Type: ${mimeType}`,
      '',
      content,
      '--kova_appdata_boundary--',
    ].join('\r\n'),
  }, { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS })

  if (!response.ok) {
    throw new Error(`Google Drive appData upsert failed: ${response.status}`)
  }

  const data = await response.json() as { id: string; name?: string; modifiedTime?: string }
  return {
    details: existing ? 'Drive app data updated.' : 'Drive app data created.',
    output: {
      provider: 'google_drive',
      fileId: data.id,
      name: data.name || name,
      appData: true,
      modifiedTime: data.modifiedTime || null,
    },
  }
}

export async function deleteGoogleDriveAppDataFile(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const fileId = String(parameters.fileId || '').trim()
  const fileName = String(parameters.name || '').trim()
  let resolvedFileId = fileId

  if (!resolvedFileId && fileName) {
    const existing = await findDriveFileByName(accessToken, fileName, 'appDataFolder')
    resolvedFileId = existing?.id || ''
  }

  if (!resolvedFileId) {
    throw new Error('fileId or name is required to delete Drive app data.')
  }

  const response = await googleFetch(`https://www.googleapis.com/drive/v3/files/${resolvedFileId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }, { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS })

  if (!response.ok) {
    throw new Error(`Google Drive appData delete failed: ${response.status}`)
  }

  return {
    details: 'Drive app data deleted.',
    output: {
      provider: 'google_drive',
      fileId: resolvedFileId,
      appData: true,
      deleted: true,
    },
  }
}


export async function deleteGoogleDriveFile(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const fileId = String(parameters.fileId || '')
  if (!fileId) throw new Error('fileId is required to delete a Drive file.')

  const response = await googleFetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS }
  )

  if (!response.ok && response.status !== 204) {
    throw new Error(`Google Drive file deletion failed: ${response.status}`)
  }

  return {
    details: 'File deleted from Google Drive.',
    output: { provider: 'google_drive', fileId, deleted: true },
  }
}

async function getGoogleDriveFile(accessToken: string, fileId: string) {
  const response = await googleFetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,parents,webViewLink`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 }
  )

  if (!response.ok) {
    throw new Error(`Google Drive file read failed: ${response.status}`)
  }

  return response.json() as Promise<{
    id: string
    name?: string
    mimeType?: string
    parents?: string[]
    webViewLink?: string
  }>
}

export async function renameGoogleDriveFile(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const fileId = String(parameters.fileId || '')
  const name = String(parameters.name || '').trim()

  if (!fileId) {
    throw new Error('fileId is required to rename a Drive file.')
  }

  if (!name) {
    throw new Error('name is required to rename a Drive file.')
  }

  const response = await googleFetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,webViewLink,mimeType`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    },
    { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS }
  )

  if (!response.ok) {
    throw new Error(`Google Drive rename failed: ${response.status}`)
  }

  const data = await response.json() as { id: string; name?: string; webViewLink?: string; mimeType?: string }
  return {
    details: 'Drive file renamed.',
    output: {
      provider: 'google_drive',
      fileId: data.id,
      name: data.name || name,
      mimeType: data.mimeType || null,
      link: data.webViewLink || null,
    },
  }
}

export async function moveGoogleDriveFile(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const fileId = String(parameters.fileId || '')
  const destinationFolderId = typeof parameters.destinationFolderId === 'string' ? parameters.destinationFolderId.trim() : ''
  const destinationFolderName = typeof parameters.destinationFolderName === 'string' ? parameters.destinationFolderName.trim() : ''
  const destinationFolderPath = typeof parameters.destinationFolderPath === 'string' ? parameters.destinationFolderPath.trim() : ''

  if (!fileId) {
    throw new Error('fileId is required to move a Drive file.')
  }

  const targetFolderId =
    destinationFolderId ||
    (destinationFolderPath ? await ensureDriveFolderPath(accessToken, destinationFolderPath) : '') ||
    (destinationFolderName ? await ensureDriveFolder(accessToken, destinationFolderName) : '')
  if (!targetFolderId) {
    throw new Error('destinationFolderId, destinationFolderName, or destinationFolderPath is required to move a Drive file.')
  }

  const current = await getGoogleDriveFile(accessToken, fileId)
  const currentParents = Array.isArray(current.parents) ? current.parents.filter(Boolean) : []

  const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`)
  url.searchParams.set('addParents', targetFolderId)
  if (currentParents.length > 0) {
    url.searchParams.set('removeParents', currentParents.join(','))
  }
  url.searchParams.set('fields', 'id,name,mimeType,parents,webViewLink')

  const response = await googleFetch(url.toString(), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }, { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS })

  if (!response.ok) {
    throw new Error(`Google Drive move failed: ${response.status}`)
  }

  const data = await response.json() as { id: string; name?: string; mimeType?: string; parents?: string[]; webViewLink?: string }
  return {
    details: 'Drive file moved.',
    output: {
      provider: 'google_drive',
      fileId: data.id,
      name: data.name || current.name || null,
      mimeType: data.mimeType || current.mimeType || null,
      parentIds: Array.isArray(data.parents) ? data.parents : [targetFolderId],
      destinationFolderId: targetFolderId,
      destinationFolderName: destinationFolderPath || destinationFolderName || null,
      link: data.webViewLink || current.webViewLink || null,
    },
  }
}

export async function shareGoogleDriveFile(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const fileId = String(parameters.fileId || '')
  const emails = Array.isArray(parameters.emails)
    ? parameters.emails.filter((value): value is string => typeof value === 'string' && value.includes('@'))
    : []
  const role =
    parameters.role === 'reader' || parameters.role === 'commenter' || parameters.role === 'writer'
      ? parameters.role
      : 'reader'
  const notify = typeof parameters.notify === 'boolean' ? parameters.notify : true
  const message = typeof parameters.message === 'string' ? parameters.message : ''

  if (!fileId) {
    throw new Error('fileId is required to share a Drive file.')
  }

  if (emails.length === 0) {
    throw new Error('emails is required to share a Drive file.')
  }

  const grantedRecipients: string[] = []
  for (const email of emails) {
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`)
    url.searchParams.set('sendNotificationEmail', notify ? 'true' : 'false')
    if (message) {
      url.searchParams.set('emailMessage', message)
    }

    const response = await googleFetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role,
        type: 'user',
        emailAddress: email,
      }),
    }, { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS })

    if (!response.ok) {
      if (grantedRecipients.length > 0) {
        throw new Error(`Google Drive share partially succeeded for ${grantedRecipients.join(', ')} before failing with ${response.status}`)
      }
      throw new Error(`Google Drive share failed: ${response.status}`)
    }

    grantedRecipients.push(email)
  }

  const file = await getGoogleDriveFile(accessToken, fileId)
  return {
    details: 'Drive file shared.',
    output: {
      provider: 'google_drive',
      fileId,
      emails,
      role,
      name: file.name || null,
      link: file.webViewLink || null,
    },
  }
}

export async function copyGoogleDriveFile(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const fileId = String(parameters.fileId || '')
  const name = typeof parameters.name === 'string' ? parameters.name.trim() : ''
  const destinationFolderId = typeof parameters.destinationFolderId === 'string' ? parameters.destinationFolderId.trim() : ''
  const destinationFolderName = typeof parameters.destinationFolderName === 'string' ? parameters.destinationFolderName.trim() : ''
  const destinationFolderPath = typeof parameters.destinationFolderPath === 'string' ? parameters.destinationFolderPath.trim() : ''

  if (!fileId) {
    throw new Error('fileId is required to copy a Drive file.')
  }

  const targetFolderId =
    destinationFolderId ||
    (destinationFolderPath ? await ensureDriveFolderPath(accessToken, destinationFolderPath) : '') ||
    (destinationFolderName ? await ensureDriveFolder(accessToken, destinationFolderName) : '')
  const response = await googleFetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/copy?fields=id,name,mimeType,parents,webViewLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...(name ? { name } : {}),
        ...(targetFolderId ? { parents: [targetFolderId] } : {}),
      }),
    },
    { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS }
  )

  if (!response.ok) {
    throw new Error(`Google Drive copy failed: ${response.status}`)
  }

  const data = await response.json() as {
    id: string
    name?: string
    mimeType?: string
    parents?: string[]
    webViewLink?: string
  }

  return {
    details: 'Drive file copied.',
    output: {
      provider: 'google_drive',
      sourceFileId: fileId,
      fileId: data.id,
      name: data.name || null,
      mimeType: data.mimeType || null,
      parentIds: Array.isArray(data.parents) ? data.parents : (targetFolderId ? [targetFolderId] : []),
      destinationFolderId: targetFolderId || null,
      destinationFolderName: destinationFolderPath || destinationFolderName || null,
      link: data.webViewLink || null,
    },
  }
}

async function listGoogleDrivePermissions(accessToken: string, fileId: string) {
  const response = await googleFetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?fields=permissions(id,emailAddress,role,type)`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 }
  )

  if (!response.ok) {
    throw new Error(`Google Drive permissions read failed: ${response.status}`)
  }

  const data = await response.json() as {
    permissions?: Array<{ id?: string; emailAddress?: string; role?: string; type?: string }>
  }

  return (data.permissions || []).map((permission) => ({
    id: permission.id || '',
    emailAddress: permission.emailAddress || '',
    role: permission.role || '',
    type: permission.type || '',
  }))
}

export async function unshareGoogleDriveFile(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const fileId = String(parameters.fileId || '')
  const emails = Array.isArray(parameters.emails)
    ? parameters.emails.filter((value): value is string => typeof value === 'string' && value.includes('@'))
    : []

  if (!fileId) {
    throw new Error('fileId is required to unshare a Drive file.')
  }

  if (emails.length === 0) {
    throw new Error('emails is required to unshare a Drive file.')
  }

  const permissions = await listGoogleDrivePermissions(accessToken, fileId)
  const removed: string[] = []

  for (const email of emails) {
    const permission = permissions.find((entry) => entry.emailAddress.toLowerCase() === email.toLowerCase())
    if (!permission?.id) {
      continue
    }

    const response = await googleFetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/permissions/${permission.id}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS }
    )

    if (!response.ok) {
      if (removed.length > 0) {
        throw new Error(`Google Drive unshare partially succeeded for ${removed.join(', ')} before failing with ${response.status}`)
      }
      throw new Error(`Google Drive unshare failed: ${response.status}`)
    }

    removed.push(email)
  }

  const file = await getGoogleDriveFile(accessToken, fileId)
  return {
    details: removed.length > 0 ? 'Drive access revoked.' : 'No matching Drive permissions were found to revoke.',
    output: {
      provider: 'google_drive',
      fileId,
      emails: removed,
      name: file.name || null,
      link: file.webViewLink || null,
    },
  }
}

export async function createGoogleDriveAppDataFile(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const name = String(parameters.name || 'kova-config.json').trim()
  const mimeType = String(parameters.mimeType || 'application/json').trim() || 'application/json'
  const content = typeof parameters.content === 'string' ? parameters.content : '{}'

  const response = await googleFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'multipart/related; boundary=kova_appdata_boundary',
    },
    body: [
      '--kova_appdata_boundary',
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify({
        name,
        mimeType,
        parents: ['appDataFolder'],
      }),
      '--kova_appdata_boundary',
      `Content-Type: ${mimeType}`,
      '',
      content,
      '--kova_appdata_boundary--',
    ].join('\r\n'),
  }, { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS })

  if (!response.ok) {
    throw new Error(`Google Drive appData file creation failed: ${response.status}`)
  }

  const data = await response.json() as { id: string; name?: string; mimeType?: string; modifiedTime?: string }
  return {
    details: 'Drive app data file created.',
    output: {
      provider: 'google_drive',
      fileId: data.id,
      name: data.name || name,
      mimeType: data.mimeType || mimeType,
      modifiedTime: data.modifiedTime || null,
      appData: true,
    },
  }
}

export async function updateGoogleDriveAppDataFile(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const fileId = String(parameters.fileId || '').trim()
  const name = typeof parameters.name === 'string' ? parameters.name.trim() : ''
  const mimeType = String(parameters.mimeType || 'application/json').trim() || 'application/json'
  const content = typeof parameters.content === 'string' ? parameters.content : '{}'

  if (!fileId) {
    throw new Error('fileId is required to update a Drive app data file.')
  }

  const response = await googleFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,name,mimeType,modifiedTime`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'multipart/related; boundary=kova_appdata_boundary',
    },
    body: [
      '--kova_appdata_boundary',
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify({
        ...(name ? { name } : {}),
        mimeType,
      }),
      '--kova_appdata_boundary',
      `Content-Type: ${mimeType}`,
      '',
      content,
      '--kova_appdata_boundary--',
    ].join('\r\n'),
  }, { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS })

  if (!response.ok) {
    throw new Error(`Google Drive appData file update failed: ${response.status}`)
  }

  const data = await response.json() as { id: string; name?: string; mimeType?: string; modifiedTime?: string }
  return {
    details: 'Drive app data file updated.',
    output: {
      provider: 'google_drive',
      fileId: data.id,
      name: data.name || name || null,
      mimeType: data.mimeType || mimeType,
      modifiedTime: data.modifiedTime || null,
      appData: true,
    },
  }
}

async function ensureDriveFolder(accessToken: string, folderName: string) {
  const query = `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${folderName.replace(/'/g, "\\'")}'`
  const lookupResponse = await googleFetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=10`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 }
  )

  if (lookupResponse.ok) {
    const lookupData = await lookupResponse.json() as { files?: Array<{ id: string; name: string }> }
    const existingFolder = lookupData.files?.find((file) => file.name === folderName)
    if (existingFolder) {
      return existingFolder.id
    }
  }

  const createResponse = await googleFetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  }, { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS })

  if (!createResponse.ok) {
    throw new Error(`Google Drive folder creation failed: ${createResponse.status}`)
  }

  const folder = await createResponse.json() as { id: string }
  return folder.id
}

export async function createGoogleDriveFile(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const name = String(parameters.name || 'Kova file')
  const mimeType = String(parameters.mimeType || 'text/plain')
  const content = typeof parameters.content === 'string' ? parameters.content : ''
  const folderName = typeof parameters.folderName === 'string' ? parameters.folderName.trim() : ''
  const folderPath = typeof parameters.folderPath === 'string' ? parameters.folderPath.trim() : ''
  const parentFolderIdParam = typeof parameters.parentFolderId === 'string' ? parameters.parentFolderId.trim() : ''
  const parentFolderId =
    parentFolderIdParam ||
    (folderPath ? await ensureDriveFolderPath(accessToken, folderPath) : null) ||
    (folderName ? await ensureDriveFolder(accessToken, folderName) : null)

  const metadata = {
    name,
    mimeType,
    ...(parentFolderId ? { parents: [parentFolderId] } : {}),
  }

  const isFolder = mimeType === 'application/vnd.google-apps.folder'

  const response = await googleFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink,parents,mimeType', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'multipart/related; boundary=kova_drive_boundary',
    },
    body: isFolder
      ? [
          '--kova_drive_boundary',
          'Content-Type: application/json; charset=UTF-8',
          '',
          JSON.stringify(metadata),
          '--kova_drive_boundary--',
        ].join('\r\n')
      : [
          '--kova_drive_boundary',
          'Content-Type: application/json; charset=UTF-8',
          '',
          JSON.stringify(metadata),
          '--kova_drive_boundary',
          `Content-Type: ${mimeType}`,
          '',
          content,
          '--kova_drive_boundary--',
        ].join('\r\n'),
  }, { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS })

  if (!response.ok) {
    throw new Error(`Google Drive file creation failed: ${response.status}`)
  }

  const data = await response.json() as {
    id: string
    name: string
    webViewLink?: string
    webContentLink?: string
    mimeType?: string
    parents?: string[]
  }

  return {
    details: isFolder ? 'Folder created in Google Drive.' : 'File created in Google Drive.',
    output: {
      provider: 'google_drive',
      fileId: data.id,
      name: data.name,
      mimeType: data.mimeType || mimeType,
      folderId: parentFolderId,
      folderName: folderPath || folderName || null,
      link: data.webViewLink || data.webContentLink || null,
    },
  }
}

export async function createGoogleDriveFolder(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  return createGoogleDriveFile(accessToken, {
    ...parameters,
    mimeType: 'application/vnd.google-apps.folder',
  })
}
