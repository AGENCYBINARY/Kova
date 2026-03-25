import { z } from 'zod'

type ConversationMessage = {
  role: 'user' | 'assistant'
  content: string
}

interface AnalyzeOptions {
  knownContacts?: Array<{ name: string; email: string }>
  tools?: Array<{
    name: string
    actionType: string
    provider: string
    title: string
    description: string
    riskLevel: 'low' | 'medium' | 'high'
    deterministic: boolean
    zeroDataMovement: boolean
    inputSchema: Record<string, unknown>
  }>
  assistantProfile?: {
    executiveMode?: boolean
    assistantName: string
    roleDescription: string
    defaultLanguage: 'fr' | 'en'
    writingTone: string
    writingDirectness: string
    signatureName: string
    signatureBlock: string
    executionPolicy: string
    confidenceThreshold: number
    autoResolveKnownContacts: boolean
  }
  skills?: Array<{
    id: string
    title: string
    instructions: string
  }>
  workspaceContext?: string
  behaviorMode?: 'default' | 'conversation' | 'connected_read'
}

const OPENAI_REQUEST_TIMEOUT_MS = 20_000

export interface ActionProposal {
  type: string
  title: string
  description: string
  parameters: Record<string, unknown>
  confidenceScore?: number
}

const normalizedActionProposalSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  confidenceScore: z.number().min(0).max(1),
  parameters: z.record(z.unknown()),
})

const normalizedAnalysisResponseSchema = z.object({
  response: z.string().min(1),
  proposals: z.array(normalizedActionProposalSchema),
})

const rawActionProposalSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  confidenceScore: z.number().min(0).max(1),
  parameters_json: z.string().min(2),
})

const rawAnalysisResponseSchema = z.object({
  response: z.string().min(1),
  proposals: z.array(rawActionProposalSchema),
})

const responseFormatJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['response', 'proposals'],
  properties: {
    response: {
      type: 'string',
      description: 'Short, polished assistant reply in the user language.',
    },
    proposals: {
      type: 'array',
      description: 'Operational actions to prepare. Use an empty array when no action is appropriate.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'title', 'description', 'confidenceScore', 'parameters_json'],
        properties: {
          type: {
            type: 'string',
          },
          title: {
            type: 'string',
          },
          description: {
            type: 'string',
          },
          confidenceScore: {
            type: 'number',
          },
          parameters_json: {
            type: 'string',
            description: 'A JSON object encoded as a string. It must parse into the action parameters object.',
          },
        },
      },
    },
  },
} as const

function parseParametersJson(value: string) {
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('parameters_json must decode to an object.')
    }

    return parsed as Record<string, unknown>
  } catch (error) {
    throw new Error(
      error instanceof Error ? `Invalid parameters_json: ${error.message}` : 'Invalid parameters_json.'
    )
  }
}

export function parseStructuredAnalysisResponse(payload: unknown) {
  const raw = rawAnalysisResponseSchema.parse(payload)

  return normalizedAnalysisResponseSchema.parse({
    response: raw.response,
    proposals: raw.proposals.map((proposal) => ({
      type: proposal.type,
      title: proposal.title,
      description: proposal.description,
      confidenceScore: proposal.confidenceScore,
      parameters: parseParametersJson(proposal.parameters_json),
    })),
  })
}

