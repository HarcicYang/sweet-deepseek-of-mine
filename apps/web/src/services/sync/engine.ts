import {
  SYNC_SCHEMA_VERSION,
  type SyncSettingsRecord,
  type SyncSessionPayload,
  type SyncSessionRecord,
  type SyncSessionSummary,
} from '@sweet-deepseek/contracts/sync'
import { create } from 'zustand'
import { translate } from '../../i18n/index.js'
import { createId } from '../../utils/id.js'
import {
  ApiError,
  clearCloudSessions,
  deleteCloudSession,
  getCloudSession,
  getCloudSettings,
  listCloudSessions,
  putCloudSettings,
  putCloudSession,
} from '../api/client.js'
import { normalizeSession } from '../chat/branches.js'
import * as db from '../chat/db.js'
import type { Session, SessionSummary } from '../chat/types.js'
import {
  SETTINGS_CHANGED_EVENT,
  applySyncedSettings,
  getSyncedSettings,
  prepareSyncedSettingsForUser,
} from '../settings.js'
import type { SyncOutboxRecord, SyncStateRecord } from './types.js'

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error'

type SyncRuntimeState = {
  status: SyncStatus
  pending: number
  lastSyncedAt: number | null
  error: string | null
}

export const useSync = create<SyncRuntimeState>(() => ({
  status: 'idle',
  pending: 0,
  lastSyncedAt: null,
  error: null,
}))

let userId: string | null = null
let activeSync: Promise<void> | null = null
let scheduled: ReturnType<typeof setTimeout> | null = null
let retryDelay = 5000
let listenersBound = false
let settingsOutboxQueue: Promise<void> = Promise.resolve()

const notifyApplied = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('sdom:sync-applied'))
  }
}

const notifyConflict = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('sdom:sync-conflict'))
  }
}

const updatePending = async () => {
  const [outbox, settings] = await Promise.all([db.listSyncOutbox(), db.getSettingsSyncState()])
  const pending = outbox.length + (settings?.pending ? 1 : 0)
  useSync.setState({ pending })
}

const schedule = (delay: number) => {
  if (!userId) {
    return
  }
  if (scheduled) {
    clearTimeout(scheduled)
  }
  scheduled = setTimeout(() => {
    scheduled = null
    void syncNow()
  }, delay)
}

const stateFromRecord = (record: SyncSessionRecord): SyncStateRecord => ({
  sessionId: record.id,
  revision: record.revision,
  clientUpdatedAt: record.clientUpdatedAt,
  deletedAt: record.deletedAt,
})

const toPayload = (session: Session): SyncSessionPayload => ({
  schemaVersion: SYNC_SCHEMA_VERSION,
  ...session,
})

const toLocalSession = (payload: SyncSessionPayload): Session => {
  return normalizeSession({
    id: payload.id,
    title: payload.title,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    messages: payload.messages as Session['messages'],
    rootMessageId: payload.rootMessageId,
  })
}

const conflictCopy = (session: Session): Session => {
  const now = Date.now()
  return {
    ...session,
    id: createId(),
    title: translate('syncConflictCopyTitle', {
      title: session.title || translate('untitledChat'),
    }),
    createdAt: now,
    updatedAt: now,
  }
}

const saveConflictCopy = async (session: Session) => {
  const copy = conflictCopy(session)
  await db.saveSession(copy)
  await db.putSyncOutbox({
    sessionId: copy.id,
    operation: 'upsert',
    baseRevision: 0,
    queuedAt: Date.now(),
  })
  notifyConflict()
  notifyApplied()
  schedule(0)
}

const baseRevisionFor = async (sessionId: string) =>
  (await db.getSyncState(sessionId))?.revision ?? 0

const settingsStateFromRecord = (record: SyncSettingsRecord) => ({
  key: 'settings' as const,
  revision: record.revision,
  clientUpdatedAt: record.payload.updatedAt,
  pending: false,
  baseRevision: record.revision,
  queuedAt: null,
})

