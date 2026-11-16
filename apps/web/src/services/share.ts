import type { SyncSessionPayload } from '@sweet-deepseek/contracts/sync'
import { SHARE_TOKEN_PATTERN } from '@sweet-deepseek/contracts/share'
import { getVisibleMessages, normalizeSession } from './chat/branches.js'
import type { Session } from './chat/types.js'

export const toShareSessionPayload = (session: Session): SyncSessionPayload => ({
  schemaVersion: 1,
  id: session.id,
  title: session.title,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  messages: getVisibleMessages(session).map((message) => {
    const sharedMessage = { ...message }
    delete sharedMessage.parentId
    delete sharedMessage.selectedChildId
    return sharedMessage
  }) as SyncSessionPayload['messages'],
})

export const fromSharedSessionPayload = (payload: SyncSessionPayload): Session =>
  normalizeSession({
    id: payload.id,
    title: payload.title,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    messages: payload.messages as Session['messages'],
    rootMessageId: payload.rootMessageId,
  })

export const readShareToken = (): string | null => {
  if (typeof window === 'undefined') {
    return null
  }
  const token = new URL(window.location.href).searchParams.get('share')
  return token && SHARE_TOKEN_PATTERN.test(token) ? token : null
}
