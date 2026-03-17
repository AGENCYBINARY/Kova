export type IntegrationProvider = 'gmail' | 'calendar' | 'google_docs' | 'notion'

export type IntegrationExecutionResult = {
  details: string
  output: Record<string, unknown>
}
