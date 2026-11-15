import {
  SyncedSettingsPayloadSchema,
  type SyncedSettingsPayload,
  type SyncSessionPayload,
  type SyncSessionRecord,
  type SyncSessionSummary,
  type SyncSettingsRecord,
} from '@sweet-deepseek/contracts/sync'
import {
  SyncConflictError,
  SyncSettingsConflictError,
  type SyncStore,
} from './sync-store.js'

const CHUNK_BYTES = 512 * 1024

type SessionHeadRow = {
  user_id: string
  session_id: string
  revision: number
  title: string
  client_updated_at: number
  deleted_at: number | null
  server_updated_at: string
  payload_token: string | null
  payload_size: number
}

type SessionChunkRow = {
  data: ArrayBuffer | ArrayBufferView | number[]
}

type SettingsRow = {
  user_id: string
  revision: number
  client_updated_at: number
  server_updated_at: string
  payload_json: string
}

const bytesFrom = (data: SessionChunkRow['data']): Uint8Array => {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  if (Array.isArray(data)) {
    return new Uint8Array(data)
  }
  throw new Error('Unsupported D1 BLOB value')
}

const toSummary = (row: SessionHeadRow): SyncSessionSummary => ({
  id: row.session_id,
  revision: row.revision,
  title: row.title,
  clientUpdatedAt: row.client_updated_at,
  deletedAt: row.deleted_at,
  serverUpdatedAt: row.server_updated_at,
})

const toSettings = (row: SettingsRow): SyncSettingsRecord => {
  const parsed = SyncedSettingsPayloadSchema.safeParse(JSON.parse(row.payload_json))
  if (!parsed.success) {
    throw new Error('Invalid settings payload in D1')
  }
  return {
    revision: row.revision,
    clientUpdatedAt: row.client_updated_at,
    serverUpdatedAt: row.server_updated_at,
    payload: parsed.data,
  }
}

export class D1SyncStore implements SyncStore {
  constructor(private readonly database: D1Database) {}

  private async head(userId: string, sessionId: string): Promise<SessionHeadRow | null> {
    return await this.database
      .prepare('SELECT * FROM sync_sessions WHERE user_id = ? AND session_id = ?')
      .bind(userId, sessionId)
      .first<SessionHeadRow>()
  }

  private async readPayload(row: SessionHeadRow): Promise<SyncSessionPayload | null> {
    if (!row.payload_token || row.deleted_at !== null) {
      return null
    }
    const chunks = await this.database
      .prepare(
        `SELECT data FROM sync_session_chunks
         WHERE user_id = ? AND session_id = ? AND payload_token = ?
         ORDER BY chunk_index`
      )
      .bind(row.user_id, row.session_id, row.payload_token)
      .all<SessionChunkRow>()
    const bytes = new Uint8Array(row.payload_size)
    let offset = 0
    for (const chunk of chunks.results) {
      const value = bytesFrom(chunk.data)
      if (offset + value.byteLength > bytes.byteLength) {
        throw new Error('Session payload chunks exceed declared size')
      }
      bytes.set(value, offset)
      offset += value.byteLength
    }
    if (offset !== bytes.byteLength) {
      throw new Error('Session payload chunks do not match declared size')
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as SyncSessionPayload
  }

  private async deleteChunks(
    userId: string,
    sessionId: string,
    payloadToken: string | null
  ): Promise<void> {
    if (!payloadToken) {
      return
    }
    try {
      await this.database
        .prepare(
          'DELETE FROM sync_session_chunks WHERE user_id = ? AND session_id = ? AND payload_token = ?'
        )
        .bind(userId, sessionId, payloadToken)
        .run()
    } catch {
      // Orphan cleanup is best-effort and never invalidates a committed revision.
    }
  }

  async listSessions(userId: string): Promise<SyncSessionSummary[]> {
    const rows = await this.database
      .prepare(
        `SELECT * FROM sync_sessions
         WHERE user_id = ?
         ORDER BY client_updated_at DESC`
      )
      .bind(userId)
      .all<SessionHeadRow>()
    return rows.results.map(toSummary)
  }

  async getSession(userId: string, sessionId: string): Promise<SyncSessionRecord | null> {
    const row = await this.head(userId, sessionId)
    if (!row) {
      return null
    }
    return {
      ...toSummary(row),
      payload: await this.readPayload(row),
    }
  }

  async putSession(
    userId: string,
    sessionId: string,
    baseRevision: number,
    payload: SyncSessionPayload
  ): Promise<SyncSessionRecord> {
    if (payload.id !== sessionId) {
      throw new Error('Session ID does not match payload ID')
    }
    const current = await this.head(userId, sessionId)
    if ((current?.revision ?? 0) !== baseRevision) {
      throw new SyncConflictError(null)
    }

    const payloadToken = crypto.randomUUID()
    const bytes = new TextEncoder().encode(JSON.stringify(payload))
    const chunks: D1PreparedStatement[] = []
    for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_BYTES) {
      const data = bytes.slice(offset, offset + CHUNK_BYTES)
      chunks.push(
        this.database
          .prepare(
            `INSERT INTO sync_session_chunks (
              user_id, session_id, payload_token, chunk_index, data
            ) VALUES (?, ?, ?, ?, ?)`
          )
          .bind(
            userId,
            sessionId,
            payloadToken,
            chunks.length,
            data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
          )
      )
    }

    const revision = baseRevision + 1
    const serverUpdatedAt = new Date().toISOString()
    const headStatement = current
      ? this.database
          .prepare(
            `UPDATE sync_sessions SET
              revision = ?, title = ?, client_updated_at = ?, deleted_at = NULL,
              server_updated_at = ?, payload_token = ?, payload_size = ?
             WHERE user_id = ? AND session_id = ? AND revision = ?`
          )
          .bind(
            revision,
            payload.title,
            payload.updatedAt,
            serverUpdatedAt,
            payloadToken,
            bytes.byteLength,
            userId,
            sessionId,
            baseRevision
          )
      : this.database
          .prepare(
            `INSERT INTO sync_sessions (
              user_id, session_id, revision, title, client_updated_at, deleted_at,
              server_updated_at, payload_token, payload_size
            ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
            ON CONFLICT(user_id, session_id) DO NOTHING`
          )
          .bind(
            userId,
            sessionId,
            revision,
            payload.title,
            payload.updatedAt,
            serverUpdatedAt,
            payloadToken,
            bytes.byteLength
          )

    try {
      const result = await this.database.batch([...chunks, headStatement])
      if ((result.at(-1)?.meta.changes ?? 0) === 0) {
        await this.deleteChunks(userId, sessionId, payloadToken)
        throw new SyncConflictError(null)
      }
    } catch (error) {
      await this.deleteChunks(userId, sessionId, payloadToken)
      throw error
    }

    await this.deleteChunks(userId, sessionId, current?.payload_token ?? null)
    return {
      id: sessionId,
      revision,
      title: payload.title,
      clientUpdatedAt: payload.updatedAt,
      deletedAt: null,
      serverUpdatedAt,
      payload,
    }
  }

