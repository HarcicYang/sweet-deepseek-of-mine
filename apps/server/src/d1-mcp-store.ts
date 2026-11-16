import type { McpServerCreate, McpServerRecord, McpServerUpdate, McpStore } from './mcp-store.js'
import type { EncryptedValue } from './security.js'

type McpServerRow = {
  id: string
  user_id: string
  name: string
  slug: string
  url: string
  auth_mode: string
  oauth_client_id: string | null
  oauth_client_secret_json: string | null
  enabled: number
  headers_json: string | null
  created_at: string
  updated_at: string
}

const parseEncryptedHeaders = (value: string | null): EncryptedValue | null => {
  if (!value) {
    return null
  }
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

const toRecord = (row: McpServerRow): McpServerRecord => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  slug: row.slug,
  url: row.url,
  authMode: row.auth_mode === 'oauth' ? 'oauth' : 'static',
  oauthClientId: row.oauth_client_id,
  encryptedOAuthClientSecret: parseEncryptedHeaders(row.oauth_client_secret_json),
  enabled: row.enabled === 1,
  encryptedHeaders: parseEncryptedHeaders(row.headers_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const UPDATE_COLUMNS: Record<keyof McpServerUpdate, string> = {
  name: 'name',
  slug: 'slug',
  url: 'url',
  authMode: 'auth_mode',
  oauthClientId: 'oauth_client_id',
  encryptedOAuthClientSecret: 'oauth_client_secret_json',
  enabled: 'enabled',
  encryptedHeaders: 'headers_json',
}

export class D1McpStore implements McpStore {
  constructor(private readonly database: D1Database) {}

  async listServers(userId: string): Promise<McpServerRecord[]> {
    const rows = await this.database
      .prepare('SELECT * FROM mcp_servers WHERE user_id = ? ORDER BY created_at')
      .bind(userId)
      .all<McpServerRow>()
    return rows.results.map(toRecord)
  }

  async findServer(userId: string, serverId: string): Promise<McpServerRecord | null> {
    const row = await this.database
      .prepare('SELECT * FROM mcp_servers WHERE id = ? AND user_id = ?')
      .bind(serverId, userId)
      .first<McpServerRow>()
    return row ? toRecord(row) : null
  }

  async createServer(input: McpServerCreate): Promise<McpServerRecord> {
    const now = new Date().toISOString()
    const row = await this.database
      .prepare(
        `INSERT INTO mcp_servers (
          id, user_id, name, slug, url, auth_mode, oauth_client_id,
          oauth_client_secret_json, enabled, headers_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *`
      )
      .bind(
        input.id,
        input.userId,
        input.name,
        input.slug,
        input.url,
        input.authMode,
        input.oauthClientId,
        input.encryptedOAuthClientSecret === null
          ? null
          : JSON.stringify(input.encryptedOAuthClientSecret),
        input.enabled ? 1 : 0,
        input.encryptedHeaders === null ? null : JSON.stringify(input.encryptedHeaders),
        now,
        now
      )
      .first<McpServerRow>()
    if (!row) {
      throw new Error('Could not create MCP server')
    }
    return toRecord(row)
  }

  async updateServer(
    userId: string,
    serverId: string,
    update: McpServerUpdate
  ): Promise<McpServerRecord | null> {
    const entries = Object.entries(update).filter((entry) => entry[1] !== undefined)
    if (entries.length === 0) {
      return this.findServer(userId, serverId)
    }
    const columns = entries.map(([key]) => UPDATE_COLUMNS[key as keyof McpServerUpdate])
    const values = entries.map(([key, value]) => {
      if (key === 'enabled') {
        return value ? 1 : 0
      }
      if (key === 'encryptedHeaders') {
        return value === null ? null : JSON.stringify(value)
      }
      if (key === 'encryptedOAuthClientSecret') {
        return value === null ? null : JSON.stringify(value)
      }
      return value
    })
    const row = await this.database
      .prepare(
        `UPDATE mcp_servers
         SET ${columns.map((column) => `${column} = ?`).join(', ')}, updated_at = ?
         WHERE id = ? AND user_id = ?
         RETURNING *`
      )
      .bind(...values, new Date().toISOString(), serverId, userId)
      .first<McpServerRow>()
    return row ? toRecord(row) : null
  }

  async deleteServer(userId: string, serverId: string): Promise<boolean> {
    const result = await this.database
      .prepare('DELETE FROM mcp_servers WHERE id = ? AND user_id = ?')
      .bind(serverId, userId)
      .run()
    return result.meta.changes > 0
  }
}
