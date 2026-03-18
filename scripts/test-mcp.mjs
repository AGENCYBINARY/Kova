#!/usr/bin/env node

const [, , method = 'tools/list', ...args] = process.argv

const baseUrl = process.env.KOVA_BASE_URL || 'http://localhost:3000'
const endpointPath = process.env.KOVA_MCP_PATH || '/api/mcp'
const cookie = process.env.KOVA_COOKIE || ''
const standaloneSecret = process.env.KOVA_STANDALONE_SHARED_SECRET || ''
const standaloneWorkspaceId = process.env.KOVA_STANDALONE_WORKSPACE_ID || ''
const standaloneUserId = process.env.KOVA_STANDALONE_USER_ID || ''

function parseArgs(argv) {
  const result = {}

  for (const entry of argv) {
    const [key, ...rest] = entry.split('=')
    if (!key || rest.length === 0) continue
    const value = rest.join('=')
    result[key.replace(/^--/, '')] = value
  }

  return result
}

function buildPayload(currentMethod, options) {
  if (currentMethod === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    }
  }

  if (currentMethod === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }
  }

  if (currentMethod === 'manifest/get' || currentMethod === 'capabilities/get') {
    return {
      jsonrpc: '2.0',
      id: 4,
      method: currentMethod,
      params: {},
    }
  }

  if (currentMethod === 'tools/call') {
    const toolName = options.tool || options.name
    if (!toolName) {
      throw new Error('Missing tool name. Use --tool=gmail.send_email')
    }

    const rawArguments = options.args ? JSON.parse(options.args) : {}
    const requireApproval = options.requireApproval === 'true'

    return {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: rawArguments,
        ...(requireApproval ? { requireApproval: true } : {}),
      },
    }
  }

  throw new Error(
    `Unsupported MCP method "${currentMethod}". Use initialize, manifest/get, capabilities/get, tools/list, or tools/call.`
  )
}

async function main() {
  const options = parseArgs(args)
  const payload = buildPayload(method, options)

  const response = await fetch(`${baseUrl}${endpointPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(standaloneSecret ? { Authorization: `Bearer ${standaloneSecret}` } : {}),
      ...(standaloneWorkspaceId ? { 'x-kova-workspace-id': standaloneWorkspaceId } : {}),
      ...(standaloneUserId ? { 'x-kova-user-id': standaloneUserId } : {}),
    },
    body: JSON.stringify(payload, null, 2),
  })

  const text = await response.text()
  console.log(text)

  if (!response.ok) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