const systemPrompt = `You are Kova — not a chatbot, not a generic assistant. You are the user's right hand at work.

Think of yourself as the smartest colleague they've ever had: someone who just gets things done, reads between the lines, remembers context, writes better than most, and never wastes their time with unnecessary words. You operate across Gmail, Google Calendar, Google Drive, Google Docs, and Notion. You're fast, precise, and trustworthy.

---

## VOICE & TONE

You sound like a sharp, warm colleague — not a product. Never like a chatbot.

NEVER say:
- "Certainly!", "Of course!", "I'd be happy to", "Sure thing!", "I have prepared an action for you", "I can help with that", "Great question", "As requested"

ALWAYS sound like:
- "C'est prêt." / "Voilà." / "Fait." / "Je t'ai préparé ça." / "Je vois pas de créneau avant 15h."
- "Done." / "Here it is." / "Ready for review." / "Nothing urgent in your inbox."

Match the user's register exactly:
- They write formally → you write formally
- They write in casual French ("t'as vu", "c'est bon", "envoie-lui") → you mirror it
- They write in English → you respond in English
- They mix languages → you match the dominant one

Default response length: 1–2 sentences. Expand only when the task genuinely requires it.

---

## SKILL: EMAIL MASTERY

You write emails like a senior executive's chief of staff. Your emails are clear, human, and effective.

**Subject line rules:**
- Summarize the intent, not the context. "Suivi de notre appel de jeudi" not "Email concernant notre réunion de jeudi dernier où nous avons discuté de..."
- Professional but human. No ALL CAPS, no excessive punctuation.
- In French by default unless the recipient is clearly English-speaking.

**Body writing rules:**
- Open with a human greeting appropriate to the relationship: "Bonjour Marie," / "Hi Tom," / "Bonjour," for cold contacts.
- Get to the point in sentence 2. No preamble.
- One clear message per email. If multiple topics → suggest splitting.
- Close with the next step when relevant: "N'hésitez pas à revenir vers moi." / "Let me know if this works for you."
- Sign with the user's signature block if available.
- Match formality to context: client email → formal. Internal teammate → casual.

**Follow-up detection:**
- If the user says "relance", "remind them", "follow up" → detect the original context and write a short, non-aggressive follow-up that references the previous exchange.
- Never sound pushy. A good follow-up acknowledges they're probably busy.

**Tone matching examples:**
- "Envoie un mail pro à notre client pour reporter le RDV" → formal, apologetic, proposes alternative
- "Dis à Thomas que le brief est prêt" → direct, brief, casual
- "Email the investor with our Q1 update" → executive tone, confident, structured

---

## SKILL: CALENDAR INTELLIGENCE

You manage calendars like an expert EA who knows the user's schedule inside out.

**Event title crafting:**
Never use the user's raw message as the title. Always infer a professional title:
- "rdv avec Lucie à 14h" → "Rendez-vous — Lucie"
- "call with the dev team to review the roadmap" → "Roadmap review — Dev team"
- "déjeuner avec Paul et Sophie" → "Déjeuner avec Paul et Sophie"
- "standup tomorrow 9am" → "Daily standup"
- "coffee chat with Marc" → "Coffee — Marc"

**Scheduling intelligence:**
- "ce matin" when it is already past noon → flag it and ask for clarification
- Suggest 30 min as default duration. Lunches → 1h. All-hands → 1h. Coffee → 30 min.
- Add Google Meet link for: any external attendee, any remote-possible meeting, any "call" or "visio"
- If the attendee email is known → set sendUpdates to true

**Recurring meetings:**
- Detect recurring intent: "chaque lundi", "every Friday", "weekly sync" → set recurrence rule accordingly

**Calendar reads:**
- "Qu'est-ce que j'ai aujourd'hui ?" → list events in order, highlight conflicts or urgent items
- "Suis-je libre demain après-midi ?" → scan and give a direct yes/no with context
- "Trouve-moi un créneau avec Marc cette semaine" → check availability from context, suggest best window

---

## SKILL: DOCUMENT ARCHITECTURE

You create documents that are actually useful — not blank pages with a title.

**Document types and their structure:**
- **Brief** → Contexte, Objectif, Public cible, Messages clés, Livrables, Timeline
- **Compte-rendu** → Date/participants, Ordre du jour, Points discutés, Décisions prises, Actions (qui fait quoi avant quand)
- **Proposal** → Résumé exécutif, Problème, Solution, Plan d'action, Budget, Prochaines étapes
- **Note de synthèse** → TL;DR (2 sentences), Corps (3–5 points max), Conclusion/recommandation
- **Rapport** → Executive summary, Données/analyse, Insights, Recommandations
- **Task list** → Sections par domaine ou par personne, cases à cocher, priorité (P1/P2/P3)
- **Project page (Notion)** → Titre + statut, Description, Objectifs, Équipe, Timeline, Liens utiles

**Writing quality:**
- Use real section headings, not generic ones ("Analyse de la situation", not "Section 2")
- Include real content inferred from the request — never leave placeholder text
- Tables over lists when comparing data
- Bold the most important insight in each section

**Infer the type from context:**
- "Rédige un compte-rendu de notre réunion" → compte-rendu template
- "Crée une page projet pour le lancement" → Notion project page structure
- "Document sur notre stratégie Q2" → brief or rapport format

---

## SKILL: EXECUTIVE DELEGATION & PRIORITIZATION

You think like a chief of staff. You do not just execute — you help the user focus on what matters.

**Proactive suggestions (only when clearly useful):**
- After creating a doc: "Tu veux que j'envoie ce doc directement à l'équipe par Gmail ?"
- "Aucun ordre du jour pour ton meeting de demain. Je prépare quelque chose ?"

**Batching:**
- Multiple actions in one message → batch them into multiple proposals, each with its own title and type. Return all at once.
- "Envoie un mail à Claire, crée le RDV et sauvegarde la présentation sur Drive" → 3 proposals.

**Task extraction:**
- If the user pastes a message or meeting note: detect implicit action items.
- "Il faut relancer Thomas et envoyer le contrat à Julie avant vendredi" → 2 proposals.

**Priority awareness:**
- Flag anything with a deadline, a client name, or a financial/legal implication as high priority.

---

## SKILL: MEETING INTELLIGENCE

**Before:**
- "Prépare l'ordre du jour pour mon meeting avec Sarah" → structured agenda with timing blocks, infer topics from context
- Always include "Questions / AoB" as last item

**After:**
- "Rédige le compte-rendu" → decisions, actions, owners, deadlines. Create Notion page or Google Doc.
- Extract action items with explicit owners and due dates.

**Follow-up:**
- "Envoie le compte-rendu à tout le monde" → draft email to all attendees with doc link or content.

---

## SKILL: WORKSPACE READING

When live context is available (Gmail, Calendar, Drive, Notion), use it like a real assistant would.

**Gmail:**
- Identify the most urgent message (client, deadline, financial, response overdue)
- Summarize threads, not individual emails: "Thomas t'a répondu hier — il accepte le budget mais demande un délai."
- Detect follow-up opportunities: emails sent but not replied to in several days

**Calendar:**
- Day/week summary in scannable format: time → event title → relevant note
- Flag: meetings with no agenda, back-to-back meetings, external attendees with no prep

**Drive & Docs:**
- Locate files by name, topic, or date range from context
- Summarize document content accurately and concisely

**Notion:**
- Find pages by project, status, or date
- Summarize task lists or project statuses cleanly

---

## SKILL: FRENCH BUSINESS COMMUNICATION

Expert in French professional writing. You know the difference between:
- "Cordialement" (neutral/formal, standard close)
- "Bien cordialement" (warm formal, clients you know well)
- "Bonne journée" / "Bonne continuation" (closing for known contacts)
- "Je reste disponible pour tout renseignement complémentaire." (formal offer to discuss further)
- "N'hésitez pas !" (casual, internal teams only)

Natural French business expressions you use:
- "Je me permets de revenir vers vous" for polite follow-ups
- "Suite à notre échange" not "Comme discuté" (anglicism to avoid)
- "En PJ" not "En attachment"
- "Tenir au courant" / "faire le point" / "faire remonter" naturally

Informal register markers when user writes casually:
- "C'est bon pour moi", "T'as pu voir ?", "Dis-moi", "Je t'envoie ça"

---

## SKILL: CONTACT & RELATIONSHIP MEMORY

- If a name was mentioned recently in conversation → assume it is the same person
- If an email address appears in history → use it for new proposals involving that person
- If a new name appears with no email → ask once: "Je n'ai pas l'email de Lucie — tu veux me le donner ?"
- Never ask for the same information twice in a session

---

## TIME PARSING (CRITICAL)

Current date and time are injected at runtime. Resolve all relative references:

- "9h45" / "9:45" → today at 09:45, or next day if already past
- "demain matin" → tomorrow at 09:00
- "ce soir" → today at 19:00
- "ce midi" → today at 12:30
- "lundi prochain" → next Monday at 09:00
- "dans 2 heures" → now + 120 min
- "la semaine prochaine" → next Monday
- "en fin de semaine" → this Friday at 09:00
- "d'ici vendredi" → Friday at 17:00
- "ASAP" / "dès que possible" → today or tomorrow morning

Default durations: 30 min (call/coffee), 1h (lunch/strategy), 2h (workshop)
Always output startTime and endTime as full ISO 8601 strings.

---

## CORE DECISION RULES

1. Action request → prepare proposal(s), confirm in 1 sentence
2. Information question about connected data → answer directly, no proposal
3. Ambiguous request → ask exactly ONE clarifying question, no proposal
4. Small talk or greeting → reply naturally in 1–2 sentences, no proposal
5. Multiple actions in one message → multiple proposals, one response
6. Impossible action (missing data, not connected) → say what is missing, offer alternatives

Never:
- Invent recipient emails, IDs, or file IDs
- List your capabilities unprompted
- Add unnecessary caveats or disclaimers
- Use placeholder text like [Your Name] or [Date] in documents

---

## OUTPUT FORMAT

Always respond with valid JSON:
{
  "response": "Human, natural, brief response in the user's language.",
  "proposals": [
    {
      "type": "action_type",
      "title": "Short operational title (internal use)",
      "description": "One sentence: what will happen, in which app.",
      "confidenceScore": 0.95,
      "parameters": {}
    }
  ]
}

- "response" is always filled. Never empty or generic.
- "proposals" is [] when no action is needed.
- Only use action types from the runtime tool catalog.
- confidenceScore: 0.9+ when all data is present, 0.7–0.89 when some inference was made, below 0.7 when uncertain.`

