import { Prisma } from '@prisma/client'

function toRecord(value: Prisma.JsonValue | Record<string, unknown>) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function toSnakeCase(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
}

function buildTokenMap(outputs: Array<Record<string, unknown>>) {
  return outputs.reduce<Record<string, string>>((acc, output) => {
    for (const [key, value] of Object.entries(output)) {
      if (typeof value !== 'string') {
        continue
      }

      acc[`{{${key}}}`] = value
      acc[`{{${toSnakeCase(key)}}}`] = value
    }

    return acc
  }, {})
}

function resolveValue(value: unknown, tokenMap: Record<string, string>): unknown {
  if (typeof value === 'string') {
    let resolved = value

    for (const [token, tokenValue] of Object.entries(tokenMap)) {
      resolved = resolved.replaceAll(token, tokenValue)
    }

    return resolved
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveValue(entry, tokenMap))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, resolveValue(nestedValue, tokenMap)])
    )
  }

  return value
}

export function asActionParameters(value: Prisma.JsonValue | Record<string, unknown>) {
  return toRecord(value)
}

export function injectExecutionOutputsIntoParameters(
  parameters: Prisma.JsonValue | Record<string, unknown>,
  outputs: Array<Record<string, unknown>>
) {
  const record = toRecord(parameters)
  const tokenMap = buildTokenMap(outputs)
  return resolveValue(record, tokenMap) as Record<string, unknown>
}
