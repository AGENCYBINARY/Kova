import { z } from 'zod'

function resolveOpenAiApiKey(): string | undefined {
  const primary = process.env.OPENAI_API_KEY?.trim()
  const alias = process.env.OPENAI_KEY?.trim()
  return primary || alias || undefined
}

type ResponsesApiUsage = {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
}

type ResponsesApiOutputItem = {
  type?: string
  content?: Array<{
    type?: string
    text?: string
  }>
}

type ResponsesApiResponse = {
  output?: ResponsesApiOutputItem[]
  usage?: ResponsesApiUsage
  incomplete_details?: {
    reason?: string
  } | null
  error?: {
    message?: string
  } | null
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

export type PostExecutionOutcomeFact = {
  title: string
  type: string
  details: string
}

const auxiliaryMessageJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['message'],
  properties: {
    message: {
      type: 'string',
      description: 'Single chat message for the user, in the requested language only.',
    },
  },
} as const

const auxiliaryMessageZ = z.object({
  message: z.string().min(1),
})

function resolveAuxiliaryModel() {
  const raw = process.env.KOVA_AUXILIARY_MODEL?.trim()
  return raw || 'gpt-4o-mini'
}

function resolveAuxiliaryMaxOutputTokens() {
  const raw = process.env.KOVA_AUXILIARY_MAX_OUTPUT_TOKENS?.trim()
  if (raw) {
    const n = Number.parseInt(raw, 10)
    if (Number.isFinite(n) && n >= 128 && n <= 4096) {
      return n
    }
  }
  return 768
}

const AUXILIARY_TIMEOUT_MS = Number(process.env.KOVA_AUXILIARY_TIMEOUT_MS) || 25_000

function resolveAuxiliaryTemperature(model: string) {
  if (shouldUseGpt5Controls(model)) {
    return undefined
  }
  const raw = process.env.KOVA_AUXILIARY_TEMPERATURE?.trim()
  if (raw) {
    const t = Number.parseFloat(raw)
    if (Number.isFinite(t) && t >= 0 && t <= 1.5) {
      return t
    }
  }
  return 0.45
}

async function requestAuxiliaryMessage(params: { instructions: string; payload: string }): Promise<string> {
  const apiKey = resolveOpenAiApiKey()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY (or OPENAI_KEY) is missing.')
  }

  const model = resolveAuxiliaryModel()
  const maxOut = resolveAuxiliaryMaxOutputTokens()
  const body: Record<string, unknown> = {
    model,
    instructions: params.instructions,
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: params.payload }],
      },
    ],
    max_output_tokens: maxOut,
    store: false,
    text: {
      format: {
        type: 'json_schema',
        name: 'kova_auxiliary_message',
        schema: auxiliaryMessageJsonSchema,
      },
    },
  }

  if (shouldUseGpt5Controls(model)) {
    body.reasoning = { effort: resolveReasoningEffort() }
    body.verbosity = resolveVerbosity()
  } else {
    const t = resolveAuxiliaryTemperature(model)
    if (typeof t === 'number') {
      body.temperature = t
    }
  }

  const response = await fetchJsonWithTimeout(
    'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    AUXILIARY_TIMEOUT_MS
  )

  const payload = (await response.json().catch(() => null)) as ResponsesApiResponse | null
  if (!response.ok) {
    const errorMessage = payload?.error?.message || `OpenAI Responses request failed: ${response.status}`
    throw Object.assign(new Error(errorMessage), { status: response.status })
  }

  const rawText = extractOutputText(payload ?? {})
  if (!rawText) {
    throw new Error(payload?.incomplete_details?.reason || 'OpenAI returned an empty auxiliary response.')
  }

  const parsed = auxiliaryMessageZ.parse(JSON.parse(rawText))
  return parsed.message.trim()
}

const postExecutionSystem = `You are Kova — the same executive assistant the user was already talking to, not a separate “status bot”. You write follow-up chat messages after **your** connected-app actions ran (or partially ran) on their behalf.

Rules:
- Output is ONLY the JSON object required by the schema; the "message" field is what the user sees.
- Match the requested language exactly (French or English).
- Sound human: brief reasoning, what succeeded, what failed, what still needs their OK, anything worth double-checking. Not syslog, not corporate boilerplate.
- Do not invent facts beyond the facts given; you may interpret and prioritize.
- 2–8 sentences usually; more if several actions or a messy partial failure.
- Do not repeat long prior assistant text verbatim; you may refer to it lightly ("comme prévu", "as discussed").`