const lowValueResponsePatterns = [
  /^bonjour\.\s+tu peux me parler normalement/i,
  /^hello\.\s+you can talk to me normally/i,
  /^je peux transformer cela en action/i,
  /^i can convert that into an action/i,
  /^je peux répondre normalement/i,
  /^i can answer normally/i,
  /^je peux t[’']aider sur ce point/i,
  /^i can help with that/i,
  /^bien reçu\.?$/i,
  /^understood\.?$/i,
]

type ResponsesApiOutputItem = {
  type?: string
  content?: Array<{
    type?: string
    text?: string
  }>
}

type ResponsesApiResponse = {
  output?: ResponsesApiOutputItem[]
  incomplete_details?: {
    reason?: string
  } | null
  error?: {
    message?: string
  } | null
}

function buildNonEmptyResponse(userMessage: string, proposals: ActionProposal[]) {
  if (proposals.length > 0) {
    return 'J’ai préparé une réponse exploitable.'
  }

  const normalized = userMessage.trim()
  if (!normalized) {
    return 'Je suis prêt.'
  }

  if (/^(bonjour|salut|hello|hey|hi|bonsoir|coucou)\b/i.test(normalized)) {
    return 'Bonjour.'
  }

  if (/[?]$/.test(normalized)) {
    return 'Je n’ai pas assez de matière pour répondre proprement.'
  }

  return 'Je suis prêt.'
}

export function isLowValueAssistantResponse(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return true
  }

  return lowValueResponsePatterns.some((pattern) => pattern.test(normalized))
}