const queueSettingsUpsert = (): Promise<void> => {
  if (!userId) {
    return Promise.resolve()
  }
  const operation = settingsOutboxQueue.then(async () => {
    const current = await db.getSettingsSyncState()
    const payload = getSyncedSettings()
    await db.putSettingsSyncState({
      key: 'settings',
      revision: current?.revision ?? 0,
      clientUpdatedAt: payload.updatedAt,
      pending: true,
      baseRevision: current?.pending ? current.baseRevision : (current?.revision ?? 0),
      queuedAt: Date.now(),
    })
    await updatePending()
    schedule(500)
  })
  settingsOutboxQueue = operation.catch(() => undefined)
  return operation
}

const applyRemoteSettings = async (record: SyncSettingsRecord): Promise<boolean> => {
  if (getSyncedSettings().updatedAt > record.payload.updatedAt) {
    return false
  }
  applySyncedSettings(record.payload)
  await db.putSettingsSyncState(settingsStateFromRecord(record))
  return true
}

const savePushedSettings = async (record: SyncSettingsRecord, pushedUpdatedAt: number) => {
  const changedAgain = getSyncedSettings().updatedAt !== pushedUpdatedAt
  await db.putSettingsSyncState({
    ...settingsStateFromRecord(record),
    pending: changedAgain,
    queuedAt: changedAgain ? Date.now() : null,
  })
  if (changedAgain) {
    schedule(0)
  }
}

const syncSettings = async (): Promise<void> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [state, remote] = await Promise.all([db.getSettingsSyncState(), getCloudSettings()])
    const local = getSyncedSettings()

    let baseRevision: number | null = null
    if (state?.pending) {
      if (!remote || state.baseRevision === remote.revision) {
        baseRevision = remote?.revision ?? 0
      } else if (local.updatedAt > remote.payload.updatedAt) {
        baseRevision = remote.revision
      }
    } else if (!remote) {
      baseRevision = local.updatedAt > 0 ? 0 : null
    } else if (local.updatedAt > remote.payload.updatedAt) {
      baseRevision = remote.revision
    }

    if (baseRevision !== null) {
      try {
        const saved = await putCloudSettings(baseRevision, local)
        await savePushedSettings(saved, local.updatedAt)
        return
      } catch (error) {
        if (error instanceof ApiError && error.code === 'sync_conflict') {
          continue
        }
        throw error
      }
    }

    if (!remote) {
      return
    }
    if (!(await applyRemoteSettings(remote))) {
      continue
    }
    return
  }
  throw new Error('Settings sync did not converge')
}

export const queueSessionUpsert = async (sessionId: string) => {
  const existing = (await db.listSyncOutbox()).find((record) => record.sessionId === sessionId)
  await db.putSyncOutbox({
    sessionId,
    operation: 'upsert',
    baseRevision: existing?.baseRevision ?? (await baseRevisionFor(sessionId)),
    queuedAt: Date.now(),
  })
  await updatePending()
  schedule(500)
}

export const queueSessionDelete = async (sessionId: string) => {
  const existing = (await db.listSyncOutbox()).find((record) => record.sessionId === sessionId)
  const state = await db.getSyncState(sessionId)
  if (!state && existing?.operation === 'upsert') {
    await db.deleteSyncOutbox(sessionId)
    await updatePending()
    return
  }
  await db.putSyncOutbox({
    sessionId,
    operation: 'delete',
    baseRevision: state?.revision ?? existing?.baseRevision ?? 0,
    queuedAt: Date.now(),
  })
  await updatePending()
  schedule(500)
}

export const queueCloudReset = async () => {
  await db.clearSyncData()
  await db.setSyncMeta('reset', true)
  await updatePending()
  schedule(0)
}

