export type ConnectedContextSource = 'gmail' | 'calendar' | 'google_drive' | 'google_docs' | 'notion'

export interface ConnectedContextRequest {
  mode: 'read' | 'action' | 'mixed'
  sources: ConnectedContextSource[]
  timeframe: 'today' | 'week' | 'recent'
  asksForAvailability: boolean
  asksForPriorities: boolean
  searchQuery: string | null
}

export interface ConnectedContextSeed {
  sources: ConnectedContextSource[]
  timeframe: ConnectedContextRequest['timeframe']
  asksForAvailability: boolean
  asksForPriorities: boolean
}

export function normalizeInput(input: string) {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

const gmailPattern =
  /\b(gmail|mail|mails|email|emails|courriel|courriels|inbox|boite mail|boite de reception|message|messages)\b/
const calendarPattern =
  /\b(calendar|agenda|calendrier|event|events|meeting|meetings|rendez-vous|rdv|reunion|reunions|visio|meet)\b/
const drivePattern =
  /\b(google drive|drive|fichier|fichiers|file|files|folder|folders|dossier|dossiers)\b/
const docsPattern =
  /\b(google doc|google docs|gdoc|gdocs|doc partagé|doc partage|document partagé|document partage)\b/
const notionPattern =
  /\b(notion|wiki|knowledge base|base de connaissances|database|base de donnees|base de donnees|page notion)\b/
const readVerbPattern =
  /\b(resum(?:e|er)?|summary|summarize|summarise|liste|list|montre|show|check|review|analyse|analyze|consulte|read|voir|vois|donne|what|quels|which|cherche|search|find|retrouve|trouve|explique|prepare moi|prepare-moi)\b/
const explicitActionPattern =
  /\b(send|draft|reply|write|compose|create|update|schedule|book|invite|plan|share|upload|save|store|sync|connect|disconnect|refresh|archive|unarchive|restore|label|forward|rename|mark|star|unstar|trash|copy|duplicate|revoke|unshare|folder|envoie|envoyer|redige|ecris|cree|creer|mets|mettre|ajoute|ajouter|planifie|programme|partage|enregistre|stocke|sauvegarde|connecte|deconnecte|actualise|rafraichis|range|ranger|move|moved|deplace|deplacer|archiver|restaure|restaurer|labelliser|transfere|transferer|renomme|renommer|marque|corbeille|brouillon|duplique|dupliquer|retire|retirer|dossier)\b/
const emailActionPattern =
  /\b(send|draft|reply|write|compose|envoie|envoyer|redige|ecris|reponds|repondre|transmets|forward)\b/
const todayPattern =
  /\b(aujourd'hui|aujourdhui|today|ce matin|this morning|cet apres-midi|cet apres midi|this afternoon|ce jour)\b/
const weekPattern =
  /\b(cette semaine|this week|semaine prochaine|next week)\b/
const availabilityPattern =
  /\b(dispo|disponibilite|disponibilites|availability|free time|free slots|creneaux|slots|libre)\b/
const priorityPattern =
  /\b(priorit|urgent|urgence|important|focus|top sujets|brief du jour|daily brief|next steps|prochaines priorites|priorites du jour)\b/
const allAppsPattern =
  /\b(toutes mes apps|toutes mes applications|all my apps|connected apps|applications connectees|apps connectees)\b/
const followUpDetailPattern =
  /\b(detaille|detailles|detailler|detaille-les|explique|parle de quoi|de quoi|a quoi correspond|correspond|corresponds|non lu|unread|quel message|quel est|c'est quoi|cest quoi|ce message|ces messages|les messages|les mails|ce mail|ce mail-la|celui-la|celui la)\b/
const followUpLeadPattern =
  /^(et|alors|du coup|ok|daccord|d'accord|je te demande|je veux dire|mais|le|la|les)\b/
const mailboxCountPattern =
  /\b(combien|detaille|detailler|decris|quel|quelle|quels|quelles|dernier|derniere|latest|last)\b/

const stopWords = new Set([
  'a',
  'au',
  'aux',
  'avec',
  'ce',
  'ces',
  'dans',
  'de',
  'des',
  'du',
  'en',
  'et',
  'for',
  'from',
  'i',
  'il',
  'ils',
  'je',
  'la',
  'le',
  'les',
  'ma',
  'mes',
  'mon',
  'my',
  'nos',
  'notre',
  'ou',
  'par',
  'pour',
  'sur',
  'ta',
  'tes',
  'the',
  'this',
  'to',
  'ton',
  'tous',
  'toutes',
  'trouve',
  'retrouve',
  'cherche',
  'search',
  'find',
  'google',
  'est',
  'prepare',
  'preparemoi',
  'prepare-moi',
  'moi',
  'quelles',
  'sont',
  'range',
  'par',
  'partir',
  'show',
  'montre',
  'liste',
  'resume',
  'summary',
  'today',
  'aujourdhui',
  'todays',
  'agenda',
  'calendar',
  'calendrier',
  'gmail',
  'drive',
  'notion',
  'mail',
  'mails',
  'email',
  'emails',
  'message',
  'messages',
  'fichier',
  'fichiers',
  'file',
  'files',
  'page',
  'pages',
])

function uniqueSources(sources: ConnectedContextSource[]) {
  return Array.from(new Set(sources))
}

function extractSearchQuery(normalized: string) {
  const quotedMatch = normalized.match(/"([^"]+)"/)
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim()
  }

  const tokens = normalized
    .replace(/[^a-z0-9@._ ]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !stopWords.has(token))

  if (tokens.length === 0) {
    return null
  }

  return tokens.slice(0, 6).join(' ')
}

export function isEmailSendIntent(input: string) {
  const normalized = normalizeInput(input)

  if (!gmailPattern.test(normalized) && !emailActionPattern.test(normalized)) {
    return false
  }

  if (emailActionPattern.test(normalized)) {
    return true
  }

  if (readVerbPattern.test(normalized) || todayPattern.test(normalized) || priorityPattern.test(normalized)) {
    return false
  }

  return /\b(email|mail|courriel)\b.+\b(a|to|pour)\b/.test(normalized) || /@/.test(normalized)
}

export function parseConnectedContextRequest(input: string): ConnectedContextRequest | null {
  const normalized = normalizeInput(input)
  const sources: ConnectedContextSource[] = []
  const likelyMailTypo = /\bmal\b/.test(normalized) && /\b(combien|recu|recois|recu|ai eu|dernier|derniere)\b/.test(normalized)
  const mentionsGmail = gmailPattern.test(normalized) || likelyMailTypo
  const mentionsCalendar = calendarPattern.test(normalized)
  const mentionsDrive = drivePattern.test(normalized)
  const mentionsDocs = docsPattern.test(normalized)
  const mentionsNotion = notionPattern.test(normalized)
  const asksForAvailability = availabilityPattern.test(normalized)
  const asksForPriorities = priorityPattern.test(normalized)
  const explicitRead = readVerbPattern.test(normalized) || /\?$/.test(normalized)
  const softActionVerb = /\b(faire|fais|fait|refais|refaire|recree|recreer|recr[eé]e)\b/.test(normalized)
  const explicitAction = explicitActionPattern.test(normalized) || (softActionVerb && !readVerbPattern.test(normalized))
  const referencesAllApps = allAppsPattern.test(normalized)
  const wantsMailboxListing =
    mentionsGmail &&
    (shouldReusePreviousListing(normalized) ||
      mailboxCountPattern.test(normalized))

  if (mentionsGmail) sources.push('gmail')
  if (mentionsCalendar) sources.push('calendar')
  if (mentionsDrive) sources.push('google_drive')
  if (mentionsDocs) sources.push('google_docs')
  if (mentionsNotion) sources.push('notion')

  if (referencesAllApps) {
    sources.push('gmail', 'calendar', 'google_drive', 'notion')
  }

  if (asksForAvailability) {
    sources.push('calendar')
  }

  if (asksForPriorities) {
    sources.push('gmail', 'calendar', 'notion')
  }

  if (sources.length === 0) {
    return null
  }

  const mode =
    explicitRead && !explicitAction
      ? 'read'
      : explicitRead && explicitAction
        ? 'mixed'
        : explicitAction
          ? 'action'
          : 'read'

  return {
    mode,
    sources: uniqueSources(sources),
    timeframe:
      todayPattern.test(normalized) || asksForPriorities || wantsMailboxListing
        ? 'today'
        : weekPattern.test(normalized)
          ? 'week'
          : 'recent',
    asksForAvailability,
    asksForPriorities,
    searchQuery:
      asksForAvailability || asksForPriorities || wantsMailboxListing
        ? null
        : extractSearchQuery(normalized),
  }
}

function inferFollowUpSources(normalized: string, seed: ConnectedContextSeed) {
  if ((gmailPattern.test(normalized) || /\b(non lu|unread|mail|mails|email|emails|message|messages)\b/.test(normalized)) && seed.sources.includes('gmail')) {
    return ['gmail'] satisfies ConnectedContextSource[]
  }

  if ((calendarPattern.test(normalized) || availabilityPattern.test(normalized)) && seed.sources.includes('calendar')) {
    return ['calendar'] satisfies ConnectedContextSource[]
  }

  if ((drivePattern.test(normalized) || /\b(doc|document|fichier|file)\b/.test(normalized)) && seed.sources.includes('google_drive')) {
    return ['google_drive'] satisfies ConnectedContextSource[]
  }

  if ((notionPattern.test(normalized) || /\b(page|wiki)\b/.test(normalized)) && seed.sources.includes('notion')) {
    return ['notion'] satisfies ConnectedContextSource[]
  }

  return seed.sources
}

function isConnectedContextFollowUp(normalized: string) {
  return followUpDetailPattern.test(normalized) || followUpLeadPattern.test(normalized)
}

function shouldReusePreviousListing(normalized: string) {
  return (
    followUpDetailPattern.test(normalized) ||
    /\b([0-9]+ messages?|[0-9]+ mails?|[0-9]+ emails?|non lu|unread)\b/.test(normalized)
  )
}

export function resolveConnectedContextRequest(input: string, seed?: ConnectedContextSeed | null) {
  const parsed = parseConnectedContextRequest(input)
  const normalized = normalizeInput(input)

  if (!seed || !isConnectedContextFollowUp(normalized)) {
    return parsed
  }

  if (!parsed) {
    return {
      mode: 'read',
      sources: inferFollowUpSources(normalized, seed),
      timeframe: seed.timeframe,
      asksForAvailability: seed.asksForAvailability,
      asksForPriorities: seed.asksForPriorities,
      searchQuery: null,
    } satisfies ConnectedContextRequest
  }

  if (parsed.mode !== 'read') {
    return parsed
  }

  return {
    ...parsed,
    sources: parsed.sources.length > 0 ? inferFollowUpSources(normalized, {
      sources: parsed.sources,
      timeframe: seed.timeframe,
      asksForAvailability: parsed.asksForAvailability || seed.asksForAvailability,
      asksForPriorities: parsed.asksForPriorities || seed.asksForPriorities,
    }) : seed.sources,
    timeframe: parsed.timeframe === 'recent' ? seed.timeframe : parsed.timeframe,
    asksForAvailability: parsed.asksForAvailability || seed.asksForAvailability,
    asksForPriorities: parsed.asksForPriorities || seed.asksForPriorities,
    searchQuery: shouldReusePreviousListing(normalized) ? null : parsed.searchQuery,
  } satisfies ConnectedContextRequest
}

export type WorkspaceKnowledgeIntent =
  | {
      type: 'gmail_today_summary'
    }

export function detectWorkspaceKnowledgeIntent(input: string): WorkspaceKnowledgeIntent | null {
  const parsed = parseConnectedContextRequest(input)
  if (!parsed || parsed.mode !== 'read') {
    return null
  }

  if (parsed.sources.length === 1 && parsed.sources[0] === 'gmail' && parsed.timeframe === 'today') {
    return {
      type: 'gmail_today_summary',
    }
  }

  return null
}

export function isReadOnlyWorkspaceQuestion(input: string) {
  const parsed = parseConnectedContextRequest(input)
  return parsed?.mode === 'read'
}
