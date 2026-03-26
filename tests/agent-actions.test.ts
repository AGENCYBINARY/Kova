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

test('generic capability calendar questions do not create action proposals', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn('Tu peux me créer un événement calendrier pour moi ?', [], [])
    assert.equal(result.proposals.length, 0)
    assert.match(result.response, /Oui|oui/)
  } finally {
    if (previousKey) {
      process.env.OPENAI_API_KEY = previousKey
    }
  }
})

test('specific capability-style calendar requests still create proposals', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn('Peux-tu me créer un événement demain à 15h avec Martin ?', [], [])
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['create_calendar_event'])
  } finally {
    if (previousKey) {
      process.env.OPENAI_API_KEY = previousKey
    }
  }
})

test('capability wording with savoir stays conversational and does not create a calendar action', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn('Est ce que tu sais faire des evenement calendrier google ?', [], [])
    assert.equal(result.proposals.length, 0)
    assert.match(result.response, /Oui|oui/)
  } finally {
    if (previousKey) {
      process.env.OPENAI_API_KEY = previousKey
    }
  }
})

test('calendar requests phrased with faire remain actionable and do not fall back to capability mode', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn('Tu peux me faire un evenement dans calendar google le motif est un rdv avec Maxime', [], [])
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['create_calendar_event'])
    assert.equal(result.proposals[0]?.parameters.createMeetLink, false)
    assert.match(result.response, /C'est prêt|prêt/)
  } finally {
    if (previousKey) {
      process.env.OPENAI_API_KEY = previousKey
    }
  }
})
