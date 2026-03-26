export interface KnownContact {
  name: string
  email: string
  aliases: string[]
}

const emailAddressPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}/g
const leadingCorrectionWordsPattern =
  /^(utilise|use|voici|voila|voilà|prends|take|mets|put|c est|c'est|pour|for|adresse|mail|email|le|la|du|de|des)\s+/i
const noisyContactNamePattern =
  /\b(utilise|use|voici|voila|voilà|prends|take|mets|put|mail|email|adresse|correcte?|bonne?|mauvaise?|remplace|plutot|plutôt|c est|c'est)\b/i

export function normalizeContactValue(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function titleCaseContactValue(value: string) {
  return value
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function sanitizeContactNameCandidate(value: string) {
  const cleaned = value
    .trim()
    .replace(leadingCorrectionWordsPattern, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return null

  const words = cleaned.split(' ').filter(Boolean)
  if (words.length === 1 && words[0].length < 2) {
    return null
  }

  if (words.length > 4 || noisyContactNamePattern.test(cleaned)) {
    return null
  }

  return titleCaseContactValue(cleaned)
}

export function deriveNameFromEmail(email: string) {
  const localPart = email.split('@')[0] || ''
  const normalized = localPart
    .replace(/[._-]+/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return normalized ? titleCaseContactValue(normalized) : null
}

export function deriveAliases(name: string, email: string) {
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

export function findContactByName(input: string, contacts: KnownContact[]) {
  const normalizedInput = normalizeContactValue(input)
  if (!normalizedInput) return null

  let bestMatch: KnownContact | null = null
  let bestScore = 0

  for (const contact of contacts) {
    const candidates = [contact.name, ...contact.aliases].map(normalizeContactValue)

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
    /(?:to|for|a|à|avec|with)\s+([A-Za-zÀ-ÿ' -]{2,80}?)(?:\s+(?:about|subject|with|saying|regarding|concernant|au sujet de|pour|pour dire|et tu lui dis|et dis lui)\b|[,.!?]|$)/i
  )

  return match?.[1]?.trim() || null
}

export function extractNameBeforeEmail(input: string, email: string) {
  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = input.match(new RegExp(`(?:to|a|for)\\s+([A-Za-zÀ-ÿ' -]{2,80})\\s+<?${escapedEmail}>?`, 'i'))
  if (!match?.[1]) {
    return null
  }

  return sanitizeContactNameCandidate(match[1])
}

export function extractEmailAddresses(input: string) {
  return Array.from(new Set((input.match(emailAddressPattern) || []).map((email) => email.trim().toLowerCase())))
}

export function looksLikeContactCorrection(input: string) {
  return /\b(non|pas le bon|pas ce mail|pas cette adresse|le bon mail|la bonne adresse|utilise|prends|plutot|plutôt|remplace|c est|c'est|voici|adresse correcte)\b/i.test(
    input
  )
}

export function extractNameNearEmail(input: string, email: string) {
  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const beforeMatch = input.match(new RegExp(`([A-Za-zÀ-ÿ' -]{2,80})\\s+<?${escapedEmail}>?`, 'i'))
  if (beforeMatch?.[1]) {
    return sanitizeContactNameCandidate(beforeMatch[1])
  }

  const afterMatch = input.match(
    new RegExp(`<?${escapedEmail}>?\\s+(?:pour|for|c est|c'est|utilise pour|use for)\\s+([A-Za-zÀ-ÿ' -]{2,80})`, 'i')
  )
  if (afterMatch?.[1]) {
    return sanitizeContactNameCandidate(afterMatch[1])
  }

  return null
}
