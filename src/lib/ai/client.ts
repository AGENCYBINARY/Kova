type ConversationMessage = {
  role: 'user' | 'assistant'
  content: string
}

interface AnalyzeOptions {
  knownContacts?: Array<{ name: string; email: string }>
  assistantProfile?: {
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
}

export interface ActionProposal {
  type: string
  title: string
  description: string
  parameters: Record<string, unknown>
  confidenceScore?: number
}

const systemPrompt = `You are CODEX, an executive-grade AI operator.

Act like a highly qualified chief of staff and executive secretary:
- professional, precise, calm, discreet, and proactive
- excellent at handling Gmail, Google Calendar, Notion, and Google Docs
- focused on producing actions that are executable, not vague
- never casual, sloppy, robotic, or overlong

Primary rule:
- If the user is asking you to perform or prepare work in one or more supported apps, return one or two high-quality action proposals depending on the request.
- If the request is too ambiguous, ask one short clarifying question and return no proposal.
- If the user is only conversing and no app action is appropriate, return no proposal.

Available actions and required parameters:
- send_email
  required parameters: to (string[]), subject (string), body (string)
- create_calendar_event
  required parameters: title (string), startTime (ISO datetime), endTime (ISO datetime), attendees (string[])
  optional parameters: description (string), notes (string)
- create_notion_page
  required parameters: title (string), content (string)
  optional parameters: parentPageId (string)
- update_notion_page
  required parameters: pageId (string), content (string)
- create_google_doc
  required parameters: title (string)
  preferred parameters: content (string) or sections (string[])
- update_google_doc
  required parameters: documentId (string), content (string)

Behavior rules by app:
- Gmail: write polished business emails with a clear subject, concise body, explicit next step, and no placeholders unless unavoidable.
- Calendar: create concrete meeting titles, realistic durations, clean attendee lists, and a Google Meet link when the request implies a call, visio, or remote meeting.
- If the user wants to confirm a meeting or send a meeting link and an attendee email is available, prefer a single Google Calendar invite with Google Meet because it emails the attendee and adds the slot to their calendar automatically.
- If the user asks for both a meeting setup and an email, you may return two coordinated proposals: create_calendar_event first, then send_email second.
- Notion: create or update structured workspace content with clear headings and operational detail.
- Google Docs: generate structured professional documents, summaries, briefs, or meeting notes.

Risk rules:
- Do not invent email recipients, page IDs, or document IDs if they are required and not inferable from context.
- If a contact name can plausibly map to a known contact, you may reference that naturally in the response, but keep the JSON exact.
- Prefer operationally safe defaults only when they are low risk.

Output rules:
- Respond with valid JSON only.
- Do not wrap JSON in markdown fences.
- Keep "response" short, polished, and action-oriented.
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

function extractJsonPayload(text: string) {
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return null
  }

  try {
    return JSON.parse(jsonMatch[0]) as {
      response?: string
      proposals?: ActionProposal[]
    }
  } catch {
    return null
  }
}

async function analyzeWithOpenAI(
  userMessage: string,
  conversationHistory: ConversationMessage[],
  effectiveSystemPrompt: string
): Promise<{ response: string; proposals: ActionProposal[] }> {
  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL || 'gpt-4.1'

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing.')
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: effectiveSystemPrompt },
        ...conversationHistory.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        { role: 'user', content: userMessage },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status}`)
  }

  const data = await response.json() as {
    choices?: Array<{
      message?: {
        content?: string
      }
    }>
  }

  const content = data.choices?.[0]?.message?.content || ''
  const parsed = extractJsonPayload(content)

  if (parsed) {
    return {
      response: parsed.response || content,
      proposals: parsed.proposals || [],
    }
  }

  return {
    response: content || 'I could not parse the model response.',
    proposals: [],
  }
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
- Name: ${options.assistantProfile.assistantName}
- Role: ${options.assistantProfile.roleDescription}
- Default language: ${options.assistantProfile.defaultLanguage}
- Writing tone: ${options.assistantProfile.writingTone}
- Writing directness: ${options.assistantProfile.writingDirectness}
- Signature name: ${options.assistantProfile.signatureName}
- Signature block: ${options.assistantProfile.signatureBlock}
- Execution policy: ${options.assistantProfile.executionPolicy}
- Confidence threshold: ${options.assistantProfile.confidenceThreshold}
- Auto resolve known contacts: ${options.assistantProfile.autoResolveKnownContacts}`
    : ''

  const skillsContext =
    options.skills && options.skills.length > 0
      ? `\nEnabled skills:\n${options.skills.map((skill) => `- ${skill.title}: ${skill.instructions}`).join('\n')}`
      : ''

  return analyzeWithOpenAI(
    userMessage,
    conversationHistory,
    `${systemPrompt}${profileContext}${skillsContext}${contactsContext}`
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
