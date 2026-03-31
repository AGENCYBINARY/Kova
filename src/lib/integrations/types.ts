export type IntegrationProvider = 'gmail' | 'calendar' | 'google_docs' | 'google_drive' | 'google_photos' | 'notion'

export type IntegrationExecutionResult = {
  details: string
  output: Record<string, unknown>
}
