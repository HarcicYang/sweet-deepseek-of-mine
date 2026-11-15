import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  SyncSessionPayload,
  SyncSessionRecord,
  SyncSessionSummary,
} from '@sweet-deepseek/contracts/sync'

export class SyncConflictError extends Error {
  constructor(readonly current: SyncSessionRecord | null) {
    super('Sync revision conflict')
    this.name = 'SyncConflictError'
  }
}

export type SyncStore = {
  listSessions: (userId: string) => Promise<SyncSessionSummary[]>
  getSession: (userId: string, sessionId: string) => Promise<SyncSessionRecord | null>
  putSession: (
    userId: string,
    sessionId: string,
    baseRevision: number,
    payload: SyncSessionPayload
  ) => Promise<SyncSessionRecord>
  deleteSession: (
    userId: string,
    sessionId: string,
    baseRevision: number,
    deletedAt: number
  ) => Promise<SyncSessionRecord>
  clearSessions: (userId: string) => Promise<void>
}

type StoredSyncRecord = SyncSessionRecord & { userId: string }

type SyncDatabase = {
  version: 1
  sessions: StoredSyncRecord[]
}

const emptyDatabase = (): SyncDatabase => ({ version: 1, sessions: [] })

const clone = <Value>(value: Value): Value => structuredClone(value)

const toSummary = (record: StoredSyncRecord): SyncSessionSummary => ({
  id: record.id,
  revision: record.revision,
  title: record.title,
  clientUpdatedAt: record.clientUpdatedAt,
  deletedAt: record.deletedAt,
  serverUpdatedAt: record.serverUpdatedAt,
})

const toPublicRecord = (record: StoredSyncRecord): SyncSessionRecord => ({
  ...toSummary(record),
  payload: clone(record.payload),
})

const sortRecords = (records: StoredSyncRecord[]) =>
  [...records].sort((a, b) => b.clientUpdatedAt - a.clientUpdatedAt)

const putRecord = (
  records: StoredSyncRecord[],
  userId: string,
  sessionId: string,
  baseRevision: number,
  payload: SyncSessionPayload
): StoredSyncRecord => {
  const index = records.findIndex((record) => record.userId === userId && record.id === sessionId)
  const current = index === -1 ? null : records[index]
  if ((current?.revision ?? 0) !== baseRevision) {
    throw new SyncConflictError(current ? toPublicRecord(current) : null)
  }
  if (payload.id !== sessionId) {
    throw new Error('Session ID does not match payload ID')
  }
  const now = new Date().toISOString()
  const record: StoredSyncRecord = {
    userId,
    id: sessionId,
    revision: (current?.revision ?? 0) + 1,
    title: payload.title,
    clientUpdatedAt: payload.updatedAt,
    deletedAt: null,
    serverUpdatedAt: now,
    payload,
  }
  if (index === -1) {
    records.push(record)
  } else {
    records[index] = record
  }
  return record
}

const deleteRecord = (
  records: StoredSyncRecord[],
  userId: string,
  sessionId: string,
  baseRevision: number,
  deletedAt: number
): StoredSyncRecord => {
  const index = records.findIndex((record) => record.userId === userId && record.id === sessionId)
  const current = index === -1 ? null : records[index]
  if ((current?.revision ?? 0) !== baseRevision) {
    throw new SyncConflictError(current ? toPublicRecord(current) : null)
  }
  const record: StoredSyncRecord = {
    userId,
    id: sessionId,
    revision: (current?.revision ?? 0) + 1,
    title: '',
    clientUpdatedAt: deletedAt,
    deletedAt,
    serverUpdatedAt: new Date().toISOString(),
    payload: null,
  }
  if (index === -1) {
    records.push(record)
  } else {
    records[index] = record
  }
  return record
}

export class MemorySyncStore implements SyncStore {
  private records: StoredSyncRecord[] = []

  async listSessions(userId: string): Promise<SyncSessionSummary[]> {
    return sortRecords(this.records.filter((record) => record.userId === userId)).map(toSummary)
  }

  async getSession(userId: string, sessionId: string): Promise<SyncSessionRecord | null> {
    const record = this.records.find(
      (candidate) => candidate.userId === userId && candidate.id === sessionId
    )
    return record ? toPublicRecord(record) : null
  }

  async putSession(
    userId: string,
    sessionId: string,
    baseRevision: number,
    payload: SyncSessionPayload
  ): Promise<SyncSessionRecord> {
    return toPublicRecord(putRecord(this.records, userId, sessionId, baseRevision, payload))
  }

  async deleteSession(
    userId: string,
    sessionId: string,
    baseRevision: number,
    deletedAt: number
  ): Promise<SyncSessionRecord> {
    return toPublicRecord(deleteRecord(this.records, userId, sessionId, baseRevision, deletedAt))
  }

  async clearSessions(userId: string): Promise<void> {
    this.records = this.records.filter((record) => record.userId !== userId)
  }
}

export class FileSyncStore implements SyncStore {
  private database: SyncDatabase | null = null
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  private async exclusive<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private async load(): Promise<SyncDatabase> {
    if (this.database) {
      return this.database
    }
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('version' in parsed) ||
        parsed.version !== 1 ||
        !('sessions' in parsed) ||
        !Array.isArray(parsed.sessions)
      ) {
        throw new Error('Unsupported sync database format')
      }
      this.database = parsed as SyncDatabase
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      this.database = emptyDatabase()
    }
    return this.database
  }

  private async persist(database: SyncDatabase): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${crypto.randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(database, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPath, this.filePath)
  }

  async listSessions(userId: string): Promise<SyncSessionSummary[]> {
    return this.exclusive(async () => {
      const database = await this.load()
      return sortRecords(database.sessions.filter((record) => record.userId === userId)).map(
        toSummary
      )
    })
  }

  async getSession(userId: string, sessionId: string): Promise<SyncSessionRecord | null> {
    return this.exclusive(async () => {
      const database = await this.load()
      const record = database.sessions.find(
        (candidate) => candidate.userId === userId && candidate.id === sessionId
      )
      return record ? toPublicRecord(record) : null
    })
  }

  async putSession(
    userId: string,
    sessionId: string,
    baseRevision: number,
    payload: SyncSessionPayload
  ): Promise<SyncSessionRecord> {
    return this.exclusive(async () => {
      const database = await this.load()
      const record = putRecord(database.sessions, userId, sessionId, baseRevision, payload)
      await this.persist(database)
      return toPublicRecord(record)
    })
  }

  async deleteSession(
    userId: string,
    sessionId: string,
    baseRevision: number,
    deletedAt: number
  ): Promise<SyncSessionRecord> {
    return this.exclusive(async () => {
      const database = await this.load()
      const record = deleteRecord(database.sessions, userId, sessionId, baseRevision, deletedAt)
      await this.persist(database)
      return toPublicRecord(record)
    })
  }

  async clearSessions(userId: string): Promise<void> {
    await this.exclusive(async () => {
      const database = await this.load()
      const next = database.sessions.filter((record) => record.userId !== userId)
      if (next.length === database.sessions.length) {
        return
      }
      database.sessions = next
      await this.persist(database)
    })
  }
}
