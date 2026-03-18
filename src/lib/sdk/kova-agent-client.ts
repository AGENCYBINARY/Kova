export interface KovaAgentClientOptions {
  baseUrl?: string
  headers?: Record<string, string>
}

export interface ExecuteAgentActionInput {
  actionType:
    | 'send_email'
    | 'create_calendar_event'
    | 'create_google_doc'
    | 'update_google_doc'
    | 'create_google_drive_file'
    | 'create_notion_page'
    | 'update_notion_page'
  parameters: Record<string, unknown>
  requireApproval?: boolean
}

export class KovaAgentClient {
  private readonly baseUrl: string
  private readonly headers: Record<string, string>

  constructor(options: KovaAgentClientOptions = {}) {
    this.baseUrl = (options.baseUrl || '').replace(/\/$/, '')
    this.headers = options.headers || {}
  }

  async getManifest() {
    return this.request('/api/agent/manifest', {
      method: 'GET',
    })
  }

  async listTools() {
    return this.request('/api/agent/execute', {
      method: 'GET',
    })
  }

  async execute(input: ExecuteAgentActionInput) {
    return this.request('/api/agent/execute', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  private async request(path: string, init: RequestInit) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
        ...(init.headers || {}),
      },
    })

    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(payload?.error || `Kova Agent request failed with status ${response.status}.`)
    }

    return payload
  }
}
