import { getErrorStatus } from '@/lib/http/errors'

export type ChatRouteErrorBody = {
  error: string
  messageFr: string
  messageEn: string
}

/**
 * Maps thrown errors from chat orchestration / OpenAI into stable HTTP responses
 * so the client can show a human message instead of raw API dumps.
 */
export function getChatRouteErrorPayload(error: unknown): { status: number; body: ChatRouteErrorBody } {
  const standard = getErrorStatus(error)
  const raw = error instanceof Error ? error.message : String(error)
  const lower = raw.toLowerCase()

  if (standard.status === 401 || standard.status === 403 || standard.status === 404) {
    return {
      status: standard.status,
      body: {
        error: 'request_error',
        messageFr: standard.message,
        messageEn: standard.message,
      },
    }
  }

  if (raw.includes('OPENAI_API_KEY') || raw.includes('OPENAI_KEY') || lower.includes('api key') && lower.includes('missing')) {
    return {
      status: 503,
      body: {
        error: 'ai_not_configured',
        messageFr:
          "Le moteur d’IA n’est pas configuré sur ce déploiement (clé OpenAI manquante). Contacte l’administrateur.",
        messageEn: 'The AI engine is not configured on this deployment (missing OpenAI key). Contact your administrator.',
      },
    }
  }

  if (
    lower.includes('timeout') ||
    lower.includes('etimedout') ||
    lower.includes('aborted') ||
    raw.includes('504')
  ) {
    return {
      status: 504,
      body: {
        error: 'ai_timeout',
        messageFr:
          "La réponse de l’assistant a mis trop de temps. Réessaie dans un instant ; si ça persiste, raccourcis ta demande ou vérifie la connexion.",
        messageEn:
          'The assistant took too long to respond. Try again in a moment; if it keeps happening, shorten the request or check connectivity.',
      },
    }
  }

  if (lower.includes('rate limit') || raw.includes('429') || lower.includes('too many requests')) {
    return {
      status: 503,
      body: {
        error: 'ai_rate_limited',
        messageFr:
          "Le fournisseur IA est temporairement saturé. Réessaie dans une minute.",
        messageEn: 'The AI provider is temporarily rate-limited. Try again in a minute.',
      },
    }
  }

  if (lower.includes('openai') || lower.includes('responses request failed')) {
    return {
      status: 503,
      body: {
        error: 'ai_provider_error',
        messageFr:
          "L’assistant n’a pas pu finir ce tour (souci côté moteur IA). Réessaie ; si ça continue, vérifie la facturation / quotas OpenAI.",
        messageEn:
          'The assistant could not complete this turn (AI engine issue). Retry; if it persists, check OpenAI billing and quotas.',
      },
    }
  }

  return {
    status: standard.status,
    body: {
      error: 'internal_error',
      messageFr:
        "Un problème technique a interrompu ce tour. Réessaie ; si ça se répète, contacte le support.",
      messageEn: 'A technical issue stopped this turn. Try again; if it repeats, contact support.',
    },
  }
}
