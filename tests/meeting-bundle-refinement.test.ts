import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMeetingBundleRefinementFollowUp } from '@/lib/agent/follow-up'
import { isMeetingDeliveryRefinementIntent, isEmailSendIntent } from '@/lib/workspace-context/intents'

test('isMeetingDeliveryRefinementIntent detects Meet + mail refinement', () => {
  assert.equal(
    isMeetingDeliveryRefinementIntent(
      "Parfait tu peux mettre un liens google meet dans le mail et dans l'evenement calendrier stp"
    ),
    true
  )
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
