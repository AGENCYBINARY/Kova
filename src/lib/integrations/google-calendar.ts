import type { IntegrationExecutionResult } from '@/lib/integrations/types'
import {
  googleFetch,
  GOOGLE_READ_TIMEOUT_MS,
  GOOGLE_WRITE_TIMEOUT_MS,
} from '@/lib/integrations/google-http'

export interface GoogleCalendarEventSummary {
  id: string
  title: string
  startTime: string | null
  endTime: string | null
  attendees: string[]
  location: string | null
  htmlLink: string | null
  meetLink: string | null
  status: string | null
}

export interface GoogleCalendarAvailabilityWindow {
  startTime: string
  endTime: string
}

export async function listGoogleCalendarEvents(
  accessToken: string,
  options: {
    timeMin: string
    timeMax: string
    maxResults?: number
    query?: string
  }
) {
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events')
  url.searchParams.set('singleEvents', 'true')
  url.searchParams.set('orderBy', 'startTime')
  url.searchParams.set('timeMin', options.timeMin)
  url.searchParams.set('timeMax', options.timeMax)
  url.searchParams.set('maxResults', String(Math.max(1, Math.min(options.maxResults || 20, 50))))

  if (options.query?.trim()) {
    url.searchParams.set('q', options.query.trim())
  }

  const response = await googleFetch(
    url.toString(),
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 }
  )

  if (!response.ok) {
    throw new Error(`Calendar read failed: ${response.status}`)
  }

  const data = (await response.json()) as {
    items?: Array<{
      id: string
      summary?: string
      status?: string
      location?: string
      htmlLink?: string
      attendees?: Array<{ email?: string }>
      start?: { dateTime?: string; date?: string }
      end?: { dateTime?: string; date?: string }
      hangoutLink?: string
      conferenceData?: {
        entryPoints?: Array<{ entryPointType?: string; uri?: string }>
      }
    }>
  }

  return (data.items || []).map((item) => ({
    id: item.id,
    title: item.summary || '(untitled event)',
    startTime: item.start?.dateTime || item.start?.date || null,
    endTime: item.end?.dateTime || item.end?.date || null,
    attendees: (item.attendees || []).map((attendee) => attendee.email || '').filter(Boolean),
    location: item.location || null,
    htmlLink: item.htmlLink || null,
    meetLink:
      item.hangoutLink ||
      item.conferenceData?.entryPoints?.find((entryPoint) => entryPoint.entryPointType === 'video')?.uri ||
      null,
    status: item.status || null,
  })) satisfies GoogleCalendarEventSummary[]
}

export function computeCalendarAvailability(
  events: GoogleCalendarEventSummary[],
  options: {
    rangeStart: string
    rangeEnd: string
  }
) {
  const windows: GoogleCalendarAvailabilityWindow[] = []
  const sortedEvents = events
    .filter((event) => event.startTime && event.endTime)
    .sort((left, right) => new Date(left.startTime || 0).getTime() - new Date(right.startTime || 0).getTime())
  let cursor = new Date(options.rangeStart)
  const rangeEnd = new Date(options.rangeEnd)

  for (const event of sortedEvents) {
    const eventStart = new Date(event.startTime || cursor.toISOString())
    const eventEnd = new Date(event.endTime || eventStart.toISOString())

    if (eventStart > cursor) {
      windows.push({
        startTime: cursor.toISOString(),
        endTime: eventStart.toISOString(),
      })
    }

    if (eventEnd > cursor) {
      cursor = eventEnd
    }
  }

  if (cursor < rangeEnd) {
    windows.push({
      startTime: cursor.toISOString(),
      endTime: rangeEnd.toISOString(),
    })
  }

  return windows.filter((window) => new Date(window.endTime).getTime() > new Date(window.startTime).getTime())
}

export async function updateGoogleCalendarEvent(
  accessToken: string,
  parameters: Record<string, unknown>
): Promise<IntegrationExecutionResult> {
  const eventId = String(parameters.eventId || '')
  if (!eventId) throw new Error('eventId is required to update a calendar event.')

  const body: Record<string, unknown> = {}
  if (parameters.title) body.summary = parameters.title
  if (parameters.description || parameters.notes) body.description = String(parameters.description || parameters.notes || '')
  if (parameters.startTime) body.start = { dateTime: parameters.startTime }
  if (parameters.endTime) body.end = { dateTime: parameters.endTime }
  if (Array.isArray(parameters.attendees) && parameters.attendees.length > 0) {
    body.attendees = parameters.attendees.map((email) => ({ email }))
  }

  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`)
  if (Array.isArray(parameters.attendees) && parameters.attendees.length > 0) {
    url.searchParams.set('sendUpdates', 'all')
  }

  const response = await googleFetch(
    url.toString(),
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS }
  )

  if (!response.ok) {
    throw new Error(`Calendar event update failed: ${response.status}`)
  }

  const data = (await response.json()) as { id: string; htmlLink?: string; summary?: string }
  return {
    details: 'Calendar event updated.',
    output: {
      provider: 'google_calendar',
      eventId: data.id,
      title: data.summary || null,
      link: data.htmlLink || null,
    },
  }
}

export async function deleteGoogleCalendarEvent(
  accessToken: string,
  parameters: Record<string, unknown>
): Promise<IntegrationExecutionResult> {
  const eventId = String(parameters.eventId || '')
  if (!eventId) throw new Error('eventId is required to delete a calendar event.')

  const response = await googleFetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS }
  )

  if (!response.ok && response.status !== 204) {
    throw new Error(`Calendar event deletion failed: ${response.status}`)
  }

  return {
    details: 'Calendar event deleted.',
    output: { provider: 'google_calendar', eventId, deleted: true },
  }
}

export async function createGoogleCalendarEvent(
  accessToken: string,
  parameters: Record<string, unknown>
): Promise<IntegrationExecutionResult> {
  const shouldCreateMeetLink = Boolean(parameters.createMeetLink)
  const hasAttendees = Array.isArray(parameters.attendees) && parameters.attendees.length > 0
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events')

  if (shouldCreateMeetLink) {
    url.searchParams.set('conferenceDataVersion', '1')
  }

  if (hasAttendees) {
    url.searchParams.set('sendUpdates', 'all')
  }

  const response = await googleFetch(
    url.toString(),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: parameters.title || 'Kova event',
        description: parameters.description || parameters.notes || '',
        start: { dateTime: parameters.startTime },
        end: { dateTime: parameters.endTime },
        attendees: Array.isArray(parameters.attendees)
          ? parameters.attendees.map((email) => ({ email }))
          : [],
        ...(shouldCreateMeetLink
          ? {
              conferenceData: {
                createRequest: {
                  requestId: `kova-${Date.now()}`,
                  conferenceSolutionKey: {
                    type: 'hangoutsMeet',
                  },
                },
              },
            }
          : {}),
      }),
    },
    { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS }
  )

  if (!response.ok) {
    throw new Error(`Calendar event creation failed: ${response.status}`)
  }

  const data = (await response.json()) as {
    id: string
    htmlLink?: string
    hangoutLink?: string
    conferenceData?: {
      entryPoints?: Array<{ entryPointType?: string; uri?: string }>
    }
  }

  const meetLink =
    data.hangoutLink ||
    data.conferenceData?.entryPoints?.find((entryPoint) => entryPoint.entryPointType === 'video')?.uri ||
    null

  return {
    details: 'Event created in Google Calendar.',
    output: {
      provider: 'google_calendar',
      eventId: data.id,
      link: data.htmlLink || null,
      meetLink,
      meet_link: meetLink,
    },
  }
}
