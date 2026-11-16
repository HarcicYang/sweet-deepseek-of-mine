import { SyncSessionPayloadSchema, type SyncSessionPayload } from '@sweet-deepseek/contracts/sync'
import type { ShareRecord, ShareStore } from './share-store.js'

const CHUNK_BYTES = 512 * 1024
const TOKEN_ATTEMPTS = 3

type ShareRow = {
  token: string
  user_id: string
  payload_size: number
  created_at: string
  expires_at: string
}

type ShareChunkRow = {
  data: ArrayBuffer | ArrayBufferView | number[]
}

const bytesFrom = (data: ShareChunkRow['data']): Uint8Array => {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  return new Uint8Array(data)
}

const newToken = () => crypto.randomUUID().replaceAll('-', '')

export class D1ShareStore implements ShareStore {
  constructor(private readonly database: D1Database) {}

  async createShare(
    userId: string,
    session: SyncSessionPayload,
    expiresAt: string
  ): Promise<ShareRecord> {
    const payload = new TextEncoder().encode(JSON.stringify(session))
    const createdAt = new Date().toISOString()
    await this.database
      .batch([
        this.database
          .prepare(
            `DELETE FROM share_chunks
             WHERE token IN (SELECT token FROM share_links WHERE expires_at <= ?)`
          )
          .bind(createdAt),
        this.database.prepare('DELETE FROM share_links WHERE expires_at <= ?').bind(createdAt),
      ])
      .catch(() => undefined)

    for (let attempt = 0; attempt < TOKEN_ATTEMPTS; attempt += 1) {
      const token = newToken()
      const chunks: D1PreparedStatement[] = []
      for (let offset = 0; offset < payload.byteLength; offset += CHUNK_BYTES) {
        const data = payload.slice(offset, offset + CHUNK_BYTES)
        chunks.push(
          this.database
            .prepare(
              `INSERT INTO share_chunks (token, chunk_index, data)
               VALUES (?, ?, ?)`
            )
            .bind(
              token,
              chunks.length,
              data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
            )
        )
      }
      const head = this.database
        .prepare(
          `INSERT INTO share_links (
            token, user_id, payload_size, created_at, expires_at
          ) VALUES (?, ?, ?, ?, ?)`
        )
        .bind(token, userId, payload.byteLength, createdAt, expiresAt)
      try {
        await this.database.batch([head, ...chunks])
        return {
          token,
          userId,
          session,
          createdAt,
          expiresAt,
        }
      } catch (error) {
        if (attempt === TOKEN_ATTEMPTS - 1) {
          throw error
        }
      }
    }
    throw new Error('Could not create share token')
  }

  async getShare(token: string, now = Date.now()): Promise<ShareRecord | null> {
    const row = await this.database
      .prepare('SELECT * FROM share_links WHERE token = ?')
      .bind(token)
      .first<ShareRow>()
    if (!row || Date.parse(row.expires_at) <= now) {
      return null
    }
    const chunks = await this.database
      .prepare('SELECT data FROM share_chunks WHERE token = ? ORDER BY chunk_index')
      .bind(token)
      .all<ShareChunkRow>()
    const bytes = new Uint8Array(row.payload_size)
    let offset = 0
    for (const chunk of chunks.results) {
      const value = bytesFrom(chunk.data)
      if (offset + value.byteLength > bytes.byteLength) {
        throw new Error('Share payload chunks exceed declared size')
      }
      bytes.set(value, offset)
      offset += value.byteLength
    }
    if (offset !== bytes.byteLength) {
      throw new Error('Share payload chunks do not match declared size')
    }
    const parsed = SyncSessionPayloadSchema.safeParse(
      JSON.parse(new TextDecoder().decode(bytes)) as unknown
    )
    if (!parsed.success) {
      throw new Error('Invalid share payload in D1')
    }
    return {
      token: row.token,
      userId: row.user_id,
      session: parsed.data,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }
  }
}
