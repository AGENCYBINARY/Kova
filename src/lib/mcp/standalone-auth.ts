export interface StandaloneMcpContext {
  workspaceId: string
  userId: string
}

export interface HeaderLike {
  get(name: string): string | null
}

function readHeader(headers: HeaderLike | Record<string, string | string[] | undefined>, name: string) {
  if (typeof (headers as HeaderLike).get === 'function') {
    return (headers as HeaderLike).get(name)
  }

  const value = (headers as Record<string, string | string[] | undefined>)[name.toLowerCase()]
  if (Array.isArray(value)) {
    return value[0] || null
  }

  return value || null
}

function normalizeBearerToken(value: string | null) {
  if (!value) return null
  const match = value.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

export function resolveStandaloneMcpContext(headers: HeaderLike | Record<string, string | string[] | undefined>) {
  const expectedSecret = process.env.KOVA_STANDALONE_SHARED_SECRET?.trim() || null
  const providedSecret =
    normalizeBearerToken(readHeader(headers, 'authorization')) ||
    readHeader(headers, 'x-kova-shared-secret')

  if (expectedSecret && providedSecret !== expectedSecret) {
    throw new Error('Unauthorized')
  }

  const workspaceId =
    readHeader(headers, 'x-kova-workspace-id') ||
    process.env.KOVA_STANDALONE_WORKSPACE_ID?.trim() ||
    null
  const userId =
    readHeader(headers, 'x-kova-user-id') ||
    process.env.KOVA_STANDALONE_USER_ID?.trim() ||
    null

  if (!workspaceId || !userId) {
    throw new Error('Standalone MCP context is incomplete.')
  }

  return {
    workspaceId,
    userId,
  } satisfies StandaloneMcpContext
}
