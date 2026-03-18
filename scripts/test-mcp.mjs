#!/usr/bin/env node

const [, , method = 'tools/list', ...args] = process.argv

const baseUrl = process.env.KOVA_BASE_URL || 'http://localhost:3000'
const cookie = process.env.KOVA_COOKIE || ''

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

  throw new Error(`Unsupported MCP method "${currentMethod}". Use initialize, tools/list, or tools/call.`)
}

async function main() {
  const options = parseArgs(args)
  const payload = buildPayload(method, options)

  const response = await fetch(`${baseUrl}/api/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
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
