import { prisma } from '@/lib/db/prisma'
import {
  extractEmailAddresses,
  extractNameBeforeEmail,
  extractNameNearEmail,
  extractRecipientName,
  findContactByName,
  looksLikeContactCorrection,
  rememberContact,
} from '@/lib/contacts'
import { findGoogleContactEmail, getValidGoogleAccessToken } from '@/lib/integrations/google'
import type { PendingActionRecord, PersistedMessageRecord } from '@/lib/agent/chat-state'
import { asRecord } from '@/lib/agent/chat-state'

interface KnownContact {
  name: string
  email: string
  aliases: string[]
}

interface CorrectedContactResult {
  correctedContact: {
    name: string
    email: string
    aliases: string[]
  }
  updatedPendingAction?: PendingActionRecord
  assistantResponse?: string
}

function extractResolvedContactNameFromPendingAction(action: PendingActionRecord) {
  if (typeof action.parameters.resolvedContactName === 'string' && action.parameters.resolvedContactName.trim()) {
    return action.parameters.resolvedContactName.trim()
  }

  const titleMatch = action.title.match(/send email to\s+(.+)$/i)
  if (titleMatch?.[1]) {
    return titleMatch[1].trim()
  }

  const descriptionMatch = action.description.match(/email to\s+(.+?)\s+(through|via|par|with)\b/i)
  if (descriptionMatch?.[1]) {
    return descriptionMatch[1].trim()
  }

  return null
}

export async function resolveCorrectedContactFromChatInput(params: {
  content: string
  previousMessages: PersistedMessageRecord[]
  pendingActions: PendingActionRecord[]
  knownContacts: KnownContact[]
  userId: string
  workspaceId: string
}): Promise<CorrectedContactResult | null> {
  const emails = extractEmailAddresses(params.content)
  if (emails.length === 0 || !looksLikeContactCorrection(params.content)) {
    return null
  }

  const email = emails[0]
  const latestPendingEmailAction = params.pendingActions.find(
    (action) =>
      action.type === 'send_email' ||
      action.type === 'create_gmail_draft' ||
      action.type === 'reply_to_email' ||
      action.type === 'forward_email'
  )
  const explicitNameFromMessage =
    extractRecipientName(params.content) ||
    extractNameBeforeEmail(params.content, email) ||
    extractNameNearEmail(params.content, email)

  const inferredName =
    explicitNameFromMessage ||
    (latestPendingEmailAction ? extractResolvedContactNameFromPendingAction(latestPendingEmailAction) : null) ||
    (() => {
      for (let index = params.previousMessages.length - 1; index >= 0; index -= 1) {
        const message = params.previousMessages[index]
        if (message.role !== 'user') continue
        const fromPreviousMessage = extractRecipientName(message.content)
        if (fromPreviousMessage) return fromPreviousMessage
      }
      return null
    })()

  const existingByEmail = params.knownContacts.find((contact) => contact.email.toLowerCase() === email)
  const name = inferredName || existingByEmail?.name
  if (!name) {
    return null
  }
  const shouldPersistContact = Boolean(explicitNameFromMessage || existingByEmail?.name)

  const correctedContact = {
    name,
    email,
    aliases: explicitNameFromMessage ? [explicitNameFromMessage] : [],
  }

  if (latestPendingEmailAction) {
    const updatedParameters = {
      ...latestPendingEmailAction.parameters,
      to: [email],
      resolvedContactName: name,
    }
    const updatedTitle =
      latestPendingEmailAction.type === 'reply_to_email'
        ? `Reply to ${name}`
        : latestPendingEmailAction.type === 'create_gmail_draft'
          ? `Create draft for ${name}`
          : latestPendingEmailAction.type === 'forward_email'
            ? `Forward email to ${name}`
            : `Send email to ${name}`
    const updatedDescription =
      latestPendingEmailAction.type === 'reply_to_email'
        ? `Prepare a reply to ${name} in the relevant Gmail thread.`
        : latestPendingEmailAction.type === 'create_gmail_draft'
          ? `Prepare a Gmail draft for ${name}.`
          : latestPendingEmailAction.type === 'forward_email'
            ? `Forward the relevant Gmail message to ${name}.`
            : `Prepare and send an email to ${name} through Gmail.`

    const updatedAction = await prisma.action.update({
      where: { id: latestPendingEmailAction.id },
      data: {
        title: updatedTitle,
        description: updatedDescription,
        parameters: updatedParameters,
      },
    })

    if (shouldPersistContact) {
      await rememberContact({
        userId: params.userId,
        workspaceId: params.workspaceId,
        email,
        name,
        aliases: explicitNameFromMessage ? [explicitNameFromMessage] : [],
      })
    }

    return {
      correctedContact,
      updatedPendingAction: {
        id: updatedAction.id,
        type: updatedAction.type,
        title: updatedAction.title,
        description: updatedAction.description,
        parameters: asRecord(updatedAction.parameters),
      },
      assistantResponse: `Adresse corrigée pour ${name}. Vérifie puis confirme.`,
    }
  }

  if (!explicitNameFromMessage) {
    return null
  }

  await rememberContact({
    userId: params.userId,
    workspaceId: params.workspaceId,
    email,
    name,
    aliases: [explicitNameFromMessage],
  })

  return { correctedContact }
}

export async function resolveEmailContactFromGoogle(params: {
  content: string
  knownContacts: KnownContact[]
  userId: string
  workspaceId: string
}) {
  const requestedName = extractRecipientName(params.content)
  if (!requestedName) {
    return null
  }

  const knownContact = findContactByName(requestedName, params.knownContacts)
  if (knownContact) {
    return knownContact
  }

  const gmailIntegration = await prisma.integration.findFirst({
    where: {
      type: 'gmail',
      userId: params.userId,
      workspaceId: params.workspaceId,
      status: 'connected',
    },
  })

  if (!gmailIntegration) {
    return null
  }

  try {
    const accessToken = await getValidGoogleAccessToken(gmailIntegration)
    const email = await findGoogleContactEmail(accessToken, requestedName)
    if (!email) {
      return null
    }

    await rememberContact({
      userId: params.userId,
      workspaceId: params.workspaceId,
      email,
      name: requestedName,
    })

    return {
      name: requestedName,
      email,
      aliases: [requestedName],
    }
  } catch {
    return null
  }
}