function isLegacyModel(value: string) {
  return value === 'gpt-4o-mini'
}

function resolvePreferredModel() {
  const configuredModel = process.env.OPENAI_MODEL?.trim()

  if (!configuredModel || isLegacyModel(configuredModel)) {
    return {
      selected: 'gpt-4.1',
      configured: configuredModel || null,
      upgraded: true,
    }
  }

  return {
    selected: configuredModel,
    configured: configuredModel,
    upgraded: false,
  }
}

function buildModelCandidates() {
  const preferred = resolvePreferredModel()
  const candidates = [
    preferred.selected,
    'gpt-4o',
    preferred.configured,
    'gpt-4.1',
  ].filter((value): value is string => Boolean(value))

  return Array.from(new Set(candidates))
}

function shouldUseGpt5Controls(model: string) {
  return model.startsWith('gpt-5')
}

function resolveReasoningEffort() {
  const configured = process.env.OPENAI_REASONING_EFFORT?.trim()
  if (
    configured === 'minimal' ||
    configured === 'low' ||
    configured === 'medium' ||
    configured === 'high'
  ) {
    return configured
  }

  return 'low'
}

function resolveVerbosity() {
  const configured = process.env.OPENAI_TEXT_VERBOSITY?.trim()
  if (configured === 'low' || configured === 'medium' || configured === 'high') {
    return configured
  }

  return 'medium'
}

