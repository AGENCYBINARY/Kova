export interface KovaAgentClientOptions {
  baseUrl?: string
  headers?: Record<string, string>
  agentManifestPath?: string
  agentExecutePath?: string
  mcpPath?: string
  standaloneManifestPath?: string
  standaloneHealthPath?: string
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
  method: 'initialize' | 'manifest/get' | 'capabilities/get' | 'tools/list' | 'tools/call'
  params?: Record<string, unknown>
}

export class KovaAgentClient {
  private readonly baseUrl: string
  private readonly headers: Record<string, string>
  private readonly agentManifestPath: string
  private readonly agentExecutePath: string
  private readonly mcpPath: string
  private readonly standaloneManifestPath: string
  private readonly standaloneHealthPath: string

  constructor(options: KovaAgentClientOptions = {}) {
    this.baseUrl = (options.baseUrl || '').replace(/\/$/, '')
    this.headers = options.headers || {}
    this.agentManifestPath = options.agentManifestPath || '/api/agent/manifest'
    this.agentExecutePath = options.agentExecutePath || '/api/agent/execute'
    this.mcpPath = options.mcpPath || '/api/mcp'
    this.standaloneManifestPath = options.standaloneManifestPath || '/manifest'
    this.standaloneHealthPath = options.standaloneHealthPath || '/health'
  }

  async getManifest() {
    return this.request(this.agentManifestPath, {
      method: 'GET',
    })
  }

  async listTools() {
    return this.request(this.agentExecutePath, {
      method: 'GET',
    })
  }

  async execute(input: ExecuteAgentActionInput) {
    return this.request(this.agentExecutePath, {
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

  async getMcpManifest(id: string | number = 'manifest') {
    return this.mcpRequest({
      jsonrpc: '2.0',
      id,
      method: 'manifest/get',
    })
  }

  async getMcpCapabilities(id: string | number = 'capabilities') {
    return this.mcpRequest({
      jsonrpc: '2.0',
      id,
      method: 'capabilities/get',
    })
  }

  async getStandaloneManifest() {
    return this.request(this.standaloneManifestPath, {
      method: 'GET',
    })
  }

  async getStandaloneHealth() {
    return this.request(this.standaloneHealthPath, {
      method: 'GET',
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
    return this.request(this.mcpPath, {
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
