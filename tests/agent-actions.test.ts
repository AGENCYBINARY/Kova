import assert from 'node:assert/strict'
import test from 'node:test'
import { runAgentTurn } from '../src/lib/agent/v1'

test('fallback routes Gmail unarchive to the right action', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn('Remets le thread Gmail "Facture Mars" dans la boîte de réception', [], [])
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['unarchive_gmail_thread'])
  } finally {
    if (previousKey) {
      process.env.OPENAI_API_KEY = previousKey
    }
  }
})

test('fallback routes Drive folder creation to the right action', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn('Crée un dossier Google Drive "Board Ops"', [], [])
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['create_google_drive_folder'])
  } finally {
    if (previousKey) {
      process.env.OPENAI_API_KEY = previousKey
    }
  }
})

test('fallback routes Notion archive to the right action', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn('Archive la page Notion "Sprint plan"', [], [])
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['archive_notion_page'])
  } finally {
    if (previousKey) {
      process.env.OPENAI_API_KEY = previousKey
    }
  }
})
