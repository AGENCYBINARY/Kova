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

/**
 * All workspace contacts that match the name query, best first (deduped by email).
 */
export function findContactCandidatesByName(input: string, contacts: KnownContact[]) {
  const normalizedInput = normalizeContactValue(input)
  if (!normalizedInput) return []

  const scored: Array<{ contact: KnownContact; score: number }> = []

  for (const contact of contacts) {
    const nameCandidates = [contact.name, ...contact.aliases].map(normalizeContactValue)
    let best = 0
    for (const candidate of nameCandidates) {
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
      if (score > best) best = score
    }
    if (best >= 40) scored.push({ contact, score: best })
  }

  const byEmail = new Map<string, { contact: KnownContact; score: number }>()
  for (const entry of scored) {
    const key = entry.contact.email.toLowerCase()
    const existing = byEmail.get(key)
    if (!existing || entry.score > existing.score) byEmail.set(key, entry)
  }

  return Array.from(byEmail.values()).sort((a, b) => b.score - a.score)
}

/** Text often follows a person name in long French requests (not only "et/avec/pour"). */
const recipientNameFollowPattern =
  String.raw`(?=\s+(?:et|avec|pour|pour la|pour le|chercher|cherche|trouve|trouver|retrouve|retrouver|regarde|regarder|dans|gmail|disant|lui|dis|qui|envoyer|envoie|ne|pas|oublier|la|le|un|une|mardi|lundi|mercredi|jeudi|vendredi|samedi|dimanche|demain|réunion|reunion|objectif|agence|calendar|meet|lien|evenement|événement)\b|[,.:;!?]|$)`

export function extractRecipientName(input: string) {
  const normalized = input.replace(/\s+/g, ' ').trim()

  const nameWords = '([A-Za-zÀ-ÿ\'-]+(?:\\s+[A-Za-zÀ-ÿ\'-]+)*?)'
  const patterns: RegExp[] = [
    new RegExp(
      `(?:mail|email|courriel|message)\\s+(?:de|du|d'|d’)\s*${nameWords}${recipientNameFollowPattern}`,
      'i'
    ),
    new RegExp(
      `(?:mail|email|courriel|message)\\s+(?:à|a)\\s+${nameWords}${recipientNameFollowPattern}`,
      'i'
    ),
    new RegExp(
      `(?:envoyer|envoie|rédiger|rédige|rediger|redige)\\s+(?:un\\s+)?(?:mail|email|courriel)\\s+(?:à|a)\\s+${nameWords}${recipientNameFollowPattern}`,
      'i'
    ),
    new RegExp(
      `(?:to|for|a|à|avec|with)\\s+${nameWords}(?=\\s+(?:about|subject|with|saying|regarding|concernant|au sujet de|pour|pour dire|et tu lui dis|et dis lui)\\b|[,.!?]|$)`,
      'i'
    ),
  ]

  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    if (match?.[1]) {
      const sanitized = sanitizeContactNameCandidate(match[1].trim())
      if (sanitized) return sanitized
    }
  }

  return null
}

/**
 * Name for Gmail lookup when the user asks to find an address ("trouve le mail de X", etc.).
 */
export function extractGmailLookupNameQuery(input: string): string | null {
  const normalized = input.replace(/\s+/g, ' ').trim()
  /** Max 4 tokens; non-greedy so "… massarelli regarde …" stops at the name, not at "regarde". */
  const nameWords = '([A-Za-zÀ-ÿ\'-]+(?:\\s+[A-Za-zÀ-ÿ\'-]+){0,3}?)'
  const nameEnd = String.raw`(?=\s*$|[,.;!?]|\s+(?:sur|dans|d'|d’|gmail|et|regarde|regarder|mes|le|la|les|pour|avec|qui|dis|dis-moi)\b)`
  const patterns: RegExp[] = [
    new RegExp(
      `(?:trouve|trouver|cherche|chercher|retrouve|retrouver)(?:\\s+toi)?\\s+(?:le\\s+|l['’]\\s*)?(?:mail|email|courriel)\\s+(?:de|d['’]|pour)\\s*${nameWords}${nameEnd}`,
      'i'
    ),
    new RegExp(
      `(?:trouve|trouver|cherche|chercher)\\s+(?:l['’]\\s*)?adresse\\s+(?:mail|email)?\\s*(?:de|d['’])?\\s*${nameWords}${nameEnd}`,
      'i'
    ),
    new RegExp(
      `(?:contact|adresse)\\s+(?:mail|email)?\\s*(?:de|d['’])\\s*${nameWords}${nameEnd}`,
      'i'
    ),
  ]

  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    if (match?.[1]) {
      const sanitized = sanitizeContactNameCandidate(match[1].trim())
      if (sanitized) return sanitized
    }
  }

  return extractRecipientName(input)
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
