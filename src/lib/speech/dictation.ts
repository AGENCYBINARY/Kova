/** Browser speech-to-text for chat dictation (Chrome / Edge / Safari; Firefox limited). */

export type BrowserSpeechRecognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((ev: { error: string }) => void) | null
  onresult: ((ev: SpeechRecognitionResultListEvent) => void) | null
}

export type SpeechRecognitionResultListEvent = {
  results: SpeechRecognitionResultList
  resultIndex: number
}

type SpeechRecognitionResultList = {
  length: number
  [index: number]: {
    length: number
    [index: number]: { transcript: string }
    isFinal: boolean
  }
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean(
    (window as unknown as { SpeechRecognition?: new () => BrowserSpeechRecognition }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => BrowserSpeechRecognition }).webkitSpeechRecognition
  )
}

export function createSpeechRecognition(): BrowserSpeechRecognition | null {
  if (typeof window === 'undefined') return null
  const W = window as unknown as {
    SpeechRecognition?: new () => BrowserSpeechRecognition
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition
  }
  const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition
  return Ctor ? new Ctor() : null
}
