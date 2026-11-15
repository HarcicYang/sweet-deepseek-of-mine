import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { EncryptedApiKey } from './security.js'

export type UserRecord = {
  id: string
  githubId: string
  githubLogin: string
  avatarUrl: string | null
  apiKey?: EncryptedApiKey
  createdAt: string
  updatedAt: string
}

export type SessionRecord = {
  tokenHash: string
  userId: string
  createdAt: string
  expiresAt: string
}

export type GitHubProfile = {
  githubId: string
  githubLogin: string
  avatarUrl: string | null
}

export type AccountStore = {
  upsertGithubUser: (profile: GitHubProfile) => Promise<UserRecord>
  findUserById: (id: string) => Promise<UserRecord | null>
  createSession: (session: SessionRecord) => Promise<void>
  findSessionByTokenHash: (tokenHash: string) => Promise<SessionRecord | null>
  deleteSession: (tokenHash: string) => Promise<void>
  setApiKey: (userId: string, apiKey: EncryptedApiKey) => Promise<void>
  clearApiKey: (userId: string) => Promise<void>
}

type Database = {
  version: 1
  users: UserRecord[]
  sessions: SessionRecord[]
}

const emptyDatabase = (): Database => ({ version: 1, users: [], sessions: [] })

const clone = <Value>(value: Value): Value => structuredClone(value)

const isExpired = (session: SessionRecord, now = Date.now()) => Date.parse(session.expiresAt) <= now

const upsertUser = (users: UserRecord[], profile: GitHubProfile): UserRecord => {
  const now = new Date().toISOString()
  const existing = users.find((user) => user.githubId === profile.githubId)
  if (existing) {
    existing.githubLogin = profile.githubLogin
    existing.avatarUrl = profile.avatarUrl
    existing.updatedAt = now
    return existing
  }
  const user: UserRecord = {
    id: crypto.randomUUID(),
    githubId: profile.githubId,
    githubLogin: profile.githubLogin,
    avatarUrl: profile.avatarUrl,
    createdAt: now,
    updatedAt: now,
  }
  users.push(user)
  return user
}

export class MemoryAccountStore implements AccountStore {
  private readonly users = new Map<string, UserRecord>()
  private readonly githubUsers = new Map<string, string>()
  private readonly sessions = new Map<string, SessionRecord>()

  async upsertGithubUser(profile: GitHubProfile): Promise<UserRecord> {
    const existingId = this.githubUsers.get(profile.githubId)
    const existing = existingId ? this.users.get(existingId) : undefined
    if (existing) {
      existing.githubLogin = profile.githubLogin
      existing.avatarUrl = profile.avatarUrl
      existing.updatedAt = new Date().toISOString()
      return clone(existing)
    }
    const now = new Date().toISOString()
    const user: UserRecord = {
      id: crypto.randomUUID(),
      githubId: profile.githubId,
      githubLogin: profile.githubLogin,
      avatarUrl: profile.avatarUrl,
      createdAt: now,
      updatedAt: now,
    }
    this.users.set(user.id, user)
    this.githubUsers.set(user.githubId, user.id)
    return clone(user)
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const user = this.users.get(id)
    return user ? clone(user) : null
  }

  async createSession(session: SessionRecord): Promise<void> {
    this.sessions.set(session.tokenHash, clone(session))
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const session = this.sessions.get(tokenHash)
    if (!session) {
      return null
    }
    if (isExpired(session)) {
      this.sessions.delete(tokenHash)
      return null
    }
    return clone(session)
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash)
  }

  async setApiKey(userId: string, apiKey: EncryptedApiKey): Promise<void> {
    const user = this.users.get(userId)
    if (!user) {
      throw new Error('User not found')
    }
    user.apiKey = clone(apiKey)
    user.updatedAt = new Date().toISOString()
  }

  async clearApiKey(userId: string): Promise<void> {
    const user = this.users.get(userId)
    if (!user) {
      throw new Error('User not found')
    }
    delete user.apiKey
    user.updatedAt = new Date().toISOString()
  }
}

export class FileAccountStore implements AccountStore {
  private database: Database | null = null
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

  private async load(): Promise<Database> {
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
        !('users' in parsed) ||
        !Array.isArray(parsed.users) ||
        !('sessions' in parsed) ||
        !Array.isArray(parsed.sessions)
      ) {
        throw new Error('Unsupported account database format')
      }
      this.database = parsed as Database
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      this.database = emptyDatabase()
    }
    return this.database
  }

  private async persist(database: Database): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${crypto.randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(database, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPath, this.filePath)
  }

  async upsertGithubUser(profile: GitHubProfile): Promise<UserRecord> {
    return this.exclusive(async () => {
      const database = await this.load()
      const user = upsertUser(database.users, profile)
      await this.persist(database)
      return clone(user)
    })
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    return this.exclusive(async () => {
      const database = await this.load()
      const user = database.users.find((candidate) => candidate.id === id)
      return user ? clone(user) : null
    })
  }

  async createSession(session: SessionRecord): Promise<void> {
    await this.exclusive(async () => {
      const database = await this.load()
      database.sessions = database.sessions.filter((candidate) => !isExpired(candidate))
      database.sessions.push(clone(session))
      await this.persist(database)
    })
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.exclusive(async () => {
      const database = await this.load()
      const session = database.sessions.find((candidate) => candidate.tokenHash === tokenHash)
      if (!session || isExpired(session)) {
        if (session) {
          database.sessions = database.sessions.filter(
            (candidate) => candidate.tokenHash !== tokenHash
          )
          await this.persist(database)
        }
        return null
      }
      return clone(session)
    })
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.exclusive(async () => {
      const database = await this.load()
      const nextSessions = database.sessions.filter(
        (candidate) => candidate.tokenHash !== tokenHash
      )
      if (nextSessions.length === database.sessions.length) {
        return
      }
      database.sessions = nextSessions
      await this.persist(database)
    })
  }

  async setApiKey(userId: string, apiKey: EncryptedApiKey): Promise<void> {
    await this.exclusive(async () => {
      const database = await this.load()
      const user = database.users.find((candidate) => candidate.id === userId)
      if (!user) {
        throw new Error('User not found')
      }
      user.apiKey = clone(apiKey)
      user.updatedAt = new Date().toISOString()
      await this.persist(database)
    })
  }

  async clearApiKey(userId: string): Promise<void> {
    await this.exclusive(async () => {
      const database = await this.load()
      const user = database.users.find((candidate) => candidate.id === userId)
      if (!user) {
        throw new Error('User not found')
      }
      delete user.apiKey
      user.updatedAt = new Date().toISOString()
      await this.persist(database)
    })
  }
}
