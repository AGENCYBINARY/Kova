import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMeetingBundleRefinementFollowUp } from '@/lib/agent/follow-up'
import { isMeetingDeliveryRefinementIntent, isEmailSendIntent, parseConnectedContextRequest } from '@/lib/workspace-context/intents'
import { buildFallbackResponseWithContactsAndProfile, isEmailCompositionAssistanceRequest } from '@/lib/agent/v1-deterministic'

test('isMeetingDeliveryRefinementIntent detects Meet + mail refinement', () => {
  assert.equal(
    isMeetingDeliveryRefinementIntent(
      "Parfait tu peux mettre un liens google meet dans le mail et dans l'evenement calendrier stp"
    ),
    true
  )
})

test('isMeetingDeliveryRefinementIntent stays false for a fresh meeting brief with recipient and schedule', () => {
  assert.equal(
    isMeetingDeliveryRefinementIntent(
      "peux-tu s'il te plaît écrire un mail à Maxime Neveu avec un lien Google meet en lui disant que il y a une grande visio demain mercredi à 19h30 pour les objectifs"
    ),
    false
  )
})

test('direct email send request is not downgraded to simple composition help', () => {
  assert.equal(
    isEmailCompositionAssistanceRequest(
      "peux-tu s'il te plaît écrire un mail à Maxime Neveu avec un lien Google Meet pour demain mercredi à 19h30"
    ),
    false
  )
})

test('greeting-prefixed direct email send request is still treated as a real action intent', () => {
  assert.equal(
    isEmailCompositionAssistanceRequest(
      "salut boss ça va peux-tu s'il te plaît écrire un mail à Maxime Neveu avec un lien Google Meet pour demain mercredi à 19h30"
    ),
    false
  )
})

test('calendar nouns without a read verb do not get hijacked into connected-read mode', () => {
  const parsed = parseConnectedContextRequest("salut boss ça va plus Maxime Neveu en lui disant que y'a une réunion demain donc vendredi à 11h")
  assert.equal(parsed?.mode, 'action')
  assert.ok(parsed?.sources.includes('calendar'))
})

test('implicit workflow briefs get a targeted clarification instead of the generic fallback', () => {
  const result = buildFallbackResponseWithContactsAndProfile(
    "salut boss ça va plus Maxime Neveu en lui disant que y'a une réunion demain donc vendredi à 11h",
    []
  )

  assert.ok(result.response.trim().length > 0)
  assert.doesNotMatch(result.response, /Je n’ai pas relié ça à une suite claire/i)
})

test('meeting plus email bundle asks for the recipient address instead of emitting a placeholder email proposal', () => {
  const result = buildFallbackResponseWithContactsAndProfile(
    "prépare l'invitation demain vendredi à 11h et envoie aussi le mail à Maxime Neveu avec le lien Google Meet",
    []
  )

  assert.equal(result.proposals.length, 0)
  assert.match(result.response, /adresse|email|gmail/i)
})

test('resolved direct email request produces a polished subject and body instead of echoing the raw instruction', () => {
  const result = buildFallbackResponseWithContactsAndProfile(
    "peux-tu s'il te plaît écrire un mail à Maxime Neveu avec un lien Google Meet en lui disant qu'il y a une grande visio demain vendredi à 11h pour les objectifs",
    [{ name: 'Neveu Maxime', email: 'neveu.maxime29@gmail.com', aliases: ['Maxime Neveu', 'Maxime'] }]
  )

  assert.deepEqual(result.proposals.map((proposal) => proposal.type), ['create_calendar_event', 'send_email'])
  const proposal = result.proposals.find((item) => item.type === 'send_email')
  const calendarProposal = result.proposals.find((item) => item.type === 'create_calendar_event')
  assert.equal(calendarProposal?.parameters.createMeetLink, true)
  assert.equal(proposal?.parameters.to?.[0], 'neveu.maxime29@gmail.com')
  assert.match(String(proposal?.parameters.subject), /visio|réunion|objectifs/i)
  assert.doesNotMatch(String(proposal?.parameters.subject), /peux-tu|écrire un mail/i)
  assert.match(String(proposal?.parameters.body), /Bonjour/i)
  assert.match(String(proposal?.parameters.body), /\{\{\s*meet_?link\s*\}\}/i)
  assert.doesNotMatch(String(proposal?.parameters.body), /peux-tu|écrire un mail/i)
})

test('isEmailSendIntent is false for refinement (avoids literal instruction email)', () => {
  assert.equal(
    isEmailSendIntent('je te demande de mettre un liens dans le mail et l evenement calendrier'),
    false
  )
})

