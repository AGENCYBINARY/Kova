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

test('fallback routes Gmail label removal to the right action', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn('Retire le label "À revoir" du thread Gmail de Claire', [], [])
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['remove_gmail_thread_labels'])
    assert.deepEqual(result.proposals[0]?.parameters.labelNames, ['À revoir'])
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

test('fallback routes Drive app data updates to the right action', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn('Mets à jour le fichier de config appData Drive "kova-config.json" avec ces réglages', [], [])
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['update_google_drive_appdata_file'])
  } finally {
    if (previousKey) {
      process.env.OPENAI_API_KEY = previousKey
    }
  }
})

test('fallback routes Google Photos search to the right action', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn('Cherche dans Google Photos "raclette"', [], [])
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['search_google_photos_media'])
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

test('email requests that update a draft use the draft update action', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn('Mets à jour le brouillon Gmail pour Maxime avec une version plus courte', [], [])
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['update_gmail_draft'])
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

test('calendar requests phrased with faire stay assistant-like and ask for scheduling details when missing', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn('Tu peux me faire un evenement dans calendar google le motif est un rdv avec Maxime', [], [])
    assert.equal(result.proposals.length, 0)
    assert.match(result.response, /date/i)
    assert.match(result.response, /heure/i)
  } finally {
    if (previousKey) {
      process.env.OPENAI_API_KEY = previousKey
    }
  }
})

test('calendar requests without explicit date and time ask for clarification instead of inventing a slot', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn(
      'Tu peux me creer un evenement dans mon calendrier google pour une reunion et inviter massarelli.tristan@gmail.com',
      [],
      []
    )
    assert.equal(result.proposals.length, 0)
    assert.match(result.response, /date/i)
    assert.match(result.response, /heure/i)
    assert.match(result.response, /massarelli\.tristan@gmail\.com/i)
  } finally {
    if (previousKey) {
      process.env.OPENAI_API_KEY = previousKey
    }
  }
})

test('calendar fallback keeps explicit attendee emails when schedule details are present', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn(
      'Crée un événement demain à 15h pour une réunion avec massarelli.tristan@gmail.com',
      [],
      []
    )
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['create_calendar_event'])
    assert.deepEqual(result.proposals[0]?.parameters.attendees, ['massarelli.tristan@gmail.com'])
    assert.equal(result.proposals[0]?.parameters.createMeetLink, false)
    assert.doesNotMatch(result.response, /Google Meet/i)
  } finally {
    if (previousKey) {
      process.env.OPENAI_API_KEY = previousKey
    }
  }
})