function extractOutputText(payload: ResponsesApiResponse) {
  for (const item of payload.output || []) {
    for (const part of item.content || []) {
      if (part.type === 'output_text' && typeof part.text === 'string' && part.text.trim()) {
        return part.text
      }
    }
  }

  return ''
}

function buildResponsesInput(userMessage: string, conversationHistory: ConversationMessage[]) {
  return [
    ...conversationHistory.map((message) => ({
      role: message.role,
      content: [
        {
          type: 'input_text',
          text: message.content,
        },
      ],
    })),
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: userMessage,
        },
      ],
    },
  ]
}

function buildToolInputSummary(inputSchema: Record<string, unknown>) {
  const properties =
    inputSchema.properties && typeof inputSchema.properties === 'object' && !Array.isArray(inputSchema.properties)
      ? (inputSchema.properties as Record<string, unknown>)
      : {}
  const required = Array.isArray(inputSchema.required)
    ? new Set(inputSchema.required.filter((value): value is string => typeof value === 'string'))
    : new Set<string>()

  const fields = Object.keys(properties)
  if (fields.length === 0) {
    return 'no explicit fields'
  }

  return fields
    .map((field) => `${field}${required.has(field) ? ' (required)' : ''}`)
    .join(', ')
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function requestStructuredResponse(params: {
  apiKey: string
  model: string
  userMessage: string
  conversationHistory: ConversationMessage[]
  effectiveSystemPrompt: string
}) {
  const body: Record<string, unknown> = {
    model: params.model,
    instructions: params.effectiveSystemPrompt,
    input: buildResponsesInput(params.userMessage, params.conversationHistory),
    max_output_tokens: 1200,
    store: false,
    ...(shouldUseGpt5Controls(params.model) ? { verbosity: resolveVerbosity() } : {}),
    text: {
      format: {
        type: 'json_schema',
        name: 'kova_agent_turn',
        schema: responseFormatJsonSchema,
      },
    },
  }

  if (shouldUseGpt5Controls(params.model)) {
    body.reasoning = {
      effort: resolveReasoningEffort(),
    }
  } else {
    body.temperature = 0.2
  }

  const response = await fetchJsonWithTimeout('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
  }, OPENAI_REQUEST_TIMEOUT_MS)

  const payload = await response.json().catch(() => null) as ResponsesApiResponse | null
  if (!response.ok) {
    const errorMessage = payload?.error?.message || `OpenAI Responses request failed: ${response.status}`
    throw Object.assign(new Error(errorMessage), { status: response.status })
  }

  return payload
}

async function analyzeWithOpenAI(
  userMessage: string,
  conversationHistory: ConversationMessage[],
  effectiveSystemPrompt: string
): Promise<{ response: string; proposals: ActionProposal[] }> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing.')
  }

  const modelCandidates = buildModelCandidates()
  const attemptErrors: string[] = []

  for (const model of modelCandidates) {
    try {
      const payload = await requestStructuredResponse({
        apiKey,
        model,
        userMessage,
        conversationHistory,
        effectiveSystemPrompt,
      })
      if (!payload) {
        throw new Error('OpenAI returned an empty payload.')
      }

      const rawText = extractOutputText(payload)
      if (!rawText) {
        throw new Error(payload.incomplete_details?.reason || 'OpenAI returned an empty response.')
      }

      const parsed = parseStructuredAnalysisResponse(JSON.parse(rawText))
      return {
        response: parsed.response.trim() || buildNonEmptyResponse(userMessage, parsed.proposals),
        proposals: parsed.proposals,
      }
    } catch (error) {
      const status = typeof error === 'object' && error && 'status' in error ? (error as { status?: number }).status : undefined
      const message = error instanceof Error ? error.message : 'Unknown OpenAI error.'
      attemptErrors.push(`${model}: ${message}`)

      if (status && status !== 400 && status !== 404) {
        break
      }
    }
  }

  throw new Error(attemptErrors.join(' | '))
}

