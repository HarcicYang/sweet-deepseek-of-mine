import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SyncSessionPayload } from '@sweet-deepseek/contracts/sync'

export type ShareRecord = {
  token: string
  userId: string
  session: SyncSessionPayload
  createdAt: string
  expiresAt: string
}

export type ShareStore = {
  createShare: (
    userId: string,
    session: SyncSessionPayload,
    expiresAt: string
  ) => Promise<ShareRecord>
  getShare: (token: string, now?: number) => Promise<ShareRecord | null>
}

type ShareDatabase = {
  version: 1
  shares: ShareRecord[]
}

const emptyDatabase = (): ShareDatabase => ({ version: 1, shares: [] })
const clone = <Value>(value: Value): Value => structuredClone(value)
const isExpired = (share: ShareRecord, now: number) => Date.parse(share.expiresAt) <= now

const newToken = () => crypto.randomUUID().replaceAll('-', '')

const createRecord = (
  userId: string,
  session: SyncSessionPayload,
  expiresAt: string
): ShareRecord => ({
  token: newToken(),
  userId,
  session: clone(session),
  createdAt: new Date().toISOString(),
  expiresAt,
})

export class MemoryShareStore implements ShareStore {
  private shares: ShareRecord[] = []

  async createShare(
    userId: string,
    session: SyncSessionPayload,
    expiresAt: string
  ): Promise<ShareRecord> {
    this.shares = this.shares.filter((share) => !isExpired(share, Date.now()))
    const record = createRecord(userId, session, expiresAt)
    this.shares.push(record)
    return clone(record)
  }

  async getShare(token: string, now = Date.now()): Promise<ShareRecord | null> {
    const record = this.shares.find((candidate) => candidate.token === token)
    if (!record || isExpired(record, now)) {
      return null
    }
    return clone(record)
  }
}

export class FileShareStore implements ShareStore {
  private database: ShareDatabase | null = null
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

  private async load(): Promise<ShareDatabase> {
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
        !('shares' in parsed) ||
        !Array.isArray(parsed.shares)
      ) {
        throw new Error('Unsupported share database format')
      }
      this.database = parsed as ShareDatabase
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      this.database = emptyDatabase()
    }
    return this.database
  }

  private async persist(database: ShareDatabase): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${crypto.randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(database, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPath, this.filePath)
  }

  async createShare(
    userId: string,
    session: SyncSessionPayload,
    expiresAt: string
  ): Promise<ShareRecord> {
    return this.exclusive(async () => {
      const database = await this.load()
      database.shares = database.shares.filter((share) => !isExpired(share, Date.now()))
      const record = createRecord(userId, session, expiresAt)
      database.shares.push(record)
      await this.persist(database)
      return clone(record)
    })
  }

  async getShare(token: string, now = Date.now()): Promise<ShareRecord | null> {
    return this.exclusive(async () => {
      const database = await this.load()
      const record = database.shares.find((candidate) => candidate.token === token)
      if (!record || isExpired(record, now)) {
        return null
      }
      return clone(record)
    })
  }
}