test('buildMeetingBundleRefinementFollowUp rebuilds bundle and forces Meet', () => {
  const out = buildMeetingBundleRefinementFollowUp({
    input: 'mets le lien google meet dans le mail et le calendrier stp',
    pendingActions: [
      {
        id: 'cal1',
        type: 'create_calendar_event',
        title: 'Create meeting invite for Tristan Massarelli',
        description: 'Cal',
        createdAt: '2026-04-06T10:00:00.000Z',
        parameters: {
          title: 'Réunion avec Tristan Massarelli',
          startTime: '2026-04-07T17:00:00.000Z',
          endTime: '2026-04-07T17:30:00.000Z',
          attendees: ['massarelli.tristan@gmail.com'],
          createMeetLink: false,
          requestGroupId: 'group_x',
          proposalIndex: 0,
        },
      },
      {
        id: 'mail1',
        type: 'send_email',
        title: 'Send email to Tristan Massarelli',
        description: 'Mail',
        createdAt: '2026-04-06T10:00:01.000Z',
        parameters: {
          to: ['massarelli.tristan@gmail.com'],
          resolvedContactName: 'Tristan Massarelli',
          subject: 'je te demande de mettre un liens dans le mail',
          body: 'Bonjour,\n\nje te demande de mettre un liens dans le mail et l evenement calendrier\n\nMerci,\nAB',
          requestGroupId: 'group_x',
          proposalIndex: 1,
        },
      },
    ],
    conversationHistory: [
      {
        role: 'user',
        content:
          'Bonjour peut tu envoyer un mail a Tristan Massarelli pour lui dire que y\'a reunion mardi a 19h pour objectif de notre agence du coup et lui mettre un evenement calendrier egalement',
      },
    ],
    assistantProfile: { defaultLanguage: 'fr', signatureName: 'Kova' } as import('@/lib/assistant/profile').AssistantProfile,
  })

  assert.ok(out)
  assert.deepEqual(out!.supersedeActionIds.sort(), ['cal1', 'mail1'].sort())
  assert.equal(out!.proposals.length, 2)
  assert.equal(out!.proposals[0].type, 'create_calendar_event')
  assert.equal(out!.proposals[0].parameters.createMeetLink, true)
  assert.equal(out!.proposals[1].type, 'send_email')
  assert.match(String(out!.proposals[1].parameters.body), /\{\{\s*meet_?link\s*\}\}/i)
  assert.doesNotMatch(String(out!.proposals[1].parameters.body), /je te demande de mettre un liens/i)
  assert.doesNotMatch(String(out!.proposals[1].parameters.subject), /je te demande/i)
})

test('pick prefers newest requestGroupId bundle when several are pending', () => {
  const out = buildMeetingBundleRefinementFollowUp({
    input: 'mets google meet dans le mail et calendrier stp',
    pendingActions: [
      {
        id: 'old_cal',
        type: 'create_calendar_event',
        title: 'Old',
        description: '',
        createdAt: '2026-04-01T10:00:00.000Z',
        parameters: { requestGroupId: 'g_old', title: 'Old', createMeetLink: false },
      },
      {
        id: 'old_mail',
        type: 'send_email',
        title: 'Old mail',
        description: '',
        createdAt: '2026-04-01T10:00:01.000Z',
        parameters: {
          requestGroupId: 'g_old',
          to: ['a@old.com'],
          subject: 'x',
          body: 'y',
        },
      },
      {
        id: 'new_cal',
        type: 'create_calendar_event',
        title: 'New',
        description: '',
        createdAt: '2026-04-06T12:00:00.000Z',
        parameters: { requestGroupId: 'g_new', title: 'New', createMeetLink: false },
      },
      {
        id: 'new_mail',
        type: 'send_email',
        title: 'New mail',
        description: '',
        createdAt: '2026-04-06T12:00:01.000Z',
        parameters: {
          requestGroupId: 'g_new',
          to: ['massarelli.tristan@gmail.com'],
          resolvedContactName: 'Tristan',
          subject: 'ok',
          body: '{{meet_link}}',
        },
      },
    ],
    conversationHistory: [{ role: 'user', content: 'reunion mardi 19h avec Tristan pour objectifs agence' }],
    assistantProfile: { defaultLanguage: 'fr', signatureName: 'Kova' } as import('@/lib/assistant/profile').AssistantProfile,
  })
  assert.ok(out)
  assert.ok(out!.supersedeActionIds.includes('new_cal'))
  assert.ok(out!.supersedeActionIds.includes('new_mail'))
  assert.equal(out!.supersedeActionIds.includes('old_cal'), false)
})

