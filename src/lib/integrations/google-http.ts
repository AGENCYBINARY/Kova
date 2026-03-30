const GOOGLE_READ_TIMEOUT_MS = 8_000
const GOOGLE_WRITE_TIMEOUT_MS = 12_000
const GOOGLE_AUTH_TIMEOUT_MS = 10_000

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldRetryGoogleRequest(status?: number) {
  return status === 429 || (typeof status === 'number' && status >= 500)
}

export async function googleFetch(
  url: string,
  init: RequestInit,
  options: {
    timeoutMs: number
    retries?: number
  }
) {
  const retries = options.retries || 0

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs)

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      })

      if (attempt < retries && shouldRetryGoogleRequest(response.status)) {
        await wait(250 * (attempt + 1))
        continue
      }

      return response
    } catch (error) {
      const isAbortError = error instanceof Error && error.name === 'AbortError'
      if (attempt >= retries) {
        throw isAbortError ? new Error('Google request timed out.') : error
      }
      await wait(250 * (attempt + 1))
    } finally {
      clearTimeout(timeout)
    }
  }

  throw new Error('Google request failed.')
}

export {
  GOOGLE_AUTH_TIMEOUT_MS,
  GOOGLE_READ_TIMEOUT_MS,
  GOOGLE_WRITE_TIMEOUT_MS,
}
