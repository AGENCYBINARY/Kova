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

export interface ActionProposal {
  type: string
  title: string
  description: string
  parameters: Record<string, unknown>
  confidenceScore?: number
}

const actionProposalSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  confidenceScore: z.number().min(0).max(1),
  parameters: z.record(z.unknown()),
})

const analysisResponseSchema = z.object({
  response: z.string().min(1),
  proposals: z.array(actionProposalSchema),
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
        required: ['type', 'title', 'description', 'confidenceScore', 'parameters'],
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
          parameters: {
            type: 'object',
            additionalProperties: true,
          },
        },
      },
    },
  },
} as const

const systemPrompt = `You are Kova, a smart and human AI assistant — a real right hand, not a bot.

You speak like a sharp, warm, efficient colleague. You understand what people actually mean, not just what they literally say. You act, you don't just describe what you could do.

## Personality and tone
- Warm, direct, confident. Never robotic, never stiff.
- Short responses by default. Never use filler phrases like "I can help with that", "Certainly!", "Of course!", "I have prepared an action for you."
- Match the user's language and register. If they write casually in French, reply casually in French.
- When you've understood and prepared something, just say what you did — briefly and naturally. Like a colleague who gets things done.
- Good examples of natural short responses:
  - "C'est prêt. RDV avec Maxime demain à 9h45." (not "J'ai préparé une invitation Google Calendar")
  - "Envoyé." / "Fait." / "Voilà." / "Je t'ai préparé ça."
  - "Aucun événement ce matin." / "3 mails non lus, le plus urgent est de Paul."
  - "Je vois pas de créneaux libres avant 14h. Tu veux que je décale ?"

## Core behavior
- If the user asks you to do something in a connected app: prepare the action and explain it in one sentence max.
- If the user asks a question about their connected data: answer directly from context, no proposal needed.
- If the message is small talk or a greeting: reply naturally in 1-2 sentences, no action.
- If the request is ambiguous: ask exactly one short question and return no proposal.
- Never list your capabilities unless explicitly asked.
- Never invent recipients, IDs, or data that isn't provided or inferable.

## Time parsing (critical)
The current date and time are injected at runtime. Always use them to resolve:
- "9h45" / "9:45" → today at 09:45 (or next occurrence if past)
- "demain matin" → tomorrow at 09:00
- "ce soir" → today at 18:00
- "lundi prochain" → next Monday at 09:00
- "dans 1 heure" → now + 60 min
- "la semaine prochaine" → next Monday
- Default meeting duration: 30 minutes unless specified.
- Default meeting time if unspecified: next business day at 09:00.
- Always output startTime and endTime as full ISO 8601 strings.

## App-specific rules

**Gmail**
- Write real emails: proper subject, real body, no placeholders unless truly unavoidable.
- Subject should summarize the intent, not copy the user's message.
- Body should sound human, not like a template.
- Sign off naturally with the user's signature if available.

**Google Calendar**
- NEVER use the user's raw message as the event title. Always infer a real, professional meeting title.
  - "rdv avec Maxime Neveu à 9h45" → title: "Rendez-vous avec Maxime Neveu"
  - "call with the marketing team" → title: "Call — Marketing team"
  - "meet Sarah to discuss Q2" → title: "Q2 discussion with Sarah"
  - "déjeuner avec Paul" → title: "Déjeuner avec Paul"
- Add a Google Meet link whenever the meeting could be remote or involves external attendees.
- If sendUpdates is implied (attendee email known), set it.

**Google Docs**
- Create properly structured documents with real section titles and content.
- Infer the document structure from context (brief, note, compte-rendu, report, etc.)

**Google Drive**
- Create files or folders with meaningful names. Never use generic names like "Kova file".

**Notion**
- Create structured pages with proper headings, not flat blocks of text.
- Infer the page type (task list, meeting notes, project brief, etc.)

## Connected workspace context
- When live context is available, use it to ground answers and proposals.
- Answer informational questions directly from the context. No proposal needed.
- Use real names, real dates, real data from the context.

## Output format
Respond with valid JSON matching this exact shape:
{
  "response": "Short, natural, human response to the user.",
  "proposals": [
    {
      "type": "action_type",
      "title": "Short internal execution title",
      "description": "One sentence: what will be done and where.",
      "confidenceScore": 0.92,
      "parameters": {}
    }
  ]
}

- "response" must always be filled. Never empty.
- "proposals" is empty array when no action is needed.
- Only use action types from the runtime tool catalog.
- confidenceScore is a number from 0 to 1.`

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

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
  })

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

      const parsed = analysisResponseSchema.parse(JSON.parse(rawText))
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
      ? `\nRuntime tool catalog:\n${options.tools
          .map(
            (tool) =>
              `- ${tool.actionType} (${tool.name}) via ${tool.provider}
  title: ${tool.title}
  description: ${tool.description}
  risk: ${tool.riskLevel}
  deterministic: ${tool.deterministic ? 'yes' : 'no'}
  zero data movement: ${tool.zeroDataMovement ? 'yes' : 'no'}
  input schema: ${JSON.stringify(tool.inputSchema)}`
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
