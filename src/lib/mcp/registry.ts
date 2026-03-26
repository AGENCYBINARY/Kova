import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import type { DashboardAction } from '@/lib/dashboard-data'
import { prepareActionParameters } from '@/lib/agent/data-prep'
import {
  archiveGmailThread,
  copyGoogleDriveFile,
  createGmailDraft,
  createGoogleCalendarEvent,
  createGoogleDoc,
  createGoogleDriveFile,
  createGoogleDriveFolder,
  deleteGoogleCalendarEvent,
  deleteGoogleDriveFile,
  forwardGmailMessage,
  getValidGoogleAccessToken,
  labelGmailThread,
  moveGoogleDriveFile,
  renameGoogleDriveFile,
  readGmailMessageBody,
  replyToGmailMessage,
  sendGmailMessage,
  setGmailThreadStarredState,
  setGmailThreadReadState,
  shareGoogleDriveFile,
  trashGmailThread,
  unarchiveGmailThread,
  unshareGoogleDriveFile,
  updateGoogleCalendarEvent,
  updateGoogleDoc,
} from '@/lib/integrations/google'
import {
  archiveNotionPage,
  createNotionPage,
  getValidNotionAccessToken,
  updateNotionPage,
  updateNotionPageProperties,
} from '@/lib/integrations/notion'
import type { IntegrationExecutionResult } from '@/lib/integrations/types'
import type { McpExecutionContext, McpToolDefinition } from '@/lib/mcp/types'

const sendEmailSchema = z.object({
  to: z.array(z.string().email()).min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
}).passthrough()

const createCalendarSchema = z.object({
  title: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  attendees: z.array(z.string().email()).default([]),
  createMeetLink: z.boolean().optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
}).passthrough()

const createGoogleDocSchema = z.object({
  title: z.string().min(1),
  content: z.string().optional(),
  sections: z.array(z.string()).optional(),
  sourcePrompt: z.string().optional(),
}).passthrough()

const updateGoogleDocSchema = z.object({
  documentId: z.string().min(1),
  content: z.string().min(1),
}).passthrough()

const createGoogleDriveFileSchema = z.object({
  name: z.string().min(1),
  content: z.string().optional(),
  folderName: z.string().optional(),
  parentFolderId: z.string().optional(),
  mimeType: z.string().optional(),
}).passthrough()

const createGoogleDriveFolderSchema = z.object({
  name: z.string().min(1),
  folderName: z.string().optional(),
  parentFolderId: z.string().optional(),
}).passthrough()

const createNotionPageSchema = z.object({
  title: z.string().min(1),
  content: z.string().optional(),
  parentPageId: z.string().optional(),
  parentDatabaseId: z.string().optional(),
  properties: z.record(z.unknown()).optional(),
}).passthrough()

const updateNotionPageSchema = z.object({
  pageId: z.string().min(1),
  content: z.string().min(1),
}).passthrough()

const notionPageIdentifierSchema = z.object({
  pageId: z.string().min(1),
}).passthrough()

const replyToEmailSchema = z.object({
  threadId: z.string().min(1),
  messageId: z.string().min(1),
  to: z.array(z.string().email()).min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
}).passthrough()

const createGmailDraftSchema = z.object({
  to: z.array(z.string().email()).min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
}).passthrough()

const forwardEmailSchema = z.object({
  messageId: z.string().min(1).optional(),
  threadId: z.string().min(1).optional(),
  to: z.array(z.string().email()).min(1),
  note: z.string().optional(),
}).passthrough().refine((value) => Boolean(value.messageId || value.threadId), {
  message: 'messageId or threadId is required',
})

const gmailThreadSchema = z.object({
  threadId: z.string().min(1),
}).passthrough()

const gmailLabelSchema = z.object({
  threadId: z.string().min(1),
  labelNames: z.array(z.string().min(1)).min(1),
}).passthrough()

const updateCalendarEventSchema = z.object({
  eventId: z.string().min(1),
  title: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  attendees: z.array(z.string().email()).optional(),
  description: z.string().optional(),
}).passthrough()

const deleteCalendarEventSchema = z.object({
  eventId: z.string().min(1),
}).passthrough()

const deleteGoogleDriveFileSchema = z.object({
  fileId: z.string().min(1),
}).passthrough()

