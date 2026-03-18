import { z } from 'zod'

export const mcpRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
})

export type McpRequest = z.infer<typeof mcpRequestSchema>

export function buildMcpSuccess(id: string | number | null | undefined, result: unknown) {
  return {
    jsonrpc: '2.0' as const,
    id: id ?? null,
    result,
  }
}

export function buildMcpError(
  id: string | number | null | undefined,
  code: number,
  message: string
) {
  return {
    jsonrpc: '2.0' as const,
    id: id ?? null,
    error: {
      code,
      message,
    },
  }
}
