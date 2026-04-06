import assert from 'node:assert/strict'
import test from 'node:test'
import { responseClaimsActionReady, runAgentTurn } from '../src/lib/agent/v1'
import { shouldPreferDeterministicAction, type AgentProposal } from '../src/lib/agent/v1-deterministic'

function mockOpenAiStructuredTurn(payload: { response: string; proposals: unknown[]; plan?: unknown[] }) {
  const originalFetch = global.fetch
  global.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  plan: [],
                  ...payload,
                }),
              },
            ],
          },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 10,
          total_tokens: 20,
        },
      }),
    }) as Response) as typeof fetch

  return () => {
    global.fetch = originalFetch
  }
}

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

test('gmail subjects containing the word Starts do not trigger a star action by mistake', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn('Archive le thread Gmail "OpenClaw Foundation Starts Hiring"', [], [])
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['archive_gmail_thread'])
  } finally {
    if (previousKey) {
      process.env.OPENAI_API_KEY = previousKey
    }
  }
})

test('gmail draft requests with Starts in the quoted subject stay draft actions', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn('Prépare un brouillon Gmail pour contact@agencybinary.fr à propos de "OpenClaw Foundation Starts Hiring"', [], [])
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['create_gmail_draft'])
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

test('fallback routes Google Photos requests to a picker session by default', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn('Cherche dans Google Photos "raclette"', [], [])
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['create_google_photos_picker_session'])
  } finally {
    if (previousKey) {
      process.env.OPENAI_API_KEY = previousKey
    }
  }
})

test('fallback routes Google Photos picker opening requests to a picker session', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn('Ouvre Google Photos pour que je choisisse des images', [], [])
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['create_google_photos_picker_session'])
  } finally {
    if (previousKey) {
      process.env.OPENAI_API_KEY = previousKey
    }
  }
})

test('action-ready guard treats an opened Google Photos session as executable state', () => {
  assert.equal(responseClaimsActionReady('Session Google Photos ouverte, tu peux sélectionner les images à importer.'), true)
})

test('fallback routes Google Photos selected-media search when the user references the picked selection', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn('Cherche dans les photos sélectionnées Google Photos "raclette"', [], [])
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

test('gmail draft requests create a real draft proposal instead of a conversational-only reply', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn('Prépare un brouillon Gmail pour maxime@client.com à propos de "Votre solde est bas"', [], [])
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['create_gmail_draft'])
    assert.deepEqual(result.proposals[0]?.parameters.to, ['maxime@client.com'])
  } finally {
    if (previousKey) {
      process.env.OPENAI_API_KEY = previousKey
    }
  }
})

test('google doc section additions are treated as document updates', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn('Ajoute une section "Décisions" dans le Google Doc sélectionné', [], [])
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['update_google_doc'])
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
    assert.equal(result.proposals[0]?.parameters.createMeetLink, true)
    assert.match(result.response, /Google Meet|Meet/i)
  } finally {
    if (previousKey) {
      process.env.OPENAI_API_KEY = previousKey
    }
  }
})

test('calendar fallback respects explicit requests without Google Meet', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn(
      'Crée un événement demain à 15h pour une réunion avec massarelli.tristan@gmail.com sans Google Meet',
      [],
      []
    )
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['create_calendar_event'])
    assert.equal(result.proposals[0]?.parameters.createMeetLink, false)
    assert.doesNotMatch(result.response, /Google Meet/i)
  } finally {
    if (previousKey) {
      process.env.OPENAI_API_KEY = previousKey
    }
  }
})

test('calendar fallback routes selected-event updates to update_calendar_event with relative shift when the model is unavailable', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn(
      "Mets à jour l'événement Google Calendar sélectionné en le décalant de 30 minutes\n[[kova-ref:calendar:eventId:event_live_123]]",
      [],
      [],
      undefined,
      undefined,
      {
        connectedContextMetadata: {
          connectedContextSummary: [
            {
              source: 'calendar',
              events: [
                {
                  eventId: 'event_live_123',
                  title: 'Point produit',
                  startTime: '2026-04-07T10:00:00.000Z',
                  endTime: '2026-04-07T10:30:00.000Z',
                },
              ],
            },
          ],
        },
      }
    )
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['update_calendar_event'])
    assert.equal(result.proposals[0]?.parameters.eventId, 'event_live_123')
    assert.equal(result.proposals[0]?.parameters.relativeShiftMinutes, 30)
  } finally {
    if (previousKey) {
      process.env.OPENAI_API_KEY = previousKey
    }
  }
})

test('calendar update requests stay on the calendar path instead of drifting into email help', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    const result = await runAgentTurn(
      "Mets à jour l'événement Google Calendar sélectionné en le décalant de 30 minutes",
      [],
      [],
      undefined,
      undefined,
      {
        connectedContextMetadata: {
          connectedContextSummary: [
            {
              source: 'calendar',
              events: [
                {
                  eventId: 'event_live_123',
                  title: 'Point produit',
                  startTime: '2026-04-07T10:00:00.000Z',
                  endTime: '2026-04-07T10:30:00.000Z',
                },
              ],
            },
          ],
        },
      }
    )
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['update_calendar_event'])
    assert.equal(result.proposals[0]?.parameters.eventId, 'event_live_123')
    assert.equal(result.proposals[0]?.parameters.relativeShiftMinutes, 30)
  } finally {
    if (previousKey) {
      process.env.OPENAI_API_KEY = previousKey
    }
  }
})

