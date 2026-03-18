import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGmailTodaySummaryFallback } from '../src/lib/workspace-context/gmail-summary'
import {
  detectWorkspaceKnowledgeIntent,
  isEmailSendIntent,
  isReadOnlyWorkspaceQuestion,
  parseConnectedContextRequest,
  resolveConnectedContextRequest,
} from '../src/lib/workspace-context/intents'
import { buildConnectedContextFallbackResponse, buildDeterministicConnectedResponse } from '../src/lib/workspace-context/fallback'

test("gmail inbox summary requests are treated as read-only workspace questions", () => {
  assert.deepEqual(detectWorkspaceKnowledgeIntent("fais moi un resume de mes mails d'aujourd'hui"), {
    type: 'gmail_today_summary',
  })
  assert.equal(isReadOnlyWorkspaceQuestion("fais moi un resume de mes mails d'aujourd'hui"), true)
  assert.equal(isEmailSendIntent("fais moi un resume de mes mails d'aujourd'hui"), false)
})

test('gmail count questions keep a today listing instead of a free-text search', () => {
  assert.deepEqual(parseConnectedContextRequest("tu peux me dire combien j'ai recu de mail aujourd'hui ?"), {
    mode: 'read',
    sources: ['gmail'],
    timeframe: 'today',
    asksForAvailability: false,
    asksForPriorities: false,
    searchQuery: null,
  })
})

test('explicit send requests still stay in the email action path', () => {
  assert.equal(isEmailSendIntent('envoie un mail a paul pour confirmer le rendez-vous'), true)
  assert.equal(isReadOnlyWorkspaceQuestion('envoie un mail a paul pour confirmer le rendez-vous'), false)
})

test('priority requests automatically load the cross-app connected context', () => {
  assert.deepEqual(parseConnectedContextRequest("prepare-moi mes priorites du jour a partir de mes mails et de mon agenda"), {
    mode: 'read',
    sources: ['gmail', 'calendar', 'notion'],
    timeframe: 'today',
    asksForAvailability: false,
    asksForPriorities: true,
    searchQuery: null,
  })
})

test('availability requests default to calendar read mode', () => {
  assert.deepEqual(parseConnectedContextRequest('quelles sont mes disponibilites cette semaine ?'), {
    mode: 'read',
    sources: ['calendar'],
    timeframe: 'week',
    asksForAvailability: true,
    asksForPriorities: false,
    searchQuery: null,
  })
})

test('calendar follow-up detail questions reuse the previous calendar context', () => {
  assert.deepEqual(
    resolveConnectedContextRequest("et tu peux me detailler l'agenda ?", {
      sources: ['calendar'],
      timeframe: 'today',
      asksForAvailability: false,
      asksForPriorities: false,
    }),
    {
      mode: 'read',
      sources: ['calendar'],
      timeframe: 'today',
      asksForAvailability: false,
      asksForPriorities: false,
      searchQuery: null,
    }
  )
})

test('mixed workflow requests keep read context and action mode together', () => {
  assert.deepEqual(parseConnectedContextRequest('retrouve le doc mentionne par Marc dans mes mails et range-le dans Drive'), {
    mode: 'mixed',
    sources: ['gmail', 'google_drive'],
    timeframe: 'recent',
    asksForAvailability: false,
    asksForPriorities: false,
    searchQuery: 'doc mentionne marc',
  })
})

test('follow-up detail questions reuse the previous gmail context', () => {
  assert.deepEqual(
    resolveConnectedContextRequest('et tu peux me les detailler et me dire il parle de quoi ?', {
      sources: ['gmail'],
      timeframe: 'today',
      asksForAvailability: false,
      asksForPriorities: false,
    }),
    {
      mode: 'read',
      sources: ['gmail'],
      timeframe: 'today',
      asksForAvailability: false,
      asksForPriorities: false,
      searchQuery: null,
    }
  )
})

