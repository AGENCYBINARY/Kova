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

const MEET_LINK_PLACEHOLDER_RE = /\{\{\s*meet_?link\s*\}\}/gi

function pickMeetConferenceUrl(outputs: Array<Record<string, unknown>>): string | null {
  for (let i = outputs.length - 1; i >= 0; i--) {
    const output = outputs[i]
    for (const key of ['meetLink', 'meet_link', 'hangoutLink'] as const) {
      const candidate = output[key]
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim()
        if (/^https?:\/\//i.test(trimmed)) {
          return trimmed
        }
      }
    }
  }
  return null
}

function substituteResidualMeetPlaceholdersInString(value: string, outputs: Array<Record<string, unknown>>) {
  if (!MEET_LINK_PLACEHOLDER_RE.test(value)) {
    return value
  }
  MEET_LINK_PLACEHOLDER_RE.lastIndex = 0
  const url = pickMeetConferenceUrl(outputs)
  const fallback =
    '(Le lien Google Meet sera dans l’invitation agenda une fois l’événement créé. / The Meet link is on the calendar invite once the event exists.)'
  return value.replace(MEET_LINK_PLACEHOLDER_RE, url || fallback)
}

function deepSubstituteMeetPlaceholders(value: unknown, outputs: Array<Record<string, unknown>>): unknown {
  if (typeof value === 'string') {
    return substituteResidualMeetPlaceholdersInString(value, outputs)
  }
  if (Array.isArray(value)) {
    return value.map((entry) => deepSubstituteMeetPlaceholders(entry, outputs))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, deepSubstituteMeetPlaceholders(nested, outputs)])
    )
  }
  return value
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
  const afterTokens = resolveValue(record, tokenMap) as Record<string, unknown>
  return deepSubstituteMeetPlaceholders(afterTokens, outputs) as Record<string, unknown>
}
