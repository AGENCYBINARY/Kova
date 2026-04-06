import type { DashboardAction } from '@/lib/dashboard-data'

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeMultiline(value: string) {
  return value
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.includes('\n') ? normalizeMultiline(value) : collapseWhitespace(value)
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeValue(item))
      .filter((item) => item !== '' && item !== null && item !== undefined)
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, normalizeValue(nestedValue)])
    )
  }

  return value
}

export function prepareActionParameters(
  actionType: DashboardAction['type'],
  parameters: Record<string, unknown>
): Record<string, unknown> {
  const normalized = normalizeValue(parameters) as Record<string, unknown>

  if (actionType === 'create_google_doc') {
    return {
      ...normalized,
      title: typeof normalized.title === 'string' ? collapseWhitespace(normalized.title) : 'Kova document',
      sections: Array.isArray(normalized.sections)
        ? normalized.sections.filter((value): value is string => typeof value === 'string' && value.length > 0)
        : [],
    }
  }

  if (actionType === 'send_email' || actionType === 'create_gmail_draft' || actionType === 'update_gmail_draft') {
    return {
      ...normalized,
      subject: typeof normalized.subject === 'string' ? collapseWhitespace(normalized.subject) : 'Kova message',
      body: typeof normalized.body === 'string' ? normalizeMultiline(normalized.body) : '',
    }
  }

  if (actionType === 'forward_email') {
    return {
      ...normalized,
      note: typeof normalized.note === 'string' ? normalizeMultiline(normalized.note) : '',
    }
  }

  if (actionType === 'label_gmail_thread' || actionType === 'remove_gmail_thread_labels') {
    return {
      ...normalized,
      labelNames: Array.isArray(normalized.labelNames)
        ? normalized.labelNames.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [],
    }
  }

  if (actionType === 'rename_google_drive_file') {
    return {
      ...normalized,
      name: typeof normalized.name === 'string' ? collapseWhitespace(normalized.name) : 'Renamed file',
    }
  }

  if (actionType === 'create_google_drive_folder') {
    return {
      ...normalized,
      name: typeof normalized.name === 'string' ? collapseWhitespace(normalized.name) : 'New folder',
      folderName: typeof normalized.folderName === 'string' ? collapseWhitespace(normalized.folderName) : normalized.folderName,
      folderPath: typeof normalized.folderPath === 'string' ? collapseWhitespace(normalized.folderPath) : normalized.folderPath,
      parentFolderId:
        typeof normalized.parentFolderId === 'string'
          ? collapseWhitespace(normalized.parentFolderId)
          : normalized.parentFolderId,
    }
  }

  if (actionType === 'create_google_drive_appdata_file' || actionType === 'update_google_drive_appdata_file') {
    return {
      ...normalized,
      name: typeof normalized.name === 'string' ? collapseWhitespace(normalized.name) : 'kova-config.json',
      content: typeof normalized.content === 'string' ? normalizeMultiline(normalized.content) : '{}',
    }
  }

  if (actionType === 'share_google_drive_file') {
    return {
      ...normalized,
      message: typeof normalized.message === 'string' ? normalizeMultiline(normalized.message) : '',
    }
  }

  if (actionType === 'copy_google_drive_file') {
    return {
      ...normalized,
      name: typeof normalized.name === 'string' ? collapseWhitespace(normalized.name) : normalized.name,
      destinationFolderId:
        typeof normalized.destinationFolderId === 'string'
          ? collapseWhitespace(normalized.destinationFolderId)
          : normalized.destinationFolderId,
      destinationFolderName:
        typeof normalized.destinationFolderName === 'string'
          ? collapseWhitespace(normalized.destinationFolderName)
          : normalized.destinationFolderName,
      destinationFolderPath:
        typeof normalized.destinationFolderPath === 'string'
          ? collapseWhitespace(normalized.destinationFolderPath)
          : normalized.destinationFolderPath,
    }
  }

  if (actionType === 'update_calendar_event') {
    return {
      ...normalized,
      title: typeof normalized.title === 'string' ? collapseWhitespace(normalized.title) : normalized.title,
      description:
        typeof normalized.description === 'string' ? normalizeMultiline(normalized.description) : normalized.description,
      relativeShiftMinutes:
        typeof normalized.relativeShiftMinutes === 'number' && Number.isFinite(normalized.relativeShiftMinutes)
          ? Math.trunc(normalized.relativeShiftMinutes)
          : normalized.relativeShiftMinutes,
    }
  }

  if (actionType === 'move_google_drive_file') {
    return {
      ...normalized,
      destinationFolderId:
        typeof normalized.destinationFolderId === 'string'
          ? collapseWhitespace(normalized.destinationFolderId)
          : normalized.destinationFolderId,
      destinationFolderName:
        typeof normalized.destinationFolderName === 'string'
          ? collapseWhitespace(normalized.destinationFolderName)
          : normalized.destinationFolderName,
      destinationFolderPath:
        typeof normalized.destinationFolderPath === 'string'
          ? collapseWhitespace(normalized.destinationFolderPath)
          : normalized.destinationFolderPath,
    }
  }

  if (actionType === 'unshare_google_drive_file') {
    return {
      ...normalized,
      emails: Array.isArray(normalized.emails)
        ? normalized.emails.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [],
    }
  }

  return normalized
}
