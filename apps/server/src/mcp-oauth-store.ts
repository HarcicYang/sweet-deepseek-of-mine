import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { EncryptedValue } from './security.js'

export type McpOAuthRecord = {
  userId: string
  serverId: string
  state: string
  encryptedPayload: EncryptedValue
  connected: boolean
  createdAt: string
  updatedAt: string
  expiresAt: number
}

export type McpOAuthStore = {
  find: (userId: string, serverId: string) => Promise<McpOAuthRecord | null>
  findByState: (state: string) => Promise<McpOAuthRecord | null>
  upsert: (record: McpOAuthRecord) => Promise<McpOAuthRecord>
  delete: (userId: string, serverId: string) => Promise<void>
}

type OAuthDatabase = {
  version: 1
  records: McpOAuthRecord[]
}

const emptyDatabase = (): OAuthDatabase => ({ version: 1, records: [] })
const clone = <Value>(value: Value): Value => structuredClone(value)
const isStateExpired = (record: McpOAuthRecord, now = Date.now()) => record.expiresAt <= now

export class MemoryMcpOAuthStore implements McpOAuthStore {
  private readonly records = new Map<string, McpOAuthRecord>()

  private key(userId: string, serverId: string) {
    return `${userId}\0${serverId}`
  }

  async find(userId: string, serverId: string): Promise<McpOAuthRecord | null> {
    const record = this.records.get(this.key(userId, serverId))
    if (!record) {
      return null
    }
    if (!record.connected && isStateExpired(record)) {
      this.records.delete(this.key(userId, serverId))
      return null
    }
    return clone(record)
  }

  async findByState(state: string): Promise<McpOAuthRecord | null> {
    const record = [...this.records.values()].find((candidate) => candidate.state === state)
    if (!record) {
      return null
    }
    if (isStateExpired(record)) {
      this.records.delete(this.key(record.userId, record.serverId))
      return null
    }
    return clone(record)
  }

  async upsert(record: McpOAuthRecord): Promise<McpOAuthRecord> {
    this.records.set(this.key(record.userId, record.serverId), clone(record))
    return clone(record)
  }

  async delete(userId: string, serverId: string): Promise<void> {
    this.records.delete(this.key(userId, serverId))
  }
}

export class FileMcpOAuthStore implements McpOAuthStore {
  private database: OAuthDatabase | null = null
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

  private async load(): Promise<OAuthDatabase> {
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
        !('records' in parsed) ||
        !Array.isArray(parsed.records)
      ) {
        throw new Error('Unsupported MCP OAuth database format')
      }
      this.database = parsed as OAuthDatabase
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      this.database = emptyDatabase()
    }
    return this.database
  }

  private async persist(database: OAuthDatabase): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${crypto.randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(database, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPath, this.filePath)
  }

  async find(userId: string, serverId: string): Promise<McpOAuthRecord | null> {
    return this.exclusive(async () => {
      const database = await this.load()
      const record = database.records.find(
        (candidate) => candidate.userId === userId && candidate.serverId === serverId
      )
      if (!record) {
        return null
      }
      if (!record.connected && isStateExpired(record)) {
        database.records = database.records.filter((candidate) => candidate !== record)
        await this.persist(database)
        return null
      }
      return clone(record)
    })
  }

  async findByState(state: string): Promise<McpOAuthRecord | null> {
    return this.exclusive(async () => {
      const database = await this.load()
      const record = database.records.find((candidate) => candidate.state === state)
      if (!record) {
        return null
      }
      if (isStateExpired(record)) {
        database.records = database.records.filter((candidate) => candidate !== record)
        await this.persist(database)
        return null
      }
      return clone(record)
    })
  }

  async upsert(record: McpOAuthRecord): Promise<McpOAuthRecord> {
    return this.exclusive(async () => {
      const database = await this.load()
      database.records = database.records.filter(
        (candidate) => candidate.userId !== record.userId || candidate.serverId !== record.serverId
      )
      database.records.push(clone(record))
      await this.persist(database)
      return clone(record)
    })
  }

  async delete(userId: string, serverId: string): Promise<void> {
    await this.exclusive(async () => {
      const database = await this.load()
      const next = database.records.filter(
        (candidate) => candidate.userId !== userId || candidate.serverId !== serverId
      )
      if (next.length === database.records.length) {
        return
      }
      database.records = next
      await this.persist(database)
    })
  }
}