test('gmail unread follow-ups keep the same listing instead of launching a new search', () => {
  assert.deepEqual(
    resolveConnectedContextRequest("je te demande de me dire a quoi corresponds les 2 messages gmail et le 1 non lu", {
      sources: ['gmail'],
      timeframe: 'today',
      asksForAvailability: false,
      asksForPriorities: false,
    }),
    {
      mode: 'read',
      sources: ['gmail'],
      timeframe: 'today',
      asksForAvailability: false,
      asksForPriorities: false,
      searchQuery: null,
    }
  )
})

test('gmail unread questions still default to today listing even without a seed', () => {
  assert.deepEqual(parseConnectedContextRequest("le message non lu c'est quoi ?"), {
    mode: 'read',
    sources: ['gmail'],
    timeframe: 'today',
    asksForAvailability: false,
    asksForPriorities: false,
    searchQuery: null,
  })
})

test('gmail fallback summary stays user-facing and concise', () => {
  const summary = buildGmailTodaySummaryFallback({
    connectedAccount: 'founder@company.com',
    language: 'fr',
    messages: [
      {
        id: 'm1',
        threadId: 't1',
        from: 'Alice <alice@client.com>',
        subject: 'Contrat Q2',
        snippet: 'Peux-tu valider la derniere version du contrat avant 16h ?',
        internalDate: String(Date.now()),
        unread: true,
      },
      {
        id: 'm2',
        threadId: 't2',
        from: 'Bob <bob@partner.com>',
        subject: 'Point produit',
        snippet: 'Je t envoie les remarques de l equipe produit.',
        internalDate: String(Date.now() - 1000),
        unread: false,
      },
    ],
  })

  assert.match(summary, /2 email\(s\) sont arrives aujourd'hui/)
  assert.match(summary, /Contrat Q2/)
  assert.match(summary, /Point produit/)
})

test('connected context fallback stays concise across multiple sources', () => {
  const summary = buildConnectedContextFallbackResponse(
    {
      request: {
        mode: 'read',
        sources: ['gmail', 'calendar', 'notion'],
        timeframe: 'today',
        asksForAvailability: false,
        asksForPriorities: true,
        searchQuery: null,
      },
      workspaceContext: 'unused in this unit test',
      metadata: {
        connectedContextSummary: [
          { source: 'gmail', messageCount: 6, unreadCount: 2 },
          { source: 'calendar', eventCount: 3, availabilityCount: 2 },
          { source: 'notion', pageCount: 4 },
        ],
      },
    },
    'fr'
  )

  assert.match(summary, /gmail: 6 messages, 2 non lus/)
  assert.match(summary, /calendar: 3 evenements, 2 creneaux libres/)
  assert.match(summary, /notion: 4 pages correspondantes/)
})

test('connected context fallback surfaces reconnect-required permissions', () => {
  const summary = buildConnectedContextFallbackResponse(
    {
      request: {
        mode: 'read',
        sources: ['gmail'],
        timeframe: 'today',
        asksForAvailability: false,
        asksForPriorities: false,
        searchQuery: null,
      },
      workspaceContext: 'unused',
      metadata: {
        connectedContextSummary: [
          {
            source: 'gmail',
            needsReconnect: true,
            missingScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
          },
        ],
      },
    },
    'fr'
  )

  assert.match(summary, /reconnexion requise/)
})

test('deterministic calendar availability response lists free windows', () => {
  const response = buildDeterministicConnectedResponse(
    'quelles sont mes disponibilites aujourd hui ?',
    {
      request: {
        mode: 'read',
        sources: ['calendar'],
        timeframe: 'today',
        asksForAvailability: true,
        asksForPriorities: false,
        searchQuery: null,
      },
      workspaceContext: 'unused',
      metadata: {
        connectedContextSummary: [
          {
            source: 'calendar',
            eventCount: 2,
            availabilityCount: 2,
            availability: [
              { startTime: '2026-03-18T09:00:00.000Z', endTime: '2026-03-18T10:30:00.000Z' },
              { startTime: '2026-03-18T14:00:00.000Z', endTime: '2026-03-18T16:00:00.000Z' },
            ],
            events: [
              {
                title: 'Point equipe',
                startTime: '2026-03-18T10:30:00.000Z',
                endTime: '2026-03-18T11:00:00.000Z',
                attendees: ['alice@company.com'],
                location: null,
                meetLink: 'https://meet.google.com/abc',
                status: 'confirmed',
              },
            ],
          },
        ],
      },
    },
    'fr'
  )

  assert.match(response || '', /Creneaux disponibles/)
  assert.match(response || '', /2026-03-18T09:00:00.000Z/)
  assert.match(response || '', /2026-03-18T14:00:00.000Z/)
})

test('deterministic calendar next event response isolates the next event', () => {
  const response = buildDeterministicConnectedResponse(
    "quel est mon prochain rendez-vous ?",
    {
      request: {
        mode: 'read',
        sources: ['calendar'],
        timeframe: 'today',
        asksForAvailability: false,
        asksForPriorities: false,
        searchQuery: null,
      },
      workspaceContext: 'unused',
      metadata: {
        connectedContextSummary: [
          {
            source: 'calendar',
            eventCount: 2,
            availabilityCount: 0,
            events: [
              {
                title: 'Point equipe',
                startTime: '2026-03-18T10:30:00.000Z',
                endTime: '2026-03-18T11:00:00.000Z',
                attendees: ['alice@company.com'],
                location: null,
                meetLink: 'https://meet.google.com/abc',
                status: 'confirmed',
              },
              {
                title: 'Demo client',
                startTime: '2026-03-18T14:00:00.000Z',
                endTime: '2026-03-18T15:00:00.000Z',
                attendees: ['bob@client.com'],
                location: 'Visio',
                meetLink: null,
                status: 'confirmed',
              },
            ],
          },
        ],
      },
    },
    'fr'
  )

  assert.match(response || '', /Ton prochain evenement est/)
  assert.match(response || '', /Point equipe/)
  assert.doesNotMatch(response || '', /Demo client/)
})

test('deterministic drive detail response lists matching files', () => {
  const response = buildDeterministicConnectedResponse(
    'tu peux me detailler les fichiers drive ?',
    {
      request: {
        mode: 'read',
        sources: ['google_drive'],
        timeframe: 'recent',
        asksForAvailability: false,
        asksForPriorities: false,
        searchQuery: 'contrat',
      },
      workspaceContext: 'unused',
      metadata: {
        connectedContextSummary: [
          {
            source: 'google_drive',
            fileCount: 2,
            files: [
              {
                name: 'Contrat-client.pdf',
                mimeType: 'application/pdf',
                modifiedTime: '2026-03-18T08:00:00.000Z',
                owners: ['Alice'],
                webViewLink: 'https://drive.google.com/file1',
              },
              {
                name: 'Contrat-annexe.docx',
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                modifiedTime: '2026-03-17T18:00:00.000Z',
                owners: ['Alice'],
                webViewLink: 'https://drive.google.com/file2',
              },
            ],
          },
        ],
      },
    },
    'fr'
  )

  assert.match(response || '', /Voici les fichiers Drive correspondants/)
  assert.match(response || '', /Contrat-client.pdf/)
  assert.match(response || '', /Contrat-annexe.docx/)
})

test('deterministic notion detail response lists matching pages', () => {
  const response = buildDeterministicConnectedResponse(
    'tu peux me detailler les pages notion ?',
    {
      request: {
        mode: 'read',
        sources: ['notion'],
        timeframe: 'recent',
        asksForAvailability: false,
        asksForPriorities: false,
        searchQuery: 'roadmap',
      },
      workspaceContext: 'unused',
      metadata: {
        connectedContextSummary: [
          {
            source: 'notion',
            pageCount: 2,
            pages: [
              {
                title: 'Roadmap Q2',
                lastEditedTime: '2026-03-18T07:30:00.000Z',
                preview: 'Priorites produit et planning des lancements.',
                url: 'https://notion.so/page1',
              },
              {
                title: 'Roadmap Sales',
                lastEditedTime: '2026-03-17T11:00:00.000Z',
                preview: 'Pipeline, offres et prochains comptes a ouvrir.',
                url: 'https://notion.so/page2',
              },
            ],
          },
        ],
      },
    },
    'fr'
  )

  assert.match(response || '', /Voici les pages Notion correspondantes/)
  assert.match(response || '', /Roadmap Q2/)
  assert.match(response || '', /Roadmap Sales/)
})

test('deterministic gmail detail response lists the loaded emails', () => {
  const response = buildDeterministicConnectedResponse(
    'et tu peux me les detailler et me dire il parle de quoi ?',
    {
      request: {
        mode: 'read',
        sources: ['gmail'],
        timeframe: 'today',
        asksForAvailability: false,
        asksForPriorities: false,
        searchQuery: null,
      },
      workspaceContext: 'unused',
      metadata: {
        connectedContextSummary: [
          {
            source: 'gmail',
            messageCount: 2,
            unreadCount: 1,
            messages: [
              {
                from: 'Alice <alice@client.com>',
                subject: 'Contrat Q2',
                snippet: 'Peux-tu valider la derniere version du contrat avant 16h ?',
                unread: true,
              },
              {
                from: 'Bob <bob@partner.com>',
                subject: 'Point produit',
                snippet: 'Je t envoie les remarques de l equipe produit.',
                unread: false,
              },
            ],
          },
        ],
      },
    },
    'fr'
  )

  assert.match(response || '', /Voici les emails d'aujourd'hui/)
  assert.match(response || '', /Contrat Q2/)
  assert.match(response || '', /Point produit/)
})

test('deterministic gmail unread response isolates the unread email', () => {
  const response = buildDeterministicConnectedResponse(
    "le message non lu c'est quoi ?",
    {
      request: {
        mode: 'read',
        sources: ['gmail'],
        timeframe: 'today',
        asksForAvailability: false,
        asksForPriorities: false,
        searchQuery: null,
      },
      workspaceContext: 'unused',
      metadata: {
        connectedContextSummary: [
          {
            source: 'gmail',
            messageCount: 2,
            unreadCount: 1,
            messages: [
              {
                from: 'Alice <alice@client.com>',
                subject: 'Contrat Q2',
                snippet: 'Peux-tu valider la derniere version du contrat avant 16h ?',
                unread: true,
              },
              {
                from: 'Bob <bob@partner.com>',
                subject: 'Point produit',
                snippet: 'Je t envoie les remarques de l equipe produit.',
                unread: false,
              },
            ],
          },
        ],
      },
    },
    'fr'
  )

  assert.match(response || '', /Le message non lu est/)
  assert.match(response || '', /Contrat Q2/)
  assert.doesNotMatch(response || '', /Point produit/)
})

test('deterministic priority brief combines gmail, calendar and notion', () => {
  const response = buildDeterministicConnectedResponse(
    'prepare-moi mes priorites du jour',
    {
      request: {
        mode: 'read',
        sources: ['gmail', 'calendar', 'notion'],
        timeframe: 'today',
        asksForAvailability: false,
        asksForPriorities: true,
        searchQuery: null,
      },
      workspaceContext: 'unused',
      metadata: {
        connectedContextSummary: [
          {
            source: 'gmail',
            messageCount: 3,
            unreadCount: 1,
            messages: [
              {
                from: 'Alice <alice@client.com>',
                subject: 'Contrat Q2',
                snippet: 'Validation attendue avant 16h.',
                unread: true,
              },
            ],
          },
          {
            source: 'calendar',
            eventCount: 2,
            availabilityCount: 1,
            events: [
              {
                title: 'Point equipe',
                startTime: '2026-03-18T10:30:00.000Z',
                endTime: '2026-03-18T11:00:00.000Z',
                attendees: ['alice@company.com'],
                location: null,
                meetLink: 'https://meet.google.com/abc',
                status: 'confirmed',
              },
            ],
          },
          {
            source: 'notion',
            pageCount: 1,
            pages: [
              {
                title: 'Roadmap Q2',
                lastEditedTime: '2026-03-18T07:30:00.000Z',
                preview: 'Priorites produit et planning.',
                url: 'https://notion.so/page1',
              },
            ],
          },
        ],
      },
    },
    'fr'
  )

  assert.match(response || '', /Brief priorites du jour/)
  assert.match(response || '', /Boite mail: 3 email\(s\), 1 non lus/)
  assert.match(response || '', /Prochain rendez-vous/)
  assert.match(response || '', /Page la plus pertinente/)
})
