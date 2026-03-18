import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import { defaultAssistantProfile, type AssistantProfile } from '@/lib/assistant/profile'

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function normalizeLegacyText(value: string) {
  return value.replaceAll('CODEX', 'Kova').replaceAll('Codex', 'Kova').replaceAll('codex', 'kova')
}

function parseAssistantProfile(value: unknown): AssistantProfile {
  const obj = asObject(value)
  const assistantName =
    typeof obj.assistantName === 'string'
      ? obj.assistantName.trim() === 'CODEX'
        ? defaultAssistantProfile.assistantName
        : obj.assistantName
      : defaultAssistantProfile.assistantName
  const roleDescription =
    typeof obj.roleDescription === 'string'
      ? normalizeLegacyText(obj.roleDescription)
      : defaultAssistantProfile.roleDescription

  return {
    executiveMode: typeof obj.executiveMode === 'boolean' ? obj.executiveMode : defaultAssistantProfile.executiveMode,
    assistantName,
    roleDescription,
    defaultLanguage:
      obj.defaultLanguage === 'fr' || obj.defaultLanguage === 'en'
        ? obj.defaultLanguage
        : defaultAssistantProfile.defaultLanguage,
    writingTone:
      obj.writingTone === 'executive' ||
      obj.writingTone === 'concise' ||
      obj.writingTone === 'warm' ||
      obj.writingTone === 'sales' ||
      obj.writingTone === 'support'
        ? obj.writingTone
        : defaultAssistantProfile.writingTone,
    writingDirectness:
      obj.writingDirectness === 'soft' || obj.writingDirectness === 'balanced' || obj.writingDirectness === 'direct'
        ? obj.writingDirectness
        : defaultAssistantProfile.writingDirectness,
    signatureName: typeof obj.signatureName === 'string' ? obj.signatureName : defaultAssistantProfile.signatureName,
    signatureBlock:
      typeof obj.signatureBlock === 'string' ? obj.signatureBlock : defaultAssistantProfile.signatureBlock,
    executionPolicy:
      obj.executionPolicy === 'always_ask' ||
      obj.executionPolicy === 'auto_low_risk' ||
      obj.executionPolicy === 'auto_when_confident'
        ? obj.executionPolicy
        : defaultAssistantProfile.executionPolicy,
    confidenceThreshold:
      typeof obj.confidenceThreshold === 'number'
        ? obj.confidenceThreshold
        : defaultAssistantProfile.confidenceThreshold,
    autoResolveKnownContacts:
      typeof obj.autoResolveKnownContacts === 'boolean'
        ? obj.autoResolveKnownContacts
        : defaultAssistantProfile.autoResolveKnownContacts,
    schedulingBufferMinutes:
      typeof obj.schedulingBufferMinutes === 'number'
        ? obj.schedulingBufferMinutes
        : defaultAssistantProfile.schedulingBufferMinutes,
    meetingDefaultDurationMinutes:
      typeof obj.meetingDefaultDurationMinutes === 'number'
        ? obj.meetingDefaultDurationMinutes
        : defaultAssistantProfile.meetingDefaultDurationMinutes,
    enabledSkills:
      Array.isArray(obj.enabledSkills) && obj.enabledSkills.every((skill) => typeof skill === 'string')
        ? (obj.enabledSkills as string[])
        : defaultAssistantProfile.enabledSkills,
  }
}

export async function getAssistantProfile(workspaceId: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { preferences: true },
  })

  const profile = parseAssistantProfile(workspace?.preferences)
  const preferences = asObject(workspace?.preferences)

  if (preferences.assistantName === 'CODEX' || preferences.roleDescription !== profile.roleDescription) {
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        preferences: {
          ...preferences,
          assistantName: profile.assistantName,
          roleDescription: profile.roleDescription,
        } as Prisma.JsonObject,
      },
    })
  }

  return profile
}

export async function updateAssistantProfile(workspaceId: string, profile: AssistantProfile) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { preferences: true },
  })
  const preferences = asObject(workspace?.preferences)

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      preferences: {
        ...preferences,
        ...profile,
      } as unknown as Prisma.JsonObject,
    },
  })

  return profile
}
