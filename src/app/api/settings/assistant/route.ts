import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAppContext } from '@/lib/app-context'
import { executiveAssistantSkillIds, executiveAssistantSkills } from '@/lib/assistant/profile'
import { getAssistantProfile, updateAssistantProfile } from '@/lib/assistant/store'

const assistantSkillIdSchema = z.string().refine((value) => executiveAssistantSkillIds.includes(value), {
  message: 'Unknown assistant skill.',
})

const assistantProfileSchema = z.object({
  executiveMode: z.boolean(),
  assistantName: z.string().min(1).max(60),
  roleDescription: z.string().min(1).max(160),
  defaultLanguage: z.enum(['fr', 'en']),
  writingTone: z.enum(['executive', 'concise', 'warm', 'sales', 'support']),
  writingDirectness: z.enum(['soft', 'balanced', 'direct']),
  signatureName: z.string().min(1).max(80),
  signatureBlock: z.string().min(1).max(200),
  executionPolicy: z.enum(['always_ask', 'auto_low_risk', 'auto_when_confident']),
  confidenceThreshold: z.number().min(0.5).max(0.99),
  autoResolveKnownContacts: z.boolean(),
  schedulingBufferMinutes: z.number().min(0).max(60),
  meetingDefaultDurationMinutes: z.number().min(15).max(120),
  enabledSkills: z.array(assistantSkillIdSchema).min(1),
})

export async function GET() {
  const { workspaceId } = await getAppContext()
  const profile = await getAssistantProfile(workspaceId)

  return NextResponse.json({
    profile,
    skills: executiveAssistantSkills,
  })
}

export async function POST(request: Request) {
  const { workspaceId } = await getAppContext()
  const body = assistantProfileSchema.parse(await request.json())
  const profile = await updateAssistantProfile(workspaceId, body)

  return NextResponse.json({
    profile,
    skills: executiveAssistantSkills,
  })
}
