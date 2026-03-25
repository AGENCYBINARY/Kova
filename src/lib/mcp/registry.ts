import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import type { DashboardAction } from '@/lib/dashboard-data'
import { prepareActionParameters } from '@/lib/agent/data-prep'
import {
  createGoogleCalendarEvent,
  createGoogleDoc,
  createGoogleDriveFile,
  deleteGoogleCalendarEvent,
  deleteGoogleDriveFile,
  getValidGoogleAccessToken,
  readGmailMessageBody,
  replyToGmailMessage,
  sendGmailMessage,
  updateGoogleCalendarEvent,
  updateGoogleDoc,
} from '@/lib/integrations/google'
import {
  createNotionPage,
  getValidNotionAccessToken,
  updateNotionPage,
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
  mimeType: z.string().optional(),
}).passthrough()

const createNotionPageSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  parentPageId: z.string().optional(),
}).passthrough()

const updateNotionPageSchema = z.object({
  pageId: z.string().min(1),
  content: z.string().min(1),
}).passthrough()

const replyToEmailSchema = z.object({
  threadId: z.string().min(1),
  messageId: z.string().min(1),
  to: z.array(z.string().email()).min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
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
      },
      required: ['title', 'content'],
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
