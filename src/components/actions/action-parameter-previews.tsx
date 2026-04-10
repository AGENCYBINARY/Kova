'use client'

import { useLang } from '@/lib/lang-context'
import type { Lang } from '@/lib/i18n'
import type { Translations } from '@/lib/i18n'
import styles from './ActionProposalCard.module.css'

/** Matches server-side calendar default (Europe/Paris). */
const CALENDAR_PREVIEW_TZ = 'Europe/Paris'

export function formatDateTimeParis(iso: unknown, lang: Lang): string {
  if (typeof iso !== 'string' || !iso.trim()) {
    return '-'
  }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return String(iso)
  }
  const locale = lang === 'en' ? 'en-GB' : 'fr-FR'
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: CALENDAR_PREVIEW_TZ,
      timeZoneName: 'short',
    }).format(d)
  } catch {
    return iso
  }
}

function formatCalendarDateTimeForPreview(iso: unknown, lang: Lang): string {
  if (typeof iso !== 'string' || !iso.trim()) {
    return '-'
  }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return String(iso)
  }
  const locale = lang === 'en' ? 'en-GB' : 'fr-FR'
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: CALENDAR_PREVIEW_TZ,
      timeZoneName: 'short',
    }).format(d)
  } catch {
    return iso
  }
}

function isPlaceholderRecipient(value: string) {
  const normalized = value.trim().toLowerCase()
  return normalized === 'recipient@example.com' || normalized.endsWith('@example.com')
}

function formatConfidenceLabel(score: unknown, lang: Lang) {
  if (typeof score !== 'number') {
    return null
  }

  return lang === 'en' ? `${Math.round(score * 100)}% confidence` : `${Math.round(score * 100)}% de confiance`
}

function renderDisplayBody(body: string, lang: Lang) {
  if (!body) {
    return body
  }

  return body.replace(
    /\{\{\s*meet_?link\s*\}\}/gi,
    lang === 'en'
      ? '[The Google Meet link will be inserted automatically after the event is created.]'
      : "[Le lien Google Meet sera inséré automatiquement après la création de l'événement.]"
  )
}