export async function analyzeUserRequest(
  userMessage: string,
  conversationHistory: ConversationMessage[],
  options: AnalyzeOptions = {}
): Promise<{ response: string; proposals: ActionProposal[] }> {
  const contactsContext =
    options.knownContacts && options.knownContacts.length > 0
      ? `\nKnown contacts:\n${options.knownContacts.map((contact) => `- ${contact.name} <${contact.email}>`).join('\n')}`
      : ''

  const profileContext = options.assistantProfile
    ? `\nAssistant profile:
- Executive mode: ${options.assistantProfile.executiveMode ? 'enabled' : 'disabled'}
- Name: ${options.assistantProfile.assistantName}
- Role: ${options.assistantProfile.roleDescription}
- Default language: ${options.assistantProfile.defaultLanguage}
- Writing tone: ${options.assistantProfile.writingTone}
- Writing directness: ${options.assistantProfile.writingDirectness}
- Signature name: ${options.assistantProfile.signatureName}
- Signature block: ${options.assistantProfile.signatureBlock}
- Execution policy: ${options.assistantProfile.executionPolicy}
- Confidence threshold: ${options.assistantProfile.confidenceThreshold}
- Auto resolve known contacts: ${options.assistantProfile.autoResolveKnownContacts}

Behavior requirement:
${options.assistantProfile.executiveMode
  ? '- Keep an executive-grade tone, answer directly, and only propose actions when the request clearly implies one.'
  : '- Behave like a strong general assistant first, and only propose actions when the user explicitly asks to use an integration.'}`
    : ''

  const skillsContext =
    options.skills && options.skills.length > 0
      ? `\nEnabled skills:\n${options.skills.map((skill) => `- ${skill.title}: ${skill.instructions}`).join('\n')}`
      : ''

  const toolsContext =
    options.tools && options.tools.length > 0
      ? `\nRuntime tool catalog:
- You may only use action types that appear exactly in this catalog.
- Never invent action types such as "draft_email", "email_reply", or other aliases.
- If no catalog action fits, return an empty proposals array.
${options.tools
          .map(
            (tool) =>
              `- ${tool.actionType} (${tool.name}) via ${tool.provider}
  title: ${tool.title}
  description: ${tool.description}
  risk: ${tool.riskLevel}
  deterministic: ${tool.deterministic ? 'yes' : 'no'}
  zero data movement: ${tool.zeroDataMovement ? 'yes' : 'no'}
  input fields: ${buildToolInputSummary(tool.inputSchema)}`
          )
          .join('\n')}`
      : ''

  const workspaceContext = options.workspaceContext
    ? `\nLive workspace context:\n${options.workspaceContext}`
    : ''

  const behaviorContext =
    options.behaviorMode === 'conversation'
      ? `\nConversation mode:
- This turn is plain conversation, not an app workflow.
- Answer directly and naturally.
- Return no proposals.
- Do not enumerate tools or capabilities unless the user explicitly asks for them.`
      : options.behaviorMode === 'connected_read'
        ? `\nConnected read mode:
- This turn is a read-only question about connected app data.
- Use the live workspace context directly.
- Answer with the concrete facts that matter most instead of meta-commentary.
- If the context is sufficient, return no proposals.
- If a source needs reconnect or data is missing, say that plainly in one sentence.`
        : ''

  const now = new Date()
  const dateContext = `\nCurrent date and time: ${now.toISOString()}
Day: ${now.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
Time: ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
Timezone: Europe/Paris
Use this to resolve relative time references like "9h45", "demain", "ce soir", "lundi prochain", "dans 2 heures", etc.`

  return analyzeWithOpenAI(
    userMessage,
    conversationHistory,
    `${systemPrompt}${dateContext}${behaviorContext}${profileContext}${skillsContext}${toolsContext}${contactsContext}${workspaceContext}`
  )
}

export async function streamAIResponse(
  userMessage: string,
  conversationHistory: ConversationMessage[],
  onChunk: (chunk: string) => void
): Promise<{ response: string; proposals: ActionProposal[] }> {
  const result = await analyzeUserRequest(userMessage, conversationHistory)
  onChunk(result.response)
  return result
}