const moveGoogleDriveFileSchema = z.object({
  fileId: z.string().min(1),
  destinationFolderId: z.string().min(1).optional(),
  destinationFolderName: z.string().min(1).optional(),
}).passthrough().refine((value) => Boolean(value.destinationFolderId || value.destinationFolderName), {
  message: 'destinationFolderId or destinationFolderName is required',
})

const renameGoogleDriveFileSchema = z.object({
  fileId: z.string().min(1),
  name: z.string().min(1),
}).passthrough()

const shareGoogleDriveFileSchema = z.object({
  fileId: z.string().min(1),
  emails: z.array(z.string().email()).min(1),
  role: z.enum(['reader', 'commenter', 'writer']).optional(),
  notify: z.boolean().optional(),
  message: z.string().optional(),
}).passthrough()

const copyGoogleDriveFileSchema = z.object({
  fileId: z.string().min(1),
  name: z.string().optional(),
  destinationFolderId: z.string().min(1).optional(),
  destinationFolderName: z.string().min(1).optional(),
}).passthrough()

const unshareGoogleDriveFileSchema = z.object({
  fileId: z.string().min(1),
  emails: z.array(z.string().email()).min(1),
}).passthrough()

const updateNotionPagePropertiesSchema = z.object({
  pageId: z.string().min(1),
  properties: z.record(z.unknown()).optional(),
  content: z.string().optional(),
}).passthrough().refine((value) => Boolean(value.properties || value.content), {
  message: 'properties or content is required',
})

async function getConnectedIntegration(context: McpExecutionContext, provider: string) {
  const integration = await prisma.integration.findFirst({
    where: {
      type: provider,
      workspaceId: context.workspaceId,
      userId: context.userId,
      status: 'connected',
    },
    orderBy: [{ updatedAt: 'desc' }],
  })

  if (!integration) {
    throw new Error(`Integration "${provider}" is not connected.`)
  }

  return integration
}

