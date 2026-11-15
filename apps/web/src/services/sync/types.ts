export type SyncOutboxRecord = {
  sessionId: string
  operation: 'upsert' | 'delete'
  baseRevision: number
  queuedAt: number
}

export type SyncStateRecord = {
  sessionId: string
  revision: number
  clientUpdatedAt: number
  deletedAt: number | null
}

export type SyncMetaRecord = {
  key: 'reset'
  value: boolean
}

export type SettingsSyncState = {
  key: 'settings'
  revision: number
  clientUpdatedAt: number
  pending: boolean
  baseRevision: number
  queuedAt: number | null
}
