import { prisma } from '../src/lib/db/prisma'
import {
  getValidGoogleAccessToken,
  listGoogleCalendarEvents,
  listRecentGoogleDocs,
  listTodayGmailMessages,
  searchGoogleDriveFiles,
} from '../src/lib/integrations/google'
import { getValidNotionAccessToken, searchNotionPages } from '../src/lib/integrations/notion'

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required.`)
  }
  return value
}

async function main() {
  const workspaceId = requireEnv('KOVA_SMOKE_WORKSPACE_ID')
  const userId = requireEnv('KOVA_SMOKE_USER_ID')

  const integrations = await prisma.integration.findMany({
    where: {
      workspaceId,
      userId,
      status: 'connected',
      type: {
        in: ['gmail', 'calendar', 'google_docs', 'google_drive', 'notion'],
      },
    },
    orderBy: [{ updatedAt: 'desc' }],
  })

  const byType = new Map<string, (typeof integrations)[number]>()
  for (const integration of integrations) {
    if (!byType.has(integration.type)) {
      byType.set(integration.type, integration)
    }
  }

  const results: Array<{ provider: string; ok: boolean; detail: string }> = []

  const gmail = byType.get('gmail')
  if (gmail) {
    try {
      const accessToken = await getValidGoogleAccessToken(gmail)
      const messages = await listTodayGmailMessages(accessToken, { maxResults: 5 })
      results.push({ provider: 'gmail', ok: true, detail: `${messages.length} message(s) loaded` })
    } catch (error) {
      results.push({ provider: 'gmail', ok: false, detail: error instanceof Error ? error.message : 'unknown error' })
    }
  }

  const calendar = byType.get('calendar')
  if (calendar) {
    try {
      const accessToken = await getValidGoogleAccessToken(calendar)
      const now = new Date()
      const later = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      const events = await listGoogleCalendarEvents(accessToken, {
        timeMin: now.toISOString(),
        timeMax: later.toISOString(),
        maxResults: 5,
      })
      results.push({ provider: 'calendar', ok: true, detail: `${events.length} event(s) loaded` })
    } catch (error) {
      results.push({ provider: 'calendar', ok: false, detail: error instanceof Error ? error.message : 'unknown error' })
    }
  }

  const docs = byType.get('google_docs')
  if (docs) {
    try {
      const accessToken = await getValidGoogleAccessToken(docs)
      const items = await listRecentGoogleDocs(accessToken, { maxResults: 5 })
      results.push({ provider: 'google_docs', ok: true, detail: `${items.length} document(s) loaded` })
    } catch (error) {
      results.push({ provider: 'google_docs', ok: false, detail: error instanceof Error ? error.message : 'unknown error' })
    }
  }

  const drive = byType.get('google_drive')
  if (drive) {
    try {
      const accessToken = await getValidGoogleAccessToken(drive)
      const files = await searchGoogleDriveFiles(accessToken, { maxResults: 5 })
      results.push({ provider: 'google_drive', ok: true, detail: `${files.length} file(s) loaded` })
    } catch (error) {
      results.push({ provider: 'google_drive', ok: false, detail: error instanceof Error ? error.message : 'unknown error' })
    }
  }

  const notion = byType.get('notion')
  if (notion) {
    try {
      const accessToken = getValidNotionAccessToken(notion)
      const pages = await searchNotionPages(accessToken, { maxResults: 5 })
      results.push({ provider: 'notion', ok: true, detail: `${pages.length} page(s) loaded` })
    } catch (error) {
      results.push({ provider: 'notion', ok: false, detail: error instanceof Error ? error.message : 'unknown error' })
    }
  }

  const okCount = results.filter((result) => result.ok).length
  const failed = results.filter((result) => !result.ok)

  for (const result of results) {
    console.log(`${result.ok ? 'OK' : 'FAIL'} ${result.provider}: ${result.detail}`)
  }

  if (failed.length > 0) {
    throw new Error(`Integration smoke failed for ${failed.map((item) => item.provider).join(', ')}`)
  }

  console.log(`Smoke test passed for ${okCount} connected integration(s).`)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