const tools: Array<McpToolDefinition> = [
  {
    name: 'gmail.send_email',
    actionType: 'send_email',
    provider: 'gmail',
    title: 'Send email',
    description: 'Send a Gmail message with validated recipients and deterministic payload.',
    version: '2026-03-17',
    riskLevel: 'medium',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string', format: 'email' } },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
      additionalProperties: true,
    },
    inputSchema: sendEmailSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'gmail')
      const accessToken = await getValidGoogleAccessToken(integration)
      return sendGmailMessage(accessToken, input)
    },
  },
  {
    name: 'calendar.create_event',
    actionType: 'create_calendar_event',
    provider: 'calendar',
    title: 'Create calendar event',
    description: 'Create a Google Calendar event with optional Meet link.',
    version: '2026-03-17',
    riskLevel: 'low',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        startTime: { type: 'string' },
        endTime: { type: 'string' },
        attendees: { type: 'array', items: { type: 'string', format: 'email' } },
        createMeetLink: { type: 'boolean' },
        description: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['title', 'startTime', 'endTime'],
      additionalProperties: true,
    },
    inputSchema: createCalendarSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'calendar')
      const accessToken = await getValidGoogleAccessToken(integration)
      return createGoogleCalendarEvent(accessToken, input)
    },
  },
  {
    name: 'gmail.create_draft',
    actionType: 'create_gmail_draft',
    provider: 'gmail',
    title: 'Create Gmail draft',
    description: 'Create a Gmail draft without sending it.',
    version: '2026-03-26',
    riskLevel: 'low',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string', format: 'email' } },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
      additionalProperties: true,
    },
    inputSchema: createGmailDraftSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'gmail')
      const accessToken = await getValidGoogleAccessToken(integration)
      return createGmailDraft(accessToken, input)
    },
  },
  {
    name: 'gmail.forward_email',
    actionType: 'forward_email',
    provider: 'gmail',
    title: 'Forward email',
    description: 'Forward a Gmail message or thread to one or more recipients.',
    version: '2026-03-25',
    riskLevel: 'medium',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        messageId: { type: 'string' },
        threadId: { type: 'string' },
        to: { type: 'array', items: { type: 'string', format: 'email' } },
        note: { type: 'string' },
      },
      required: ['to'],
      additionalProperties: true,
    },
    inputSchema: forwardEmailSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'gmail')
      const accessToken = await getValidGoogleAccessToken(integration)
      return forwardGmailMessage(accessToken, input)
    },
  },
  {
    name: 'gmail.archive_thread',
    actionType: 'archive_gmail_thread',
    provider: 'gmail',
    title: 'Archive Gmail thread',
    description: 'Archive a Gmail thread by removing it from the inbox.',
    version: '2026-03-25',
    riskLevel: 'low',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        threadId: { type: 'string' },
      },
      required: ['threadId'],
      additionalProperties: true,
    },
    inputSchema: gmailThreadSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'gmail')
      const accessToken = await getValidGoogleAccessToken(integration)
      return archiveGmailThread(accessToken, input)
    },
  },
  {
    name: 'gmail.unarchive_thread',
    actionType: 'unarchive_gmail_thread',
    provider: 'gmail',
    title: 'Unarchive Gmail thread',
    description: 'Restore a Gmail thread to the inbox.',
    version: '2026-03-26',
    riskLevel: 'low',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        threadId: { type: 'string' },
      },
      required: ['threadId'],
      additionalProperties: true,
    },
    inputSchema: gmailThreadSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'gmail')
      const accessToken = await getValidGoogleAccessToken(integration)
      return unarchiveGmailThread(accessToken, input)
    },
  },
  {
    name: 'gmail.label_thread',
    actionType: 'label_gmail_thread',
    provider: 'gmail',
    title: 'Label Gmail thread',
    description: 'Apply one or more Gmail labels to an existing thread.',
    version: '2026-03-25',
    riskLevel: 'medium',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        threadId: { type: 'string' },
        labelNames: { type: 'array', items: { type: 'string' } },
      },
      required: ['threadId', 'labelNames'],
      additionalProperties: true,
    },
    inputSchema: gmailLabelSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'gmail')
      const accessToken = await getValidGoogleAccessToken(integration)
      return labelGmailThread(accessToken, input)
    },
  },
  {
    name: 'gmail.mark_thread_read',
    actionType: 'mark_gmail_thread_read',
    provider: 'gmail',
    title: 'Mark Gmail thread read',
    description: 'Mark a Gmail thread as read.',
    version: '2026-03-25',
    riskLevel: 'low',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        threadId: { type: 'string' },
      },
      required: ['threadId'],
      additionalProperties: true,
    },
    inputSchema: gmailThreadSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'gmail')
      const accessToken = await getValidGoogleAccessToken(integration)
      return setGmailThreadReadState(accessToken, input, { unread: false })
    },
  },
  {
    name: 'gmail.mark_thread_unread',
    actionType: 'mark_gmail_thread_unread',
    provider: 'gmail',
    title: 'Mark Gmail thread unread',
    description: 'Mark a Gmail thread as unread.',
    version: '2026-03-25',
    riskLevel: 'low',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        threadId: { type: 'string' },
      },
      required: ['threadId'],
      additionalProperties: true,
    },
    inputSchema: gmailThreadSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'gmail')
      const accessToken = await getValidGoogleAccessToken(integration)
      return setGmailThreadReadState(accessToken, input, { unread: true })
    },
  },
  {
    name: 'gmail.star_thread',
    actionType: 'star_gmail_thread',
    provider: 'gmail',
    title: 'Star Gmail thread',
    description: 'Star a Gmail thread.',
    version: '2026-03-26',
    riskLevel: 'low',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        threadId: { type: 'string' },
      },
      required: ['threadId'],
      additionalProperties: true,
    },
    inputSchema: gmailThreadSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'gmail')
      const accessToken = await getValidGoogleAccessToken(integration)
      return setGmailThreadStarredState(accessToken, input, { starred: true })
    },
  },
  {
    name: 'gmail.unstar_thread',
    actionType: 'unstar_gmail_thread',
    provider: 'gmail',
    title: 'Unstar Gmail thread',
    description: 'Remove the star from a Gmail thread.',
    version: '2026-03-26',
    riskLevel: 'low',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        threadId: { type: 'string' },
      },
      required: ['threadId'],
      additionalProperties: true,
    },
    inputSchema: gmailThreadSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'gmail')
      const accessToken = await getValidGoogleAccessToken(integration)
      return setGmailThreadStarredState(accessToken, input, { starred: false })
    },
  },
  {
    name: 'gmail.trash_thread',
    actionType: 'trash_gmail_thread',
    provider: 'gmail',
    title: 'Trash Gmail thread',
    description: 'Move a Gmail thread to trash.',
    version: '2026-03-26',
    riskLevel: 'high',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        threadId: { type: 'string' },
      },
      required: ['threadId'],
      additionalProperties: true,
    },
    inputSchema: gmailThreadSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'gmail')
      const accessToken = await getValidGoogleAccessToken(integration)
      return trashGmailThread(accessToken, input)
    },
  },
  {
    name: 'docs.create_document',
    actionType: 'create_google_doc',
    provider: 'google_docs',
    title: 'Create Google Doc',
    description: 'Create a Google Doc with prepared sections and content.',
    version: '2026-03-17',
    riskLevel: 'low',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        sections: { type: 'array', items: { type: 'string' } },
        sourcePrompt: { type: 'string' },
      },
      required: ['title'],
      additionalProperties: true,
    },
    inputSchema: createGoogleDocSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'google_docs')
      const accessToken = await getValidGoogleAccessToken(integration)
      return createGoogleDoc(accessToken, input)
    },
  },
  {
    name: 'docs.update_document',
    actionType: 'update_google_doc',
    provider: 'google_docs',
    title: 'Update Google Doc',
    description: 'Append or update deterministic content in a Google Doc.',
    version: '2026-03-17',
    riskLevel: 'medium',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['documentId', 'content'],
      additionalProperties: true,
    },
    inputSchema: updateGoogleDocSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'google_docs')
      const accessToken = await getValidGoogleAccessToken(integration)
      return updateGoogleDoc(accessToken, input)
    },
  },
  {
    name: 'drive.create_file',
    actionType: 'create_google_drive_file',
    provider: 'google_drive',
    title: 'Create Drive file',
    description: 'Create a Google Drive file or folder in-place without copying source data into Kova.',
    version: '2026-03-17',
    riskLevel: 'low',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        content: { type: 'string' },
        folderName: { type: 'string' },
        parentFolderId: { type: 'string' },
        mimeType: { type: 'string' },
      },
      required: ['name'],
      additionalProperties: true,
    },
    inputSchema: createGoogleDriveFileSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'google_drive')
      const accessToken = await getValidGoogleAccessToken(integration)
      return createGoogleDriveFile(accessToken, input)
    },
  },
  {
    name: 'drive.create_folder',
    actionType: 'create_google_drive_folder',
    provider: 'google_drive',
    title: 'Create Drive folder',
    description: 'Create a new Google Drive folder, optionally inside another folder.',
    version: '2026-03-26',
    riskLevel: 'low',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        folderName: { type: 'string' },
        parentFolderId: { type: 'string' },
      },
      required: ['name'],
      additionalProperties: true,
    },
    inputSchema: createGoogleDriveFolderSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'google_drive')
      const accessToken = await getValidGoogleAccessToken(integration)
      return createGoogleDriveFolder(accessToken, input)
    },
  },
  {
    name: 'drive.move_file',
    actionType: 'move_google_drive_file',
    provider: 'google_drive',
    title: 'Move Drive file',
    description: 'Move an existing Google Drive file or folder to a different folder.',
    version: '2026-03-25',
    riskLevel: 'medium',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        destinationFolderId: { type: 'string' },
        destinationFolderName: { type: 'string' },
      },
      required: ['fileId'],
      additionalProperties: true,
    },
    inputSchema: moveGoogleDriveFileSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'google_drive')
      const accessToken = await getValidGoogleAccessToken(integration)
      return moveGoogleDriveFile(accessToken, input)
    },
  },
  {
    name: 'drive.rename_file',
    actionType: 'rename_google_drive_file',
    provider: 'google_drive',
    title: 'Rename Drive file',
    description: 'Rename an existing Google Drive file or folder.',
    version: '2026-03-25',
    riskLevel: 'medium',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        name: { type: 'string' },
      },
      required: ['fileId', 'name'],
      additionalProperties: true,
    },
    inputSchema: renameGoogleDriveFileSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'google_drive')
      const accessToken = await getValidGoogleAccessToken(integration)
      return renameGoogleDriveFile(accessToken, input)
    },
  },
  {
    name: 'drive.share_file',
    actionType: 'share_google_drive_file',
    provider: 'google_drive',
    title: 'Share Drive file',
    description: 'Share a Google Drive file or folder with one or more recipients.',
    version: '2026-03-25',
    riskLevel: 'high',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        emails: { type: 'array', items: { type: 'string', format: 'email' } },
        role: { type: 'string', enum: ['reader', 'commenter', 'writer'] },
        notify: { type: 'boolean' },
        message: { type: 'string' },
      },
      required: ['fileId', 'emails'],
      additionalProperties: true,
    },
    inputSchema: shareGoogleDriveFileSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'google_drive')
      const accessToken = await getValidGoogleAccessToken(integration)
      return shareGoogleDriveFile(accessToken, input)
    },
  },
  {
    name: 'drive.copy_file',
    actionType: 'copy_google_drive_file',
    provider: 'google_drive',
    title: 'Copy Drive file',
    description: 'Copy an existing Google Drive file and optionally place the copy in another folder.',
    version: '2026-03-26',
    riskLevel: 'medium',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        name: { type: 'string' },
        destinationFolderId: { type: 'string' },
        destinationFolderName: { type: 'string' },
      },
      required: ['fileId'],
      additionalProperties: true,
    },
    inputSchema: copyGoogleDriveFileSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'google_drive')
      const accessToken = await getValidGoogleAccessToken(integration)
      return copyGoogleDriveFile(accessToken, input)
    },
  },
  {
    name: 'drive.unshare_file',
    actionType: 'unshare_google_drive_file',
    provider: 'google_drive',
    title: 'Unshare Drive file',
    description: 'Remove access to a Google Drive file or folder for one or more recipients.',
    version: '2026-03-26',
    riskLevel: 'high',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        emails: { type: 'array', items: { type: 'string', format: 'email' } },
      },
      required: ['fileId', 'emails'],
      additionalProperties: true,
    },
    inputSchema: unshareGoogleDriveFileSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'google_drive')
      const accessToken = await getValidGoogleAccessToken(integration)
      return unshareGoogleDriveFile(accessToken, input)
    },
  },
  {
    name: 'notion.create_page',
    actionType: 'create_notion_page',
    provider: 'notion',
    title: 'Create Notion page',
    description: 'Create a structured Notion page in-place in the connected workspace.',
    version: '2026-03-17',
    riskLevel: 'medium',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        parentPageId: { type: 'string' },
        parentDatabaseId: { type: 'string' },
        properties: { type: 'object' },
      },
      required: ['title'],
      additionalProperties: true,
    },
    inputSchema: createNotionPageSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'notion')
      const accessToken = getValidNotionAccessToken(integration)
      return createNotionPage(accessToken, input)
    },
  },
  {
    name: 'notion.update_page',
    actionType: 'update_notion_page',
    provider: 'notion',
    title: 'Update Notion page',
    description: 'Update a known Notion page with deterministic content.',
    version: '2026-03-17',
    riskLevel: 'medium',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['pageId', 'content'],
      additionalProperties: true,
    },
    inputSchema: updateNotionPageSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'notion')
      const accessToken = getValidNotionAccessToken(integration)
      return updateNotionPage(accessToken, input)
    },
  },
  {
    name: 'notion.update_page_properties',
    actionType: 'update_notion_page_properties',
    provider: 'notion',
    title: 'Update Notion properties',
    description: 'Update Notion page properties and optionally append content.',
    version: '2026-03-25',
    riskLevel: 'medium',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        properties: { type: 'object' },
        content: { type: 'string' },
      },
      required: ['pageId'],
      additionalProperties: true,
    },
    inputSchema: updateNotionPagePropertiesSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'notion')
      const accessToken = getValidNotionAccessToken(integration)
      return updateNotionPageProperties(accessToken, input)
    },
  },
  {
    name: 'notion.archive_page',
    actionType: 'archive_notion_page',
    provider: 'notion',
    title: 'Archive Notion page',
    description: 'Archive an existing Notion page.',
    version: '2026-03-26',
    riskLevel: 'high',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
      },
      required: ['pageId'],
      additionalProperties: true,
    },
    inputSchema: notionPageIdentifierSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'notion')
      const accessToken = getValidNotionAccessToken(integration)
      return archiveNotionPage(accessToken, input)
    },
  },
  {
    name: 'gmail.reply_email',
    actionType: 'reply_to_email',
    provider: 'gmail',
    title: 'Reply to email',
    description: 'Reply to an existing Gmail thread, preserving conversation context.',
    version: '2026-03-22',
    riskLevel: 'medium',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        threadId: { type: 'string' },
        messageId: { type: 'string' },
        to: { type: 'array', items: { type: 'string', format: 'email' } },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['threadId', 'messageId', 'to', 'subject', 'body'],
      additionalProperties: true,
    },
    inputSchema: replyToEmailSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'gmail')
      const accessToken = await getValidGoogleAccessToken(integration)
      return replyToGmailMessage(accessToken, input)
    },
  },
  {
    name: 'calendar.update_event',
    actionType: 'update_calendar_event',
    provider: 'calendar',
    title: 'Update calendar event',
    description: 'Modify an existing Google Calendar event (title, time, attendees, description).',
    version: '2026-03-22',
    riskLevel: 'medium',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        eventId: { type: 'string' },
        title: { type: 'string' },
        startTime: { type: 'string' },
        endTime: { type: 'string' },
        attendees: { type: 'array', items: { type: 'string', format: 'email' } },
        description: { type: 'string' },
      },
      required: ['eventId'],
      additionalProperties: true,
    },
    inputSchema: updateCalendarEventSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'calendar')
      const accessToken = await getValidGoogleAccessToken(integration)
      return updateGoogleCalendarEvent(accessToken, input)
    },
  },
  {
    name: 'calendar.delete_event',
    actionType: 'delete_calendar_event',
    provider: 'calendar',
    title: 'Delete calendar event',
    description: 'Permanently delete a Google Calendar event by its ID.',
    version: '2026-03-22',
    riskLevel: 'high',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        eventId: { type: 'string' },
      },
      required: ['eventId'],
      additionalProperties: true,
    },
    inputSchema: deleteCalendarEventSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'calendar')
      const accessToken = await getValidGoogleAccessToken(integration)
      return deleteGoogleCalendarEvent(accessToken, input)
    },
  },
  {
    name: 'drive.delete_file',
    actionType: 'delete_google_drive_file',
    provider: 'google_drive',
    title: 'Delete Drive file',
    description: 'Permanently delete a Google Drive file or folder by its ID.',
    version: '2026-03-22',
    riskLevel: 'high',
    deterministic: true,
    zeroDataMovement: true,
    inputSchemaJson: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
      },
      required: ['fileId'],
      additionalProperties: true,
    },
    inputSchema: deleteGoogleDriveFileSchema,
    execute: async (context, input) => {
      const integration = await getConnectedIntegration(context, 'google_drive')
      const accessToken = await getValidGoogleAccessToken(integration)
      return deleteGoogleDriveFile(accessToken, input)
    },
  },
]