const deterministicEnrichmentSystem = `You are Kova — the same executive assistant, speaking with one voice. A fast parser prepared exact tool proposals from the user's message; you are **not** a different product layer. Your job is ONLY to rewrite the assistant reply ("message" in JSON) so it reads like **you** thought it through: intent, approach, and what happens when they approve — still one brain, one persona.

Rules:
- Output only the schema JSON; the user sees "message".
- Match the requested language exactly.
- Do NOT invent actions, recipients, times, IDs, or parameters. The proposals list is authoritative.
- Expand the draft reply: restate intent, approach, assumptions, and what each proposal does once approved — natural wording, varied structure, not the same template every time.
- If workspace context is provided, use it only to justify phrasing; do not claim you executed anything.
- 3–10 sentences when there are proposals; stay shorter only if the draft is already complete and the task is trivial.`

function languageLine(lang: 'fr' | 'en') {
  return lang === 'en'
    ? 'Write the message in English only.'
    : 'Rédige le message en français uniquement.'
}

/**
 * Natural-language follow-up after tool execution (auto-run, approval, or batch).
 */
export async function synthesizePostExecutionOutcome(params: {
  defaultLanguage: 'fr' | 'en'
  userRequest: string | null
  assistantPlanBeforeExecution: string | null
  completed: PostExecutionOutcomeFact[]
  /** Single batch stopped mid-way (e.g. auto-run). */
  failure?: {
    title: string
    error: string
    blockedCount: number
    priorCompletedCount: number
  }
  /** Multiple failure chunks (e.g. bulk approval by group). */
  batchFailures?: Array<{ title: string; error: string; blockedCount: number }>
  /** Extra high-level context for the model (e.g. bulk approval stats). */
  scenarioNotes?: string | null
}): Promise<string> {
  const lang = params.defaultLanguage === 'en' ? 'en' : 'fr'
  const completedBlock =
    params.completed.length === 0
      ? '(none)'
      : params.completed
          .map(
            (c, i) =>
              `${i + 1}. [${c.type}] ${c.title}\n   Outcome summary: ${c.details}`
          )
          .join('\n')

  let failureBlock = ''
  if (params.failure) {
    failureBlock = `
Single-batch failure:
- Failed action: ${params.failure.title}
- Error: ${params.failure.error}
- Actions still waiting for review: ${params.failure.blockedCount}
- Actions that had already completed in this batch before the failure: ${params.failure.priorCompletedCount}`
  }

  if (params.batchFailures && params.batchFailures.length > 0) {
    failureBlock += `\n\nMultiple failure groups:\n${params.batchFailures
      .map(
        (f, i) =>
          `${i + 1}. Failed on "${f.title}": ${f.error} (${f.blockedCount} action(s) still pending in that group)`
      )
      .join('\n')}`
  }

  const payload = `${languageLine(lang)}

User message (may be empty):
${params.userRequest?.trim() || '(not available)'}

Assistant message before execution (may be empty):
${params.assistantPlanBeforeExecution?.trim() || '(not available)'}

Successfully completed actions:
${completedBlock}
${failureBlock}

${params.scenarioNotes?.trim() ? `Scenario notes:\n${params.scenarioNotes.trim()}\n` : ''}
Write one follow-up message for the chat thread.`

  return requestAuxiliaryMessage({
    instructions: postExecutionSystem,
    payload,
  })
}

/**
 * Enrich terse deterministic agent replies using the same "thinking EA" bar as the main model.
 */
export async function synthesizeDeterministicAssistantNarration(params: {
  defaultLanguage: 'fr' | 'en'
  userMessage: string
  draftResponse: string
  proposals: Array<{ type: string; title: string; description: string }>
  workspaceContext?: string
}): Promise<string> {
  const lang = params.defaultLanguage === 'en' ? 'en' : 'fr'
  const proposalsBlock = params.proposals
    .map(
      (p, i) =>
        `${i + 1}. type=${p.type}\n   title: ${p.title}\n   description: ${p.description}`
    )
    .join('\n')

  const payload = `${languageLine(lang)}

User message:
${params.userMessage.trim()}

Draft assistant reply (must remain factually consistent; expand and humanize):
${params.draftResponse.trim()}

Concrete proposals (authoritative — do not contradict):
${proposalsBlock}

${params.workspaceContext?.trim() ? `Workspace context (for nuance only):\n${params.workspaceContext.trim().slice(0, 8000)}\n` : ''}
Rewrite into a single assistant message as described in the system instructions.`

  return requestAuxiliaryMessage({
    instructions: deterministicEnrichmentSystem,
    payload,
  })
}
