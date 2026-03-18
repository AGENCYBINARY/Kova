import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { buildAgentManifest } from '@/lib/agent/manifest'
import { getWorkspaceGovernance } from '@/lib/agent/governance'
import { handleMcpRequest } from '@/lib/mcp/service'
import { resolveStandaloneMcpContext } from '@/lib/mcp/standalone-auth'

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(payload, null, 2))
}

function readJsonBody(request: IncomingMessage) {
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

export function createStandaloneMcpServer() {
  return createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname

      if (request.method === 'GET' && pathname === '/health') {
        sendJson(response, 200, {
          ok: true,
          service: 'kova-mcp-standalone',
        })
        return
      }

      const context = resolveStandaloneMcpContext(request.headers)

      if (request.method === 'GET' && pathname === '/manifest') {
        const governance = await getWorkspaceGovernance({
          workspaceId: context.workspaceId,
          userId: context.userId,
        })

        sendJson(response, 200, {
          manifest: buildAgentManifest(governance.allowedActionTypes),
          workspaceRole: governance.role,
        })
        return
      }

      if (request.method === 'POST' && (pathname === '/' || pathname === '/mcp')) {
        const payload = await readJsonBody(request)
        const rpcResponse = await handleMcpRequest({
          payload: payload as Record<string, unknown>,
          context,
        })

        sendJson(response, 200, rpcResponse)
        return
      }

      sendJson(response, 404, {
        error: 'Not found.',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown standalone MCP error.'
      const status = message === 'Unauthorized' ? 401 : 400
      sendJson(response, status, {
        error: message,
      })
    }
  })
}

export function startStandaloneMcpServer() {
  const port = Number(process.env.KOVA_MCP_STANDALONE_PORT || '8787')
  const host = process.env.KOVA_MCP_STANDALONE_HOST || '127.0.0.1'
  const server = createStandaloneMcpServer()

  server.listen(port, host, () => {
    console.log(`Kova MCP standalone listening on http://${host}:${port}`)
  })

  return server
}

function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false

  return fileURLToPath(import.meta.url) === entrypoint
}

if (isDirectExecution()) {
  startStandaloneMcpServer()
}
