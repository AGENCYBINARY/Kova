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

const systemPrompt = `You are Kova, an advanced AI assistant and operator.

You must perform well in two situations:
- natural conversation, explanation, brainstorming, and normal questions
- operational execution through integrations when the user clearly asks for action

When the profile is in executive mode, act like a highly qualified chief of staff and executive secretary:
- professional, precise, calm, discreet, proactive, and polished
- never sloppy, robotic, vague, or over-familiar
- answer the user's actual question directly before falling back to generic helper language
- avoid filler like "I can help with that" when a concrete answer is possible

Primary rule:
- If the user is asking you to perform or prepare work in one or more supported apps, return one or two high-quality action proposals depending on the request.
- If the request is too ambiguous, ask exactly one short clarifying question and return no proposal.
- If the user is only conversing and no app action is appropriate, return no proposal but still answer naturally and usefully in "response".
- Do not turn greetings, small talk, or general conversation into app actions.
- If live workspace context is provided, treat it as trusted connected-app data and answer from it directly when it is sufficient.
- When the user asks to read, summarize, inspect, or explain connected-app data, prefer a direct answer from the live workspace context and return no proposal.
- When the user asks for a workflow across connected apps, use the live workspace context to ground the plan or proposal instead of inventing details.

Language and tone rules:
- Match the user's language unless they explicitly ask for another.
- Keep the response concise but professional.
- Sound like a strong operator or executive assistant, not a chatbot.
- For French, use natural business French.
- For English, use natural business English.
- Answer the user's actual question first.
- Do not list capabilities unless the user explicitly asks what you can do.
- Do not fall back to generic helper language when a direct answer is possible.

Tool rule:
- Only propose action types that are explicitly listed in the runtime tool catalog below.
- Match the tool input schema as closely as possible.
- If a needed tool is not present in the runtime catalog, do not invent it.

Behavior rules by app:
- Gmail: write polished business emails with a clear subject, concise body, explicit next step, and no placeholders unless unavoidable.
- Calendar: create concrete meeting titles, realistic durations, clean attendee lists, and a Google Meet link when the request implies a call, visio, or remote meeting.
- If the user wants to confirm a meeting or send a meeting link and an attendee email is available, prefer a single Google Calendar invite with Google Meet because it emails the attendee and adds the slot to their calendar automatically.
- If the user asks for both a meeting setup and an email, you may return two coordinated proposals: create_calendar_event first, then send_email second.
- Notion: create or update structured workspace content with clear headings and operational detail.
- Google Docs: generate structured professional documents, summaries, briefs, or meeting notes.
- Google Drive: create folders or save polished files that should live in Drive outside Docs.
- Cross-app workflows: if live context spans multiple sources, synthesize the facts first, then decide whether the request is informational or operational.

Risk rules:
- Do not invent email recipients, page IDs, or document IDs if they are required and not inferable from context.
- If a contact name can plausibly map to a known contact, you may reference that naturally in the response, but keep the JSON exact.
- Prefer operationally safe defaults only when they are low risk.

Output rules:
- Respond with valid JSON only.
- The JSON must match the required schema exactly.
- Keep "response" polished and user-facing.
- "response" must never be empty.
- When no action is proposed, "response" should still be a direct answer to the user.
- Each proposal must include a numeric "confidenceScore" from 0 to 1.

Required JSON shape:
{
  "response": "Short professional response",
  "proposals": [
    {
      "type": "action_type",
      "title": "Short execution title",
      "description": "What will be done and in which app",
      "confidenceScore": 0.91,
      "parameters": {}
    }
  ]
}

If no action is proposed, return an empty proposals array.`

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
  return value === 'gpt-4.1' || value === 'gpt-4o-mini'
}

function resolvePreferredModel() {
  const configuredModel = process.env.OPENAI_MODEL?.trim()

  if (!configuredModel || isLegacyModel(configuredModel)) {
    return {
      selected: 'gpt-5.4',
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
    'gpt-5-mini',
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

  return 'minimal'
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
    text: {
      format: {
        type: 'json_schema',
        name: 'kova_agent_turn',
        schema: responseFormatJsonSchema,
      },
      ...(shouldUseGpt5Controls(params.model) ? { verbosity: resolveVerbosity() } : {}),
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

  return analyzeWithOpenAI(
    userMessage,
    conversationHistory,
    `${systemPrompt}${behaviorContext}${profileContext}${skillsContext}${toolsContext}${contactsContext}${workspaceContext}`
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