export function getProposalDisplayCopy(params: {
  type: string
  title: string
  description: string
  parameters: Record<string, unknown>
  lang: Lang
}): { title: string; description: string } {
  const { type, title, description, parameters, lang } = params
  const resolvedContactName =
    typeof parameters.resolvedContactName === 'string' && parameters.resolvedContactName.trim()
      ? parameters.resolvedContactName.trim()
      : null
  const emailRecipients = Array.isArray(parameters.to)
    ? parameters.to.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  const hasPlaceholderRecipient = emailRecipients.some(isPlaceholderRecipient)
  const hasMeetPlaceholder =
    typeof parameters.body === 'string' && /\{\{\s*meet_?link\s*\}\}/i.test(parameters.body)
  const hasScheduledSend = typeof parameters.scheduledSendAt === 'string' && parameters.scheduledSendAt.trim().length > 0

  if (type === 'send_email' || type === 'create_gmail_draft' || type === 'update_gmail_draft') {
    if (lang === 'en') {
      return {
        title:
          type === 'create_gmail_draft'
            ? resolvedContactName
              ? `Prepare draft for ${resolvedContactName}`
              : 'Prepare email draft'
            : resolvedContactName
              ? `Send email to ${resolvedContactName}`
              : 'Prepare the email',
        description: hasPlaceholderRecipient
          ? 'Recipient still needs confirmation before this can be sent cleanly.'
          : hasMeetPlaceholder
            ? 'The message will carry the real Google Meet link once the calendar event exists.'
            : hasScheduledSend
              ? 'This send will leave your inbox at the scheduled time after you approve.'
              : 'Review the message details before execution.',
      }
    }

    return {
      title:
        type === 'create_gmail_draft'
          ? resolvedContactName
            ? `Préparer le brouillon pour ${resolvedContactName}`
            : 'Préparer le brouillon email'
          : resolvedContactName
            ? `Envoyer le mail à ${resolvedContactName}`
            : 'Préparer le mail',
      description: hasPlaceholderRecipient
        ? "Le destinataire doit encore être confirmé avant envoi."
        : hasMeetPlaceholder
          ? "Le message reprendra le vrai lien Google Meet dès que l'événement agenda sera créé."
          : hasScheduledSend
            ? "Après approbation, l'envoi partira à l'heure programmée."
            : 'Vérifie le contenu avant exécution.',
    }
  }

  if (type === 'create_calendar_event' || type === 'update_calendar_event') {
    const calendarTitle =
      typeof parameters.title === 'string' && parameters.title.trim()
        ? parameters.title.trim()
        : lang === 'en'
          ? 'Calendar invite'
          : 'Invitation agenda'

    return {
      title: calendarTitle,
      description:
        lang === 'en'
          ? 'Review the event details before it reaches Google Calendar.'
          : "Vérifie les détails avant envoi dans Google Calendar.",
    }
  }

  if (type === 'create_notion_page' || type === 'update_notion_page' || type === 'update_notion_page_properties') {
    const pageTitle =
      typeof parameters.title === 'string' && parameters.title.trim()
        ? parameters.title.trim()
        : typeof parameters.pageTitle === 'string' && parameters.pageTitle.trim()
          ? parameters.pageTitle.trim()
          : null
    if (lang === 'en') {
      return {
        title: pageTitle || (type === 'create_notion_page' ? 'Create Notion page' : 'Update Notion page'),
        description:
          type === 'update_notion_page_properties'
            ? 'Property updates for a database row or page — check values before sync.'
            : 'Structured Notion change prepared for review.',
      }
    }
    return {
      title: pageTitle || (type === 'create_notion_page' ? 'Créer une page Notion' : 'Mettre à jour Notion'),
      description:
        type === 'update_notion_page_properties'
          ? 'Mise à jour de propriétés (base ou page) — vérifie les champs avant envoi.'
          : 'Modification Notion structurée, prête à vérifier.',
    }
  }

  if (type === 'archive_notion_page') {
    return {
      title: lang === 'en' ? 'Archive Notion page' : 'Archiver une page Notion',
      description: lang === 'en' ? 'Page will be moved out of the default workspace view.' : 'La page sera retirée de la vue principale.',
    }
  }

  if (type === 'create_google_doc' || type === 'update_google_doc') {
    const docTitle =
      typeof parameters.title === 'string' && parameters.title.trim()
        ? parameters.title.trim()
        : typeof parameters.name === 'string' && parameters.name.trim()
          ? parameters.name.trim()
          : null
    return {
      title: docTitle || (lang === 'en' ? 'Google Doc' : 'Document Google'),
      description:
        lang === 'en'
          ? 'Doc content and structure will sync to Google Docs after approval.'
          : 'Le contenu sera synchronisé vers Google Docs après validation.',
    }
  }

  if (type === 'create_google_drive_file' || type === 'create_google_drive_folder') {
    const name =
      typeof parameters.name === 'string' && parameters.name.trim()
        ? parameters.name.trim()
        : typeof parameters.folderName === 'string'
          ? parameters.folderName.trim()
          : null
    return {
      title: name || (lang === 'en' ? 'Drive item' : 'Élément Drive'),
      description:
        lang === 'en'
          ? 'Creates or updates structured content in your Google Drive.'
          : 'Création ou mise à jour de contenu dans ton Google Drive.',
    }
  }

  if (
    type === 'move_google_drive_file' ||
    type === 'rename_google_drive_file' ||
    type === 'share_google_drive_file' ||
    type === 'copy_google_drive_file'
  ) {
    const map: Record<string, { en: string; fr: string }> = {
      move_google_drive_file: { en: 'Move Drive file', fr: 'Déplacer un fichier Drive' },
      rename_google_drive_file: { en: 'Rename Drive file', fr: 'Renommer un fichier Drive' },
      share_google_drive_file: { en: 'Share Drive file', fr: 'Partager un fichier Drive' },
      copy_google_drive_file: { en: 'Copy Drive file', fr: 'Copier un fichier Drive' },
    }
    const label = map[type]
    return {
      title: typeof parameters.name === 'string' && parameters.name.trim() ? parameters.name.trim() : lang === 'en' ? label.en : label.fr,
      description: lang === 'en' ? 'Check target folder, names, and permissions before execution.' : 'Vérifie dossier cible, noms et permissions avant exécution.',
    }
  }

  if (type === 'create_google_photos_picker_session') {
    return {
      title: lang === 'en' ? 'Choose photos in Google Photos' : 'Choisir des photos (Google Photos)',
      description:
        lang === 'en'
          ? 'Opens a secure picker so you can select the exact media for the next step.'
          : 'Ouvre un sélecteur sécurisé pour choisir les médias exacts pour la suite.',
    }
  }

  if (type === 'list_google_photos_media' || type === 'search_google_photos_media') {
    return {
      title: lang === 'en' ? 'Read Google Photos library' : 'Lire la bibliothèque Google Photos',
      description:
        lang === 'en'
          ? 'Lists or searches your library based on the query below (read-only).'
          : 'Liste ou recherche dans ta bibliothèque selon la requête (lecture seule).',
    }
  }

  return { title, description }
}

