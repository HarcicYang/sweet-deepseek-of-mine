import type { EncryptedApiKey } from './security.js'
import type {
  AccountStore,
  GitHubProfile,
  SessionRecord,
  UserRecord,
} from './account-store.js'

type UserRow = {
  id: string
  github_id: string
  github_login: string
  avatar_url: string | null
  api_key_json: string | null
  created_at: string
  updated_at: string
}

type SessionRow = {
  token_hash: string
  user_id: string
  created_at: string
  expires_at: string
}

const parseApiKey = (value: string | null): EncryptedApiKey | undefined => {
  if (!value) {
    return undefined
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
      return undefined
    }
    return {
      version: 1,
      algorithm: 'AES-GCM',
      iv: parsed.iv,
      ciphertext: parsed.ciphertext,
    }
  } catch {
    return undefined
  }
}

const toUser = (row: UserRow): UserRecord => {
  const apiKey = parseApiKey(row.api_key_json)
  return {
    id: row.id,
    githubId: row.github_id,
    githubLogin: row.github_login,
    avatarUrl: row.avatar_url,
    ...(apiKey ? { apiKey } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const toSession = (row: SessionRow): SessionRecord => ({
  tokenHash: row.token_hash,
  userId: row.user_id,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
})

export class D1AccountStore implements AccountStore {
  constructor(private readonly database: D1Database) {}

  async upsertGithubUser(profile: GitHubProfile): Promise<UserRecord> {
    const now = new Date().toISOString()
    const row = await this.database
      .prepare(
        `INSERT INTO users (
          id, github_id, github_login, avatar_url, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(github_id) DO UPDATE SET
          github_login = excluded.github_login,
          avatar_url = excluded.avatar_url,
          updated_at = excluded.updated_at
        RETURNING *`
      )
      .bind(crypto.randomUUID(), profile.githubId, profile.githubLogin, profile.avatarUrl, now, now)
      .first<UserRow>()
    if (!row) {
      throw new Error('Could not upsert GitHub user')
    }
    return toUser(row)
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const row = await this.database
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(id)
      .first<UserRow>()
    return row ? toUser(row) : null
  }

  async createSession(session: SessionRecord): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(session.tokenHash, session.userId, session.createdAt, session.expiresAt)
      .run()
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const row = await this.database
      .prepare('SELECT * FROM auth_sessions WHERE token_hash = ?')
      .bind(tokenHash)
      .first<SessionRow>()
    if (!row) {
      return null
    }
    if (Date.parse(row.expires_at) <= Date.now()) {
      await this.deleteSession(tokenHash)
      return null
    }
    return toSession(row)
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.database
      .prepare('DELETE FROM auth_sessions WHERE token_hash = ?')
      .bind(tokenHash)
      .run()
  }

  async setApiKey(userId: string, apiKey: EncryptedApiKey): Promise<void> {
    const result = await this.database
      .prepare('UPDATE users SET api_key_json = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(apiKey), new Date().toISOString(), userId)
      .run()
    if (result.meta.changes === 0) {
      throw new Error('User not found')
    }
  }

  async clearApiKey(userId: string): Promise<void> {
    const result = await this.database
      .prepare('UPDATE users SET api_key_json = NULL, updated_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), userId)
      .run()
    if (result.meta.changes === 0) {
      throw new Error('User not found')
    }
  }
}