const resolveUpsertConflict = async (
  local: Session,
  outbox: SyncOutboxRecord
): Promise<boolean> => {
  const remote = await getCloudSession(local.id)
  if (local.updatedAt >= remote.clientUpdatedAt) {
    if (remote.payload) {
      await saveConflictCopy(toLocalSession(remote.payload))
    }
    const saved = await putCloudSession(local.id, remote.revision, toPayload(local))
    await db.putSyncState(stateFromRecord(saved))
    await db.deleteSyncOutbox(local.id)
    return true
  }

  await saveConflictCopy(local)
  if (remote.payload) {
    await db.saveSession(toLocalSession(remote.payload))
  } else {
    await db.deleteSession(local.id)
  }
  await db.putSyncState(stateFromRecord(remote))
  await db.deleteSyncOutbox(outbox.sessionId)
  return true
}

const resolveDeleteConflict = async (outbox: SyncOutboxRecord): Promise<boolean> => {
  const remote = await getCloudSession(outbox.sessionId)
  if (remote.payload) {
    await db.saveSession(toLocalSession(remote.payload))
  } else {
    await db.deleteSession(outbox.sessionId)
  }
  await db.putSyncState(stateFromRecord(remote))
  await db.deleteSyncOutbox(outbox.sessionId)
  notifyConflict()
  notifyApplied()
  return true
}

const pushOutbox = async (): Promise<boolean> => {
  let conflicted = false
  const records = (await db.listSyncOutbox()).sort((a, b) => a.queuedAt - b.queuedAt)
  for (const outbox of records) {
    if (outbox.operation === 'upsert') {
      const local = await db.loadSession(outbox.sessionId)
      if (!local) {
        await db.deleteSyncOutbox(outbox.sessionId)
        continue
      }
      try {
        const saved = await putCloudSession(local.id, outbox.baseRevision, toPayload(local))
        await db.putSyncState(stateFromRecord(saved))
        await db.deleteSyncOutbox(local.id)
      } catch (error) {
        if (error instanceof ApiError && error.code === 'sync_conflict') {
          conflicted = (await resolveUpsertConflict(local, outbox)) || conflicted
          continue
        }
        throw error
      }
      continue
    }

    try {
      const deleted = await deleteCloudSession(
        outbox.sessionId,
        outbox.baseRevision,
        outbox.queuedAt
      )
      await db.putSyncState(stateFromRecord(deleted))
      await db.deleteSyncOutbox(outbox.sessionId)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'sync_conflict') {
        conflicted = (await resolveDeleteConflict(outbox)) || conflicted
        continue
      }
      throw error
    }
  }
  return conflicted
}

const summaryFromRemote = (
  remote: SyncSessionSummary,
  existing?: SessionSummary
): SessionSummary => ({
  id: remote.id,
  title: remote.title,
  createdAt: existing?.createdAt ?? remote.clientUpdatedAt,
  updatedAt: remote.clientUpdatedAt,
})

