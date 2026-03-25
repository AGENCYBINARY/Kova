import { prisma } from '@/lib/db/prisma'
import {
  deriveAliases,
  deriveNameFromEmail,
  titleCaseContactValue,
  type KnownContact,
} from '@/lib/contacts-utils'

export type { KnownContact } from '@/lib/contacts-utils'
export {
  extractEmailAddresses,
  extractNameBeforeEmail,
  extractNameNearEmail,
  extractRecipientName,
  findContactByName,
  looksLikeContactCorrection,
} from '@/lib/contacts-utils'

function isPlaceholderEmail(email: string) {
  const normalized = email.trim().toLowerCase()
  return (
    normalized === 'recipient@example.com' ||
    normalized.endsWith('@example.com') ||
    normalized.endsWith('@test.com')
  )
}

export async function listKnownContacts(params: { userId: string; workspaceId: string }) {
  const contacts = await prisma.contact.findMany({
    where: {
      userId: params.userId,
      workspaceId: params.workspaceId,
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  })

  return contacts.map((contact) => ({
    name: contact.name.includes('@') ? deriveNameFromEmail(contact.email) || contact.name : contact.name,
    email: contact.email,
    aliases: [
      ...(Array.isArray(contact.aliases) && contact.aliases.every((item) => typeof item === 'string')
        ? (contact.aliases as string[])
        : []),
      ...deriveAliases(contact.name.includes('@') ? deriveNameFromEmail(contact.email) || contact.name : contact.name, contact.email),
    ],
  })) satisfies KnownContact[]
}
export async function rememberContact(params: {
  userId: string
  workspaceId: string
  email: string
  name?: string | null
  aliases?: string[]
}) {
  const email = params.email.trim().toLowerCase()
  if (!email || isPlaceholderEmail(email)) return

  const existing = await prisma.contact.findFirst({
    where: {
      userId: params.userId,
      workspaceId: params.workspaceId,
      email,
    },
  })

  const aliases = new Set<string>()
  if (existing && Array.isArray(existing.aliases)) {
    for (const alias of existing.aliases) {
      if (typeof alias === 'string' && alias.trim()) aliases.add(alias)
    }
  }

  const normalizedName =
    params.name?.trim()
      ? titleCaseContactValue(params.name.trim())
      : existing?.name && !existing.name.includes('@')
        ? existing.name
        : deriveNameFromEmail(email) || email

  if (normalizedName && normalizedName !== email) {
    for (const alias of deriveAliases(normalizedName, email)) {
      aliases.add(alias)
    }
  }

  for (const alias of params.aliases || []) {
    if (typeof alias === 'string' && alias.trim()) {
      aliases.add(titleCaseContactValue(alias.trim()))
    }
  }

  await prisma.contact.upsert({
    where: {
      workspaceId_userId_email: {
        workspaceId: params.workspaceId,
        userId: params.userId,
        email,
      },
    },
    update: {
      name: normalizedName,
      aliases: Array.from(aliases),
    },
    create: {
      name: normalizedName,
      email,
      aliases: Array.from(aliases),
      workspaceId: params.workspaceId,
      userId: params.userId,
    },
  })
}
