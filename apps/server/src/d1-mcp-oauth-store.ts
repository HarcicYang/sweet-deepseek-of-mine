import type { McpOAuthRecord, McpOAuthStore } from './mcp-oauth-store.js'
import type { EncryptedValue } from './security.js'

type OAuthRow = {
  user_id: string
  server_id: string
  state: string
  payload_json: string
  connected: number
  created_at: string
  updated_at: string
  expires_at: number
}

const parsePayload = (value: string): EncryptedValue | null => {
  try {
    const parsed: unknown = JSON.parse(value)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      parsed.version !== 1 ||
      !('algorithm' in parsed) ||
      parsed.algorithm !== 'AES-GCM' ||
      !('iv' in parsed) ||
      typeof parsed.iv !== 'string' ||
      !('ciphertext' in parsed) ||
      typeof parsed.ciphertext !== 'string'
    ) {
      return null
    }
    return {
      version: 1,
      algorithm: 'AES-GCM',
      iv: parsed.iv,
      ciphertext: parsed.ciphertext,
    }
  } catch {
    return null
  }
}

const toRecord = (row: OAuthRow): McpOAuthRecord | null => {
  const payload = parsePayload(row.payload_json)
  return payload
    ? {
        userId: row.user_id,
        serverId: row.server_id,
        state: row.state,
        encryptedPayload: payload,
        connected: row.connected === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at,
      }
    : null
}

export class D1McpOAuthStore implements McpOAuthStore {
  constructor(private readonly database: D1Database) {}

  async find(userId: string, serverId: string): Promise<McpOAuthRecord | null> {
    const row = await this.database
      .prepare(
        'SELECT * FROM mcp_oauth WHERE user_id = ? AND server_id = ? AND (connected = 1 OR expires_at > ?)'
      )
      .bind(userId, serverId, Date.now())
      .first<OAuthRow>()
    return row ? toRecord(row) : null
  }

  async findByState(state: string): Promise<McpOAuthRecord | null> {
    const row = await this.database
      .prepare('SELECT * FROM mcp_oauth WHERE state = ? AND expires_at > ?')
      .bind(state, Date.now())
      .first<OAuthRow>()
    return row ? toRecord(row) : null
  }

  async upsert(record: McpOAuthRecord): Promise<McpOAuthRecord> {
    const row = await this.database
      .prepare(
        `INSERT INTO mcp_oauth (
          user_id, server_id, state, payload_json, connected, created_at, updated_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, server_id) DO UPDATE SET
          state = excluded.state,
          payload_json = excluded.payload_json,
          connected = excluded.connected,
          updated_at = excluded.updated_at,
          expires_at = excluded.expires_at
        RETURNING *`
      )
      .bind(
        record.userId,
        record.serverId,
        record.state,
        JSON.stringify(record.encryptedPayload),
        record.connected ? 1 : 0,
        record.createdAt,
        record.updatedAt,
        record.expiresAt
      )
      .first<OAuthRow>()
    if (!row) {
      throw new Error('Could not persist MCP OAuth state')
    }
    const parsed = toRecord(row)
    if (!parsed) {
      throw new Error('Invalid MCP OAuth row')
    }
    return parsed
  }

  async delete(userId: string, serverId: string): Promise<void> {
    await this.database
      .prepare('DELETE FROM mcp_oauth WHERE user_id = ? AND server_id = ?')
      .bind(userId, serverId)
      .run()
  }
}