function renderEmailPreview(
  parameters: Record<string, unknown>,
  t: Translations['proposal'],
  lang: Lang
) {
  const recipients = Array.isArray(parameters.to)
    ? parameters.to
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => (isPlaceholderRecipient(value) ? t.noRecipient : value))
        .join(', ')
    : ''
  const subject = typeof parameters.subject === 'string' ? parameters.subject : ''
  const body = typeof parameters.body === 'string' ? parameters.body : ''
  const confidenceScore = formatConfidenceLabel(parameters.confidenceScore, lang)
  const scheduledRaw = typeof parameters.scheduledSendAt === 'string' ? parameters.scheduledSendAt.trim() : ''
  const scheduledLabel = scheduledRaw ? formatDateTimeParis(scheduledRaw, lang) : null
  return (
    <div className={styles.previewBlock}>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{t.to}</span>
        <span className={styles.previewValue}>{recipients || t.noRecipient}</span>
      </div>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{t.subject}</span>
        <span className={styles.previewValue}>{subject || t.noSubject}</span>
      </div>
      {scheduledLabel ? (
        <div className={styles.previewRow}>
          <span className={styles.previewLabel}>{t.scheduledSend}</span>
          <span className={styles.previewValue}>{scheduledLabel}</span>
        </div>
      ) : null}
      {confidenceScore ? <div className={styles.previewMeta}>{confidenceScore}</div> : null}
      <div className={styles.previewBody}>{renderDisplayBody(body, lang) || t.emptyBody}</div>
    </div>
  )
}

function renderCalendarPreview(parameters: Record<string, unknown>, t: Translations['proposal'], lang: Lang) {
  const attendees = Array.isArray(parameters.attendees)
    ? parameters.attendees.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : []
  const hasMeet = Boolean(parameters.createMeetLink)
  const startLabel = formatCalendarDateTimeForPreview(parameters.startTime, lang)
  const endLabel = formatCalendarDateTimeForPreview(parameters.endTime, lang)
  return (
    <div className={styles.previewBlock}>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{t.title}</span>
        <span className={styles.previewValue}>{String(parameters.title || 'Meeting')}</span>
      </div>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{t.start}</span>
        <span className={styles.previewValue}>{startLabel}</span>
      </div>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{t.end}</span>
        <span className={styles.previewValue}>{endLabel}</span>
      </div>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{t.attendees}</span>
        <span className={styles.previewValue}>{attendees.length > 0 ? attendees.join(', ') : t.noAttendees}</span>
      </div>
      <div className={styles.previewMeta}>{hasMeet ? t.meetActive : t.noMeet}</div>
    </div>
  )
}

function renderDrivePreview(parameters: Record<string, unknown>, t: Translations['proposal']) {
  const name = typeof parameters.name === 'string' ? parameters.name : 'Untitled file'
  const folderName = typeof parameters.folderName === 'string' ? parameters.folderName : null
  const mimeType = typeof parameters.mimeType === 'string' ? parameters.mimeType : 'text/plain'
  const content = typeof parameters.content === 'string' ? parameters.content : ''
  const isFolder = mimeType === 'application/vnd.google-apps.folder'
  return (
    <div className={styles.previewBlock}>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{isFolder ? t.folder : t.name}</span>
        <span className={styles.previewValue}>{name}</span>
      </div>
      {!isFolder ? (
        <div className={styles.previewRow}>
          <span className={styles.previewLabel}>{t.format}</span>
          <span className={styles.previewValue}>{mimeType}</span>
        </div>
      ) : null}
      {folderName ? (
        <div className={styles.previewRow}>
          <span className={styles.previewLabel}>{t.location}</span>
          <span className={styles.previewValue}>{folderName}</span>
        </div>
      ) : null}
      {content ? <div className={styles.previewBody}>{content}</div> : null}
    </div>
  )
}