test('LLM-first by default; KOVA_PREFER_DETERMINISTIC_ACTIONS=true enables shortcut routing', () => {
  const prevDet = process.env.KOVA_PREFER_DETERMINISTIC_ACTIONS
  delete process.env.KOVA_PREFER_DETERMINISTIC_ACTIONS
  try {
    const proposal: AgentProposal = {
      type: 'archive_gmail_thread',
      title: 'Archive Gmail thread',
      description: 'Archive the matching Gmail thread.',
      parameters: { threadId: '' },
      confidenceScore: 0.82,
    }
    assert.equal(shouldPreferDeterministicAction('Archive le thread Gmail "Test"', [proposal]), false)

    process.env.KOVA_PREFER_DETERMINISTIC_ACTIONS = 'true'
    assert.equal(shouldPreferDeterministicAction('Archive le thread Gmail "Test"', [proposal]), true)
  } finally {
    if (prevDet !== undefined) process.env.KOVA_PREFER_DETERMINISTIC_ACTIONS = prevDet
    else delete process.env.KOVA_PREFER_DETERMINISTIC_ACTIONS
  }
})

test('model-first path can return an ordered multi-step plan across apps', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'test-key'
  const restoreFetch = mockOpenAiStructuredTurn({
    response:
      "Je prépare d’abord le document, puis je crée la page Notion pour y relayer le contenu. Tu auras un plan propre en deux étapes.",
    plan: [
      {
        title: 'Préparer le brief',
        detail: 'Créer le Google Doc source avec le contenu de travail.',
        app: 'Google Docs',
      },
      {
        title: 'Relayer dans Notion',
        detail: 'Créer la page Notion qui reprend le brief.',
        app: 'Notion',
      },
    ],
    proposals: [
      {
        type: 'create_google_doc',
        title: 'Create planning doc',
        description: 'Create the Google Doc that holds the working brief.',
        confidenceScore: 0.94,
        parameters_json: JSON.stringify({
          title: 'Plan de lancement',
          content: 'Brief initial',
        }),
      },
      {
        type: 'create_notion_page',
        title: 'Create Notion relay',
        description: 'Create the Notion page that mirrors the brief.',
        confidenceScore: 0.9,
        parameters_json: JSON.stringify({
          title: 'Plan de lancement',
          content: 'Résumé du brief',
        }),
      },
    ],
  })

  try {
    const result = await runAgentTurn(
      'Prépare un brief dans Google Docs puis crée une page Notion avec le même contenu',
      [],
      []
    )
    assert.equal(result.plan?.length, 2)
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['create_google_doc', 'create_notion_page'])
    assert.match(result.response, /d’abord|d'abord/i)
    assert.match(result.response, /Notion/i)
  } finally {
    restoreFetch()
    if (previousKey) process.env.OPENAI_API_KEY = previousKey
    else delete process.env.OPENAI_API_KEY
  }
})

test('model answers capability questions conversationally even if it over-eagerly suggests an action', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'test-key'
  const restoreFetch = mockOpenAiStructuredTurn({
    response: 'Oui. Je peux te préparer ça proprement dès que tu me donnes la date et l’heure.',
    proposals: [
      {
        type: 'create_calendar_event',
        title: 'Create calendar event',
        description: 'Prepare the meeting.',
        confidenceScore: 0.61,
        parameters_json: JSON.stringify({
          title: 'Rendez-vous',
          startTime: '2026-04-07T09:00:00.000Z',
          endTime: '2026-04-07T09:30:00.000Z',
          attendees: [],
        }),
      },
    ],
  })

  try {
    const result = await runAgentTurn('Tu peux me créer un événement calendrier pour moi ?', [], [])
    assert.equal(result.proposals.length, 0)
    assert.match(result.response, /Oui|oui/)
    assert.match(result.response, /date/i)
  } finally {
    restoreFetch()
    if (previousKey) process.env.OPENAI_API_KEY = previousKey
    else delete process.env.OPENAI_API_KEY
  }
})

test('deterministic fallback still rescues execution when the model claims readiness without usable proposals', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'test-key'
  const restoreFetch = mockOpenAiStructuredTurn({
    response: "C'est prêt. Le thread Gmail est archivé.",
    proposals: [],
  })

  try {
    const result = await runAgentTurn('Archive le thread Gmail "Facture Mars"', [], [])
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['archive_gmail_thread'])
    assert.match(result.response, /prêt|pret/i)
  } finally {
    restoreFetch()
    if (previousKey) process.env.OPENAI_API_KEY = previousKey
    else delete process.env.OPENAI_API_KEY
  }
})

test('deterministic fallback still rescues clear action requests when the model returns low-value text', async () => {
  const previousKey = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'test-key'
  const restoreFetch = mockOpenAiStructuredTurn({
    response: 'Je peux transformer cela en action pour Google Drive.',
    proposals: [],
  })

  try {
    const result = await runAgentTurn('Crée un dossier Google Drive "Board Ops"', [], [])
    assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['create_google_drive_folder'])
    assert.match(result.response, /Board Ops|dossier/i)
  } finally {
    restoreFetch()
    if (previousKey) process.env.OPENAI_API_KEY = previousKey
    else delete process.env.OPENAI_API_KEY
  }
})
