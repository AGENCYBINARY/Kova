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