  async deleteSession(
    userId: string,
    sessionId: string,
    baseRevision: number,
    deletedAt: number
  ): Promise<SyncSessionRecord> {
    const current = await this.head(userId, sessionId)
    if ((current?.revision ?? 0) !== baseRevision) {
      throw new SyncConflictError(null)
    }
    const revision = baseRevision + 1
    const serverUpdatedAt = new Date().toISOString()
    const result = current
      ? await this.database
          .prepare(
            `UPDATE sync_sessions SET
              revision = ?, title = '', client_updated_at = ?, deleted_at = ?,
              server_updated_at = ?, payload_token = NULL, payload_size = 0
             WHERE user_id = ? AND session_id = ? AND revision = ?`
          )
          .bind(
            revision,
            deletedAt,
            deletedAt,
            serverUpdatedAt,
            userId,
            sessionId,
            baseRevision
          )
          .run()
      : await this.database
          .prepare(
            `INSERT INTO sync_sessions (
              user_id, session_id, revision, title, client_updated_at, deleted_at,
              server_updated_at, payload_token, payload_size
            ) VALUES (?, ?, ?, '', ?, ?, ?, NULL, 0)
            ON CONFLICT(user_id, session_id) DO NOTHING`
          )
          .bind(userId, sessionId, revision, deletedAt, deletedAt, serverUpdatedAt)
          .run()
    if (result.meta.changes === 0) {
      throw new SyncConflictError(null)
    }
    await this.deleteChunks(userId, sessionId, current?.payload_token ?? null)
    return {
      id: sessionId,
      revision,
      title: '',
      clientUpdatedAt: deletedAt,
      deletedAt,
      serverUpdatedAt,
      payload: null,
    }
  }

  async clearSessions(userId: string): Promise<void> {
    await this.database.batch([
      this.database.prepare('DELETE FROM sync_session_chunks WHERE user_id = ?').bind(userId),
      this.database.prepare('DELETE FROM sync_sessions WHERE user_id = ?').bind(userId),
    ])
  }

  async getSettings(userId: string): Promise<SyncSettingsRecord | null> {
    const row = await this.database
      .prepare('SELECT * FROM sync_settings WHERE user_id = ?')
      .bind(userId)
      .first<SettingsRow>()
    return row ? toSettings(row) : null
  }

  async putSettings(
    userId: string,
    baseRevision: number,
    payload: SyncedSettingsPayload
  ): Promise<SyncSettingsRecord> {
    const revision = baseRevision + 1
    const serverUpdatedAt = new Date().toISOString()
    const result =
      baseRevision === 0
        ? await this.database
            .prepare(
              `INSERT INTO sync_settings (
                user_id, revision, client_updated_at, server_updated_at, payload_json
              ) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(user_id) DO NOTHING`
            )
            .bind(userId, revision, payload.updatedAt, serverUpdatedAt, JSON.stringify(payload))
            .run()
        : await this.database
            .prepare(
              `UPDATE sync_settings SET
                revision = ?, client_updated_at = ?, server_updated_at = ?, payload_json = ?
               WHERE user_id = ? AND revision = ?`
            )
            .bind(
              revision,
              payload.updatedAt,
              serverUpdatedAt,
              JSON.stringify(payload),
              userId,
              baseRevision
            )
            .run()
    if (result.meta.changes === 0) {
      throw new SyncSettingsConflictError(null)
    }
    return {
      revision,
      clientUpdatedAt: payload.updatedAt,
      serverUpdatedAt,
      payload,
    }
  }
}
