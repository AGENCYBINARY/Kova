export type {
  GmailMessageSummary,
  GmailThreadSummary,
} from '@/lib/integrations/google'

export {
  archiveGmailThread,
  createGmailDraft,
  deleteGmailThreadPermanently,
  findGoogleContactEmail,
  forwardGmailMessage,
  labelGmailThread,
  listTodayGmailMessages,
  readGmailMessageBody,
  removeGmailThreadLabels,
  replyToGmailMessage,
  searchGmailMessages,
  sendGmailDraft,
  sendGmailMessage,
  setGmailThreadReadState,
  setGmailThreadStarredState,
  summarizeGmailThreads,
  trashGmailThread,
  unarchiveGmailThread,
  updateGmailDraft,
} from '@/lib/integrations/google'