function renderDriveFolderPreview(parameters: Record<string, unknown>, t: Translations['proposal']) {
  const folderName =
    typeof parameters.name === 'string'
      ? parameters.name
      : typeof parameters.folderName === 'string'
        ? parameters.folderName
        : 'Untitled folder'
  const parentLabel =
    typeof parameters.parentFolderName === 'string'
      ? parameters.parentFolderName
      : typeof parameters.folderPath === 'string'
        ? parameters.folderPath
        : ''

  return (
    <div className={styles.previewBlock}>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{t.folder}</span>
        <span className={styles.previewValue}>{folderName}</span>
      </div>
      {parentLabel ? (
        <div className={styles.previewRow}>
          <span className={styles.previewLabel}>{t.location}</span>
          <span className={styles.previewValue}>{parentLabel}</span>
        </div>
      ) : null}
    </div>
  )
}

function renderDocPreview(parameters: Record<string, unknown>, t: Translations['proposal'], docLabel: string) {
  const title =
    typeof parameters.title === 'string'
      ? parameters.title
      : typeof parameters.name === 'string'
        ? parameters.name
        : docLabel
  const content =
    typeof parameters.content === 'string'
      ? parameters.content
      : typeof parameters.body === 'string'
        ? parameters.body
        : typeof parameters.prompt === 'string'
          ? parameters.prompt
          : ''
  const sections = Array.isArray(parameters.sections) ? parameters.sections.filter((s): s is string => typeof s === 'string') : []

  return (
    <div className={styles.previewBlock}>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{t.docHeading}</span>
        <span className={styles.previewValue}>{title}</span>
      </div>
      {sections.length > 0 ? (
        <div className={styles.previewRow}>
          <span className={styles.previewLabel}>{t.sections}</span>
          <span className={styles.previewValue}>{sections.join(' · ')}</span>
        </div>
      ) : null}
      {content ? <div className={styles.previewBody}>{content}</div> : null}
    </div>
  )
}

function renderNotionPreview(parameters: Record<string, unknown>, t: Translations['proposal']) {
  const title =
    typeof parameters.title === 'string'
      ? parameters.title
      : typeof parameters.pageTitle === 'string'
        ? parameters.pageTitle
        : typeof parameters.databaseTitle === 'string'
          ? parameters.databaseTitle
          : 'Notion'
  const body =
    typeof parameters.content === 'string'
      ? parameters.content
      : typeof parameters.body === 'string'
        ? parameters.body
        : typeof parameters.summary === 'string'
          ? parameters.summary
          : ''

  return (
    <div className={styles.previewBlock}>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{t.notionPage}</span>
        <span className={styles.previewValue}>{title}</span>
      </div>
      {body ? <div className={styles.previewBody}>{body}</div> : null}
    </div>
  )
}

function renderNotionPropertiesPreview(parameters: Record<string, unknown>, t: Translations['proposal']) {
  const props = parameters.properties
  let propsText = ''
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    propsText = Object.entries(props as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join('\n')
  }
  const content = typeof parameters.content === 'string' ? parameters.content : ''

  return (
    <div className={styles.previewBlock}>
      {propsText ? (
        <>
          <div className={styles.previewRow}>
            <span className={styles.previewLabel}>{t.notionProperties}</span>
          </div>
          <div className={styles.previewBody}>{propsText}</div>
        </>
      ) : null}
      {content ? (
        <>
          <div className={styles.previewRow}>
            <span className={styles.previewLabel}>{t.docHeading}</span>
          </div>
          <div className={styles.previewBody}>{content}</div>
        </>
      ) : null}
    </div>
  )
}

