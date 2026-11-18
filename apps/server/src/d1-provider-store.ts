import type { ProviderApi, ProviderModelInput } from '@sweet-deepseek/contracts/providers'
import type { ProviderRecord, ProviderStore, ProviderWrite } from './provider-store.js'
import type { EncryptedValue } from './security.js'

type ProviderRow = {
  user_id: string
  id: string
  kind: string
  name: string
  api: string | null
  base_url: string | null
  models_json: string
  credential_json: string | null
  created_at: string
  updated_at: string
}

const parseEncryptedValue = (value: string | null): EncryptedValue | null => {
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

const parseModels = (value: string): ProviderModelInput[] => {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as ProviderModelInput[]) : []
  } catch {
    return []
  }
}

const toRecord = (row: ProviderRow): ProviderRecord => ({
  id: row.id,
  userId: row.user_id,
  kind: row.kind === 'builtin' ? 'builtin' : 'custom',
  name: row.name,
  api: row.api === null ? null : (row.api as ProviderApi),
  baseUrl: row.base_url,
  models: parseModels(row.models_json),
  encryptedApiKey: parseEncryptedValue(row.credential_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export class D1ProviderStore implements ProviderStore {
  constructor(private readonly database: D1Database) {}

  async listProviders(userId: string): Promise<ProviderRecord[]> {
    const rows = await this.database
      .prepare('SELECT * FROM provider_profiles WHERE user_id = ? ORDER BY created_at')
      .bind(userId)
      .all<ProviderRow>()
    return rows.results.map(toRecord)
  }

  async findProvider(userId: string, providerId: string): Promise<ProviderRecord | null> {
    const row = await this.database
      .prepare('SELECT * FROM provider_profiles WHERE user_id = ? AND id = ?')
      .bind(userId, providerId)
      .first<ProviderRow>()
    return row ? toRecord(row) : null
  }

  async createProvider(userId: string, input: ProviderWrite): Promise<ProviderRecord> {
    const now = new Date().toISOString()
    const row = await this.database
      .prepare(
        `INSERT INTO provider_profiles (
          user_id, id, kind, name, api, base_url, models_json, credential_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *`
      )
      .bind(
        userId,
        input.id,
        input.kind,
        input.name,
        input.api,
        input.baseUrl,
        JSON.stringify(input.models),
        input.encryptedApiKey === null ? null : JSON.stringify(input.encryptedApiKey),
        now,
        now
      )
      .first<ProviderRow>()
    if (!row) {
      throw new Error('Could not create provider')
    }
    return toRecord(row)
  }

  async updateProvider(
    userId: string,
    providerId: string,
    input: ProviderWrite
  ): Promise<ProviderRecord | null> {
    const row = await this.database
      .prepare(
        `UPDATE provider_profiles SET
          name = ?, api = ?, base_url = ?, models_json = ?, credential_json = ?,
          updated_at = ?
         WHERE user_id = ? AND id = ?
         RETURNING *`
      )
      .bind(
        input.name,
        input.api,
        input.baseUrl,
        JSON.stringify(input.models),
        input.encryptedApiKey === null ? null : JSON.stringify(input.encryptedApiKey),
        new Date().toISOString(),
        userId,
        providerId
      )
      .first<ProviderRow>()
    return row ? toRecord(row) : null
  }

  async deleteProvider(userId: string, providerId: string): Promise<boolean> {
    const result = await this.database
      .prepare('DELETE FROM provider_profiles WHERE user_id = ? AND id = ?')
      .bind(userId, providerId)
      .run()
    return result.meta.changes > 0
  }
}
