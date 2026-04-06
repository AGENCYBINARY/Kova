import { waitUntil } from '@vercel/functions'

/**
 * Run async work after the response is sent (Vercel keeps the invocation alive).
 * Locally, `waitUntil` is usually a no-op — we still void the task so expiration
 * and similar jobs run in the background during dev.
 */
export function deferServerWork(task: Promise<unknown>): void {
  const settled = task.catch((err) => {
    console.error('[deferServerWork]', err)
  })
  waitUntil(settled)
  // When `waitUntil` is a no-op (e.g. local `next dev`), still observe the promise.
  void settled
}