test('pick prefers newest planId bundle before loose requestGroupId matching', () => {
  const out = buildMeetingBundleRefinementFollowUp({
    input: 'mets google meet dans le mail et calendrier stp',
    pendingActions: [
      {
        id: 'plan_old_cal',
        type: 'create_calendar_event',
        title: 'Old plan',
        description: '',
        createdAt: '2026-04-05T10:00:00.000Z',
        planId: 'plan_old',
        parameters: { requestGroupId: 'group_loose', title: 'Old plan', createMeetLink: false },
      },
      {
        id: 'plan_old_mail',
        type: 'create_gmail_draft',
        title: 'Old draft',
        description: '',
        createdAt: '2026-04-05T10:00:01.000Z',
        planId: 'plan_old',
        parameters: {
          requestGroupId: 'group_loose',
          to: ['old@example.com'],
          subject: 'old',
          body: 'old',
        },
      },
      {
        id: 'plan_new_cal',
        type: 'create_calendar_event',
        title: 'New plan',
        description: '',
        createdAt: '2026-04-06T12:00:00.000Z',
        planId: 'plan_new',
        parameters: { requestGroupId: 'group_loose', title: 'New plan', createMeetLink: false },
      },
      {
        id: 'plan_new_mail',
        type: 'create_gmail_draft',
        title: 'New draft',
        description: '',
        createdAt: '2026-04-06T12:00:01.000Z',
        planId: 'plan_new',
        parameters: {
          requestGroupId: 'group_loose',
          to: ['new@example.com'],
          resolvedContactName: 'New Contact',
          subject: 'new',
          body: '{{meet_link}}',
        },
      },
    ],
    conversationHistory: [{ role: 'user', content: 'reunion mardi 19h avec nouveau contact' }],
    assistantProfile: { defaultLanguage: 'fr', signatureName: 'Kova' } as import('@/lib/assistant/profile').AssistantProfile,
  })

  assert.ok(out)
  assert.deepEqual(out!.supersedeActionIds.sort(), ['plan_new_cal', 'plan_new_mail'].sort())
})

test('mail-only pending: adds calendar when schedule inferable from history', () => {
  const out = buildMeetingBundleRefinementFollowUp({
    input: 'mets le lien meet dans le brouillon stp',
    pendingActions: [
      {
        id: 'draft1',
        type: 'create_gmail_draft',
        title: 'Draft for Tristan',
        description: '',
        createdAt: '2026-04-06T14:00:00.000Z',
        parameters: {
          to: ['massarelli.tristan@gmail.com'],
          resolvedContactName: 'Tristan Massarelli',
          subject: 'Rappel',
          body: 'Sans lien',
        },
      },
    ],
    conversationHistory: [
      {
        role: 'user',
        content:
          'Brouillon pour Tristan massarelli.tristan@gmail.com reunion mardi a 19h pour objectifs agence avec lien meet dans le message',
      },
    ],
    assistantProfile: {
      defaultLanguage: 'fr',
      signatureName: 'Kova',
      meetingDefaultDurationMinutes: 30,
      schedulingBufferMinutes: 0,
    } as import('@/lib/assistant/profile').AssistantProfile,
  })
  assert.ok(out)
  assert.equal(out!.proposals.length, 2)
  assert.equal(out!.proposals[0].type, 'create_calendar_event')
  assert.equal(out!.proposals[0].parameters.createMeetLink, true)
  assert.equal(out!.proposals[1].type, 'create_gmail_draft')
  assert.match(String(out!.proposals[1].parameters.body), /\{\{\s*meet_?link\s*\}\}/i)
})

test('recent executed bundle can still anchor a refinement when pending actions disappeared', () => {
  const out = buildMeetingBundleRefinementFollowUp({
    input: 'remets le lien meet dans le mail et l’invitation stp',
    pendingActions: [],
    recentActions: [
      {
        id: 'recent-cal',
        type: 'create_calendar_event',
        title: 'Recent calendar',
        description: '',
        createdAt: '2026-04-06T15:00:00.000Z',
        planId: 'recent-plan',
        status: 'completed',
        parameters: {
          title: 'Réunion avec Paula Massarelli',
          startTime: '2026-04-07T17:00:00.000Z',
          endTime: '2026-04-07T17:30:00.000Z',
          attendees: ['paula@example.com'],
          createMeetLink: false,
        },
      },
      {
        id: 'recent-mail',
        type: 'send_email',
        title: 'Recent mail',
        description: '',
        createdAt: '2026-04-06T15:00:01.000Z',
        planId: 'recent-plan',
        status: 'completed',
        parameters: {
          to: ['paula@example.com'],
          resolvedContactName: 'Paula Massarelli',
          subject: 'Réunion Paula',
          body: 'Bonjour,\n\nSans lien.\n\nMerci,',
        },
      },
    ],
    conversationHistory: [{ role: 'user', content: 'réunion mardi 19h avec Paula Massarelli' }],
    assistantProfile: { defaultLanguage: 'fr', signatureName: 'Kova' } as import('@/lib/assistant/profile').AssistantProfile,
  })

  assert.ok(out)
  assert.equal(out!.proposals.length, 2)
  assert.equal(out!.proposals[0].type, 'create_calendar_event')
  assert.equal(out!.proposals[1].type, 'send_email')
})