export function listMcpTools() {
  return tools.map((tool) => ({
    name: tool.name,
    actionType: tool.actionType,
    provider: tool.provider,
    title: tool.title,
    description: tool.description,
    version: tool.version,
    riskLevel: tool.riskLevel,
    deterministic: tool.deterministic,
    zeroDataMovement: tool.zeroDataMovement,
    inputSchema: tool.inputSchemaJson,
  }))
}

export function getToolByActionType(actionType: DashboardAction['type']) {
  return tools.find((tool) => tool.actionType === actionType) || null
}

export function getToolByName(name: string) {
  return tools.find((tool) => tool.name === name) || null
}

export function prepareAndValidateToolInputByActionType(
  actionType: DashboardAction['type'],
  parameters: Record<string, unknown>
) {
  const tool = getToolByActionType(actionType)
  if (!tool) {
    throw new Error(`No MCP tool registered for action type "${actionType}".`)
  }

  const prepared = prepareActionParameters(actionType, parameters)
  const validated = tool.inputSchema.parse(prepared)

  return {
    tool,
    prepared,
    validated,
  }
}

export function prepareAndValidateToolInputByName(
  name: string,
  parameters: Record<string, unknown>
) {
  const tool = getToolByName(name)
  if (!tool) {
    throw new Error(`Unknown tool "${name}".`)
  }

  const prepared = prepareActionParameters(tool.actionType, parameters)
  const validated = tool.inputSchema.parse(prepared)

  return {
    tool,
    prepared,
    validated,
  }
}

export async function executeToolByActionType(params: {
  actionType: DashboardAction['type']
  parameters: Record<string, unknown>
  context: McpExecutionContext
}): Promise<IntegrationExecutionResult> {
  const { tool, validated } = prepareAndValidateToolInputByActionType(params.actionType, params.parameters)
  const execution = await tool.execute(params.context, validated)

  return {
    details: execution.details,
    output: {
      ...execution.output,
      toolName: tool.name,
      toolVersion: tool.version,
      deterministic: tool.deterministic,
      zeroDataMovement: tool.zeroDataMovement,
      provider: tool.provider,
    },
  }
}
