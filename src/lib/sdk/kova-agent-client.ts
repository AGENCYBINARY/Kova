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

export interface McpRequestInput {
  jsonrpc?: '2.0'
  id?: string | number
  method: 'initialize' | 'tools/list' | 'tools/call'
  params?: Record<string, unknown>
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

  async initializeMcp(id: string | number = 'init') {
    return this.mcpRequest({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
    })
  }

  async listMcpTools(id: string | number = 'tools') {
    return this.mcpRequest({
      jsonrpc: '2.0',
      id,
      method: 'tools/list',
    })
  }

  async callMcpTool(params: {
    name: string
    arguments?: Record<string, unknown>
    requireApproval?: boolean
    id?: string | number
  }) {
    return this.mcpRequest({
      jsonrpc: '2.0',
      id: params.id || 'call',
      method: 'tools/call',
      params: {
        name: params.name,
        arguments: params.arguments || {},
        ...(typeof params.requireApproval === 'boolean' ? { requireApproval: params.requireApproval } : {}),
      },
    })
  }

  async mcpRequest(input: McpRequestInput) {
    return this.request('/api/mcp', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: input.jsonrpc || '2.0',
        id: input.id ?? null,
        method: input.method,
        params: input.params || {},
      }),
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
