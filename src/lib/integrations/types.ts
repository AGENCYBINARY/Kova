export type IntegrationProvider = 'gmail' | 'calendar' | 'google_docs' | 'google_drive' | 'notion'

export type IntegrationExecutionResult = {
  details: string
  output: Record<string, unknown>
}
