import { promises as fs } from 'node:fs'
import path from 'node:path'
import { loadEnvConfig } from '@next/env'
import { prisma } from '../src/lib/db/prisma'

loadEnvConfig(process.cwd())

export interface LiveTarget {
  workspaceId: string
  userId: string
  providers: string[]
}

function optionalEnv(name: string) {
  const value = process.env[name]
  return value && value.trim() ? value.trim() : null
}

export async function persistLiveTarget(target: LiveTarget) {
  const envPath = path.join(process.cwd(), '.env.local')
  const existing = await fs.readFile(envPath, 'utf8').catch(() => '')
  const lines = existing.split(/\r?\n/)
  const updates = new Map<string, string>([
    ['KOVA_SMOKE_WORKSPACE_ID', target.workspaceId],
    ['KOVA_SMOKE_USER_ID', target.userId],
  ])

  const nextLines = lines.filter((line) => {
    const key = line.split('=')[0]
    return !updates.has(key)
  })

  for (const [key, value] of Array.from(updates.entries())) {
    nextLines.push(`${key}=${value}`)
  }

  await fs.writeFile(envPath, `${nextLines.filter(Boolean).join('\n')}\n`)
  console.log(`LIVE_ENV_WRITTEN ${envPath}`)
}

export function getOptionalEnv(name: string) {
  return optionalEnv(name)
}

export async function resolveLiveTarget() {
  const workspaceId = optionalEnv('KOVA_SMOKE_WORKSPACE_ID')
  const userId = optionalEnv('KOVA_SMOKE_USER_ID')

  if (workspaceId && userId) {
    const integrations = await prisma.integration.findMany({
      where: {
        workspaceId,
        userId,
        status: 'connected',
      },
      select: {
        type: true,
      },
      orderBy: { updatedAt: 'desc' },
    })

    return {
      workspaceId,
      userId,
      providers: Array.from(new Set(integrations.map((item) => item.type))),
      autodiscovered: false,
    }
  }

  const integrations = await prisma.integration.findMany({
    where: {
      status: 'connected',
      type: {
        in: ['gmail', 'calendar', 'google_docs', 'google_drive', 'notion'],
      },
    },
    select: {
      workspaceId: true,
      userId: true,
      type: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  })

  const ranked = new Map<string, LiveTarget & { latestUpdatedAt: number }>()
  for (const integration of integrations) {
    const key = `${integration.workspaceId}:${integration.userId}`
    const existing = ranked.get(key)
    const providerSet = new Set(existing?.providers || [])
    providerSet.add(integration.type)
    ranked.set(key, {
      workspaceId: integration.workspaceId,
      userId: integration.userId,
      providers: Array.from(providerSet),
      latestUpdatedAt: Math.max(existing?.latestUpdatedAt || 0, integration.updatedAt.getTime()),
    })
  }

  const target = Array.from(ranked.values()).sort((left, right) => {
    if (right.providers.length !== left.providers.length) {
      return right.providers.length - left.providers.length
    }
    return right.latestUpdatedAt - left.latestUpdatedAt
  })[0]

  if (!target) {
    throw new Error('No connected workspace was found. Connect Gmail, Drive, Docs, Calendar, or Notion first.')
  }

  if (process.env.KOVA_LIVE_PERSIST_TARGETS === 'true' || process.env.KOVA_LIVE_WRITE_ENV === 'true') {
    await persistLiveTarget(target)
  }

  return {
    workspaceId: target.workspaceId,
    userId: target.userId,
    providers: target.providers,
    autodiscovered: true,
  }
}