function renderDriveOperationPreview(parameters: Record<string, unknown>, type: string, t: Translations['proposal']) {
  const fileHint =
    typeof parameters.name === 'string'
      ? parameters.name
      : typeof parameters.fileId === 'string'
        ? parameters.fileId.slice(0, 12) + '…'
        : '—'
  const dest =
    typeof parameters.destinationFolderName === 'string'
      ? parameters.destinationFolderName
      : typeof parameters.destinationFolderPath === 'string'
        ? parameters.destinationFolderPath
        : typeof parameters.destinationFolderId === 'string'
          ? parameters.destinationFolderId.slice(0, 12) + '…'
          : ''
  const emails = Array.isArray(parameters.emails)
    ? parameters.emails.filter((e): e is string => typeof e === 'string')
    : []
  const role = typeof parameters.role === 'string' ? parameters.role : ''

  return (
    <div className={styles.previewBlock}>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{t.name}</span>
        <span className={styles.previewValue}>{fileHint}</span>
      </div>
      {(type === 'move_google_drive_file' || type === 'copy_google_drive_file') && dest ? (
        <div className={styles.previewRow}>
          <span className={styles.previewLabel}>{t.destination}</span>
          <span className={styles.previewValue}>{dest}</span>
        </div>
      ) : null}
      {type === 'share_google_drive_file' && emails.length > 0 ? (
        <>
          <div className={styles.previewRow}>
            <span className={styles.previewLabel}>{t.shareWith}</span>
            <span className={styles.previewValue}>{emails.join(', ')}</span>
          </div>
          {role ? (
            <div className={styles.previewRow}>
              <span className={styles.previewLabel}>{t.role}</span>
              <span className={styles.previewValue}>{role}</span>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function renderGooglePhotosPickerPreview(lang: Lang) {
  return (
    <div className={styles.previewBlock}>
      <div className={styles.previewBody}>
        {lang === 'en'
          ? 'Opens a secure Google Photos picker session so you can choose the exact media for the workflow.'
          : 'Ouvre une session sélecteur Google Photos sécurisée pour choisir les médias exacts.'}
      </div>
    </div>
  )
}

function renderPhotosSearchPreview(parameters: Record<string, unknown>, t: Translations['proposal']) {
  const q = typeof parameters.query === 'string' ? parameters.query : ''
  return (
    <div className={styles.previewBlock}>
      <div className={styles.previewRow}>
        <span className={styles.previewLabel}>{t.photosQuery}</span>
        <span className={styles.previewValue}>{q || '—'}</span>
      </div>
    </div>
  )
}

function renderGenericActionSummary(parameters: Record<string, unknown>) {
  const visibleEntries = Object.entries(parameters)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 8)

  return (
    <div className={styles.previewBlock}>
      {visibleEntries.map(([key, value]) => (
        <div key={key} className={styles.previewRow}>
          <span className={styles.previewLabel}>{key}</span>
          <span className={styles.previewValue}>
            {Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value)}
          </span>
        </div>
      ))}
    </div>
  )
}

export interface ActionParametersPreviewProps {
  type: string
  parameters: Record<string, unknown>
  /** When true, append collapsible-style raw JSON for power users */
  showRawJson?: boolean
}

export function ActionParametersPreview({ type, parameters, showRawJson = false }: ActionParametersPreviewProps) {
  const { t, lang } = useLang()

  const renderPreview = () => {
    if (type === 'send_email' || type === 'create_gmail_draft' || type === 'update_gmail_draft' || type === 'reply_to_email' || type === 'forward_email') {
      return renderEmailPreview(parameters, t.proposal, lang)
    }
    if (type === 'create_calendar_event' || type === 'update_calendar_event') {
      return renderCalendarPreview(parameters, t.proposal, lang)
    }
    if (type === 'create_google_drive_file') {
      return renderDrivePreview(parameters, t.proposal)
    }
    if (type === 'create_google_drive_folder') {
      return renderDriveFolderPreview(parameters, t.proposal)
    }
    if (type === 'create_google_doc' || type === 'update_google_doc') {
      return renderDocPreview(parameters, t.proposal, lang === 'en' ? 'Google Doc' : 'Document Google')
    }
    if (type === 'create_notion_page' || type === 'update_notion_page' || type === 'archive_notion_page') {
      return renderNotionPreview(parameters, t.proposal)
    }
    if (type === 'update_notion_page_properties') {
      return renderNotionPropertiesPreview(parameters, t.proposal)
    }
    if (type === 'move_google_drive_file' || type === 'rename_google_drive_file' || type === 'share_google_drive_file' || type === 'copy_google_drive_file') {
      return renderDriveOperationPreview(parameters, type, t.proposal)
    }
    if (type === 'create_google_photos_picker_session') {
      return renderGooglePhotosPickerPreview(lang)
    }
    if (type === 'list_google_photos_media' || type === 'search_google_photos_media') {
      return renderPhotosSearchPreview(parameters, t.proposal)
    }
    return renderGenericActionSummary(parameters)
  }

  return (
    <>
      {renderPreview()}
      {showRawJson ? (
        <div className={styles.parametersCompact}>
          <p className={styles.paramsTitle}>{t.proposal.technicalJson}</p>
          <pre className={styles.paramsJson}>{JSON.stringify(parameters, null, 2)}</pre>
        </div>
      ) : null}
    </>
  )
}
