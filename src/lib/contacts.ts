import { prisma } from '@/lib/db/prisma'

export interface KnownContact {
  name: string
  email: string
  aliases: string[]
}

function isPlaceholderEmail(email: string) {
  const normalized = email.trim().toLowerCase()
  return (
    normalized === 'recipient@example.com' ||
    normalized.endsWith('@example.com') ||
    normalized.endsWith('@test.com')
  )
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleCase(value: string) {
  return value
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function deriveNameFromEmail(email: string) {
  const localPart = email.split('@')[0] || ''
  const normalized = localPart
    .replace(/[._-]+/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return normalized ? titleCase(normalized) : null
}

function deriveAliases(name: string, email: string) {
  const aliases = new Set<string>()
  const cleanedName = name.trim()

  if (cleanedName) {
    aliases.add(cleanedName)

    const parts = cleanedName.split(' ').filter(Boolean)
    if (parts.length >= 2) {
      aliases.add(`${parts[0]} ${parts[parts.length - 1]}`)
      aliases.add(parts.join(' '))
      aliases.add(parts[0])
      aliases.add(parts[parts.length - 1])
    }
  }

  const emailAlias = deriveNameFromEmail(email)
  if (emailAlias) {
    aliases.add(emailAlias)

    const emailParts = emailAlias.split(' ').filter(Boolean)
    if (emailParts.length >= 2) {
      aliases.add(`${emailParts[0]} ${emailParts[emailParts.length - 1]}`)
      aliases.add(emailParts[0])
      aliases.add(emailParts[emailParts.length - 1])
    }
  }

  return Array.from(aliases)
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

export function findContactByName(input: string, contacts: KnownContact[]) {
  const normalizedInput = normalize(input)
  if (!normalizedInput) return null

  let bestMatch: KnownContact | null = null
  let bestScore = 0

  for (const contact of contacts) {
    const candidates = [contact.name, ...contact.aliases].map(normalize)

    for (const candidate of candidates) {
      if (!candidate) continue

      let score = 0
      if (candidate === normalizedInput) {
        score = 100
      } else if (normalizedInput.includes(candidate) || candidate.includes(normalizedInput)) {
        score = 85
      } else {
        const inputParts = normalizedInput.split(' ')
        const candidateParts = candidate.split(' ')
        const overlap = inputParts.filter((part) => candidateParts.includes(part)).length
        score = overlap * 20
      }

      if (score > bestScore) {
        bestScore = score
        bestMatch = contact
      }
    }
  }

  return bestScore >= 40 ? bestMatch : null
}

export function extractRecipientName(input: string) {
  const match = input.match(
    /(?:to|for|a|à|avec|with)\s+([A-Za-zÀ-ÿ' -]{2,80}?)(?:\s+(?:about|subject|with|saying|regarding|concernant|au sujet de|pour dire|et tu lui dis|et dis lui)\b|[,.!?]|$)/i
  )

  return match?.[1]?.trim() || null
}

export function extractNameBeforeEmail(input: string, email: string) {
  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = input.match(new RegExp(`(?:to|a|for)\\s+([A-Za-zÀ-ÿ' -]{2,80})\\s+<?${escapedEmail}>?`, 'i'))
  if (!match?.[1]) {
    return null
  }

  return titleCase(match[1].trim())
}

export async function rememberContact(params: {
  userId: string
  workspaceId: string
  email: string
  name?: string | null
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
      ? titleCase(params.name.trim())
      : existing?.name && !existing.name.includes('@')
        ? existing.name
        : deriveNameFromEmail(email) || email

  if (normalizedName && normalizedName !== email) {
    for (const alias of deriveAliases(normalizedName, email)) {
      aliases.add(alias)
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