const pullRemote = async (): Promise<void> => {
  const [remoteSessions, localSessions, states, outbox] = await Promise.all([
    listCloudSessions(),
    db.loadSessionSummaries(),
    db.listSyncStates(),
    db.listSyncOutbox(),
  ])
  const localById = new Map(localSessions.map((session) => [session.id, session]))
  const stateById = new Map(states.map((state) => [state.sessionId, state]))
  const pendingIds = new Set(outbox.map((record) => record.sessionId))
  const remoteIds = new Set(remoteSessions.map((session) => session.id))
  let changed = false

  for (const remote of remoteSessions) {
    if (pendingIds.has(remote.id)) {
      continue
    }
    const local = localById.get(remote.id)
    const state = stateById.get(remote.id)
    if (remote.deletedAt !== null) {
      if (local) {
        await db.deleteSession(remote.id)
        changed = true
      }
      await db.putSyncState(stateFromRecord({ ...remote, payload: null }))
      continue
    }
    const summary = summaryFromRemote(remote, local)
    if (!local) {
      await db.saveSessionSummary(summary)
      await db.putSyncState(stateFromRecord({ ...remote, payload: null }))
      changed = true
      continue
    }
    if (local && state?.revision === remote.revision) {
      if (local.title !== remote.title || local.updatedAt !== remote.clientUpdatedAt) {
        await db.saveSessionSummary(summary)
        changed = true
      }
      continue
    }
    if (!state && local.updatedAt > remote.clientUpdatedAt) {
      await db.putSyncOutbox({
        sessionId: remote.id,
        operation: 'upsert',
        baseRevision: remote.revision,
        queuedAt: Date.now(),
      })
      continue
    }
    // 会话正文只在用户点击打开时拉取；同步只更新摘要和索引。
    await db.dropSessionBody(remote.id)
    await db.saveSessionSummary(summary)
    await db.putSyncState(stateFromRecord({ ...remote, payload: null }))
    changed = true
  }

  for (const local of localSessions) {
    if (remoteIds.has(local.id) || pendingIds.has(local.id)) {
      continue
    }
    if (stateById.has(local.id)) {
      await db.deleteSession(local.id)
      await db.deleteSyncState(local.id)
      changed = true
      continue
    }
    await db.putSyncOutbox({
      sessionId: local.id,
      operation: 'upsert',
      baseRevision: 0,
      queuedAt: Date.now(),
    })
  }

  if (changed) {
    notifyApplied()
  }
}

const resetCloud = async () => {
  await clearCloudSessions()
  await db.clearSyncData()
  const sessions = await db.loadSessionSummaries()
  for (const summary of sessions) {
    await db.putSyncOutbox({
      sessionId: summary.id,
      operation: 'upsert',
      baseRevision: 0,
      queuedAt: Date.now(),
    })
  }
}

const runSync = async () => {
  useSync.setState({ status: 'syncing', error: null })
  if (await db.getSyncMeta('reset')) {
    await resetCloud()
  }
  await syncSettings()
  const conflicted = await pushOutbox()
  await pullRemote()
  await updatePending()
  useSync.setState({
    status: conflicted ? 'conflict' : 'synced',
    lastSyncedAt: Date.now(),
    error: null,
  })
  retryDelay = 5000
  if ((await db.listSyncOutbox()).length > 0) {
    schedule(2000)
  }
}

export const syncNow = (): Promise<void> => {
  if (!userId) {
    return Promise.resolve()
  }
  if (activeSync) {
    return activeSync
  }
  activeSync = runSync()
    .catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        useSync.setState({ status: 'idle' })
        return
      }
      const offline = error instanceof ApiError && error.kind === 'network'
      useSync.setState({
        status: offline ? 'offline' : 'error',
        error: error instanceof Error ? error.message : String(error),
      })
      schedule(offline ? retryDelay : 15000)
      retryDelay = Math.min(retryDelay * 2, 30_000)
    })
    .finally(() => {
      activeSync = null
      void updatePending()
    })
  return activeSync
}

const bindListeners = () => {
  if (listenersBound || typeof window === 'undefined') {
    return
  }
  listenersBound = true
  window.addEventListener('online', () => schedule(0))
  window.addEventListener('focus', () => schedule(0))
  window.addEventListener(SETTINGS_CHANGED_EVENT, () => {
    void queueSettingsUpsert().catch((error: unknown) => {
      useSync.setState({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
      schedule(15_000)
    })
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      schedule(0)
    }
  })
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      void syncNow()
    }
  }, 60_000)
}

export const initSync = async (nextUserId: string): Promise<void> => {
  prepareSyncedSettingsForUser(nextUserId)
  userId = nextUserId
  bindListeners()
  await updatePending()
  await syncNow()
}

export const stopSync = () => {
  userId = null
  if (scheduled) {
    clearTimeout(scheduled)
    scheduled = null
  }
  useSync.setState({ status: 'idle', pending: 0, error: null })
}

export const stopSyncScheduler = () => {
  stopSync()
}
