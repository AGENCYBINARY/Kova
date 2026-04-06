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
